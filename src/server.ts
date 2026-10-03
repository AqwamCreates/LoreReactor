// src/server.ts
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import open from 'open';
import clipboardy from 'clipboardy';
import notifier from 'node-notifier';
import si from 'systeminformation';
import screenshot from 'screenshot-desktop';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import chokidar, { type FSWatcher } from 'chokidar';
import { SerialPort } from 'serialport';
import say from 'say';
import activeWindow from 'active-win';

// --- Configuration ---
const app = express();
const PORT = 8448;
const ROOT_DIR = process.cwd();
const APP_NAME = "LoreReactor";

const LOCAL_BACKENDS_PATH = 'local_backends';

// ── Platform helpers ────────────────────────────────────────────────
const IS_WINDOWS = process.platform === 'win32';
const IS_MACOS   = process.platform === 'darwin';

/** Append .exe on Windows, nothing on Linux/macOS */
function bin(name: string): string {
  return IS_WINDOWS ? `${name}.exe` : name;
}

/**
 * Resolve a Python interpreter path inside a backend directory.
 * Windows: <dir>/python.exe  (copied from venv/Scripts/python.exe by installer)
 * Linux/Mac: <dir>/python    (symlink to venv/bin/python created by installer)
 */
function pythonBin(backendDir: string): string {
  return path.join(ROOT_DIR, LOCAL_BACKENDS_PATH, backendDir, bin('python'));
}

type LocalBackend =
  | 'Llama.cpp'
  | 'Transformers'
  | 'ExLlamaV3'
  | 'ExLlamaV3 HF'
  | 'ExLlamaV2'
  | 'TensorRT-LLM'
  | 'Ollama'
  | 'vLLM'
  | 'SGLang'
  | 'LM Studio'
  | 'LocalAI'
  | 'mistral.rs';

interface BackendConfig {
  binaryPath: string;
  buildArgs: (modelPath: string, port: number, extraArgs: string[]) => string[];
  healthUrl: (port: number) => string;
  cwd?: string;
  logLabel: string;
  readyPattern?: RegExp;
  envOverrides?: (port: number) => Record<string, string>;
  modelNameNotPath?: boolean;
}

const BACKEND_CONFIGS: Record<LocalBackend, BackendConfig> = {

  'Llama.cpp': {
    binaryPath: path.join(ROOT_DIR, LOCAL_BACKENDS_PATH, 'llama', bin('llama-server')),
    buildArgs: (modelPath, port, extraArgs) => [
      '-m', modelPath, '--port', port.toString(), '--host', '0.0.0.0', ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/health`,
    cwd: path.join(LOCAL_BACKENDS_PATH, 'llama'),
    logLabel: 'LLAMA',
    readyPattern: /HTTP server listening/i,
  },

  'Transformers': {
    binaryPath: path.join(ROOT_DIR, LOCAL_BACKENDS_PATH, 'transformers', 'text-generation-launcher'),
    buildArgs: (modelPath, port, extraArgs) => [
      '--model-id', modelPath, '--port', port.toString(), '--hostname', '0.0.0.0', ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/health`,
    cwd: path.join(LOCAL_BACKENDS_PATH, 'transformers'),
    logLabel: 'TGI',
    readyPattern: /Connected/i,
  },

  'ExLlamaV3': {
    binaryPath: pythonBin('exllamav3'),
    buildArgs: (modelPath, port, extraArgs) => [
      'start.py', '--model-dir', modelPath, '--port', port.toString(), '--host', '0.0.0.0', ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/v1/models`,
    cwd: path.join(LOCAL_BACKENDS_PATH, 'exllamav3'),
    logLabel: 'EXLV3',
    readyPattern: /Uvicorn running/i,
  },

  'ExLlamaV3 HF': {
    binaryPath: pythonBin('exllamav3_hf'),
    buildArgs: (modelPath, port, extraArgs) => [
      'start.py', '--model-dir', modelPath, '--port', port.toString(), '--host', '0.0.0.0', '--hf-model', ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/v1/models`,
    cwd: path.join(LOCAL_BACKENDS_PATH, 'exllamav3_hf'),
    logLabel: 'EXLV3HF',
    readyPattern: /Uvicorn running/i,
  },

  'ExLlamaV2': {
    binaryPath: pythonBin('exllamav2'),
    buildArgs: (modelPath, port, extraArgs) => [
      'start.py', '--model-dir', modelPath, '--port', port.toString(), '--host', '0.0.0.0', ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/v1/models`,
    cwd: path.join(LOCAL_BACKENDS_PATH, 'exllamav2'),
    logLabel: 'EXLV2',
    readyPattern: /Uvicorn running/i,
  },

  'TensorRT-LLM': {
    binaryPath: path.join(ROOT_DIR, LOCAL_BACKENDS_PATH, 'tensorrt-llm', 'tritonserver'),
    buildArgs: (modelPath, port, extraArgs) => [
      '--model-repository', modelPath, '--http-port', port.toString(), ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/v2/health/ready`,
    cwd: path.join(LOCAL_BACKENDS_PATH, 'tensorrt-llm'),
    logLabel: 'TRTLLM',
    readyPattern: /Started HTTPService/i,
  },

  'Ollama': {
    binaryPath: path.join(ROOT_DIR, LOCAL_BACKENDS_PATH, 'ollama', bin('ollama')),
    buildArgs: (_modelPath, _port, _extraArgs) => ['serve'],
    healthUrl: (port) => `http://127.0.0.1:${port}/`,
    cwd: path.join(LOCAL_BACKENDS_PATH, 'ollama'),
    logLabel: 'OLLAMA',
    readyPattern: /listening on/i,
    envOverrides: (port) => ({ OLLAMA_HOST: `0.0.0.0:${port}` }),
    modelNameNotPath: true,
  },

  'vLLM': {
    binaryPath: pythonBin('vllm'),
    buildArgs: (modelPath, port, extraArgs) => [
      '-m', 'vllm.entrypoints.openai.api_server',
      '--model', modelPath, '--port', port.toString(), '--host', '0.0.0.0', ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/health`,
    cwd: path.join(LOCAL_BACKENDS_PATH, 'vllm'),
    logLabel: 'VLLM',
    readyPattern: /Application startup complete/i,
  },

  'SGLang': {
    binaryPath: pythonBin('sglang'),
    buildArgs: (modelPath, port, extraArgs) => [
      '-m', 'sglang.launch_server',
      '--model-path', modelPath, '--port', port.toString(), '--host', '0.0.0.0', ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/health`,
    cwd: path.join(LOCAL_BACKENDS_PATH, 'sglang'),
    logLabel: 'SGLANG',
    readyPattern: /The server is fired up and ready/i,
  },

  'LM Studio': {
    binaryPath: path.join(ROOT_DIR, LOCAL_BACKENDS_PATH, 'lmstudio', bin('lms')),
    buildArgs: (_modelPath, port, extraArgs) => [
      'server', 'start', '--port', port.toString(), ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/v1/models`,
    cwd: path.join(LOCAL_BACKENDS_PATH, 'lmstudio'),
    logLabel: 'LMS',
    readyPattern: /Server started/i,
    modelNameNotPath: true,
  },

  'LocalAI': {
    binaryPath: path.join(ROOT_DIR, LOCAL_BACKENDS_PATH, 'localai', 'local-ai'),
    buildArgs: (_modelPath, port, extraArgs) => [
      '--address', `0.0.0.0:${port}`, ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/readyz`,
    cwd: path.join(LOCAL_BACKENDS_PATH, 'localai'),
    logLabel: 'LOCAI',
    readyPattern: /LocalAI is ready|listening on/i,
    modelNameNotPath: true,
  },

  'mistral.rs': {
    binaryPath: path.join(ROOT_DIR, LOCAL_BACKENDS_PATH, 'mistral-rs', bin('mistralrs-server')),
    buildArgs: (modelPath, port, extraArgs) => [
      '--model-id', modelPath, '--port', port.toString(), '--host', '0.0.0.0', ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/v1/models`,
    cwd: path.join(LOCAL_BACKENDS_PATH, 'mistral-rs'),
    logLabel: 'MRSSV',
    readyPattern: /Started HTTP server/i,
  },
};

interface ModelInstance {
  id: string;
  process: ChildProcess;
  port: number;
  status: 'starting' | 'ready' | 'error';
  modelPath: string;
  backend: LocalBackend;
  startTime: number;
}

const activeModels: Map<string, ModelInstance> = new Map();

const Colors = {
  Reset: "\x1b[0m", Bright: "\x1b[1m", Dim: "\x1b[2m",
  FgBlue: "\x1b[34m", FgGreen: "\x1b[32m", FgRed: "\x1b[31m",
  FgYellow: "\x1b[33m", FgCyan: "\x1b[36m", FgMagenta: "\x1b[35m", FgWhite: "\x1b[37m",
  BgBlue: "\x1b[44m", BgWhite: "\x1b[47m",
};

const log = {
  info: (msg: string) => console.log(`${Colors.FgBlue}[INFO]${Colors.Reset} ${msg}`),
  success: (msg: string) => console.log(`${Colors.FgGreen}[OK]${Colors.Reset} ${msg}`),
  warn: (msg: string) => console.log(`${Colors.FgYellow}[WARN]${Colors.Reset} ${msg}`),
  error: (msg: string) => console.log(`${Colors.FgRed}[ERROR]${Colors.Reset} ${msg}`),
  req: (method: string, url: string) => console.log(`${Colors.Dim}${Colors.FgCyan}↙ ${method}${Colors.Reset} ${url}`),
  reqError: (method: string, url: string, status: number) => console.log(`${Colors.FgRed}✗ ${method}${Colors.Reset} ${url} ${Colors.FgRed}→ ${status}${Colors.Reset}`),
  backend: (label: string, msg: string) => console.log(`${Colors.FgMagenta}[${label}]${Colors.Reset} ${msg}`),
};

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '50mb' }));

function resolveModelPath(inputPath: string): string {
  if (path.isAbsolute(inputPath)) return inputPath;
  const cleanPath = inputPath.startsWith('/') ? inputPath.slice(1) : inputPath;
  return path.join(ROOT_DIR, cleanPath);
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitForModelReady(healthUrl: string, timeoutMs = 60000): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const res = await fetch(healthUrl);
      if (res.ok) return true;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

/** Validate auxiliary file paths in args (--mmproj, --lora, -md) for llama.cpp-style backends */
function validateAuxPaths(args: string[]): void {
  const auxFlags = ['--mmproj', '--lora', '-md'];
  for (const flag of auxFlags) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && args[idx + 1]) {
      const resolved = resolveModelPath(args[idx + 1]);
      if (!fs.existsSync(resolved)) {
        log.warn(`${flag} file not found at ${resolved}, removing flag`);
        args.splice(idx, 2);
      } else {
        args[idx + 1] = resolved;
        log.info(`${flag}: ${resolved}`);
      }
    }
  }
}

// ─── GPU Monitoring ─────────────────────────────────────────────────

type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'unknown';

interface GpuStatus {
  vendor: GpuVendor;
  utilizationPercent: number;
  memoryUsedMB: number;
  memoryTotalMB: number;
  temperatureC: number | null;
  powerWatts: number | null;
  name: string;
  timestamp: number;
}

function detectGpuVendor(): GpuVendor {
  const checks: { vendor: GpuVendor; cmd: string }[] = [
    { vendor: 'nvidia', cmd: 'nvidia-smi --query-gpu=name --format=csv,noheader,nounits' },
    { vendor: 'amd',    cmd: 'rocm-smi --showproductname --json' },
    { vendor: 'intel',  cmd: 'xpu-smi discovery' },
  ];

  for (const { vendor, cmd } of checks) {
    try {
      execSync(cmd, { stdio: 'pipe', timeout: 3000 });
      return vendor;
    } catch { /* not available */ }
  }

  if (IS_MACOS) {
    try {
      execSync('system_profiler SPDisplaysDataType', { stdio: 'pipe', timeout: 3000 });
      return 'apple';
    } catch { /* not available */ }
  }

  return 'unknown';
}

let detectedGpuVendor: GpuVendor = 'unknown';

function queryNvidiaGpu(): GpuStatus | null {
  try {
    const raw = execSync(
      'nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits',
      { stdio: 'pipe', timeout: 3000, encoding: 'utf-8' },
    ).trim();

    const line = raw.split('\n')[0];
    const parts = line.split(',').map(s => s.trim());
    if (parts.length < 4) return null;

    return {
      vendor: 'nvidia',
      name: parts[0],
      utilizationPercent: Number.parseFloat(parts[1]) || 0,
      memoryUsedMB: Number.parseFloat(parts[2]) || 0,
      memoryTotalMB: Number.parseFloat(parts[3]) || 0,
      temperatureC: parts[4] ? Number.parseFloat(parts[4]) : null,
      powerWatts: parts[5] ? Number.parseFloat(parts[5]) : null,
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

function queryAmdGpu(): GpuStatus | null {
  try {
    const raw = execSync('rocm-smi --showuse --showmeminfo vram --json', {
      stdio: 'pipe', timeout: 3000, encoding: 'utf-8',
    }).trim();

    const data = JSON.parse(raw);
    const cardKeys = Object.keys(data).filter(k => k.startsWith('card'));
    if (cardKeys.length === 0) return null;

    const card = data[cardKeys[0]];
    const gpuUse   = card['GPU use (%)']               ?? card['gpu_use_percent']  ?? 0;
    const memUsed  = card['VRAM Total Used Memory (MB)'] ?? card['vram_used_mb']   ?? 0;
    const memTotal = card['VRAM Total Memory (MB)']      ?? card['vram_total_mb']  ?? 0;
    const temp     = card['Temperature (Sensor edge) (C)'] ?? card['temp_edge_c']  ?? null;

    return {
      vendor: 'amd',
      name: cardKeys[0],
      utilizationPercent: Number.parseFloat(String(gpuUse))   || 0,
      memoryUsedMB:       Number.parseFloat(String(memUsed))  || 0,
      memoryTotalMB:      Number.parseFloat(String(memTotal)) || 0,
      temperatureC: temp !== null ? Number.parseFloat(String(temp)) : null,
      powerWatts: null,
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

function queryIntelGpu(): GpuStatus | null {
  try {
    const raw = execSync('xpu-smi discovery', {
      stdio: 'pipe', timeout: 3000, encoding: 'utf-8',
    }).trim();

    const devices = JSON.parse(raw);
    if (!Array.isArray(devices) || devices.length === 0) return null;

    const dev = devices[0];
    return {
      vendor: 'intel',
      name: dev.device_name || dev.name || 'Intel GPU',
      utilizationPercent: dev.utilization    ?? 0,
      memoryUsedMB:       dev.memory_used_mb ?? dev.memory_used  ?? 0,
      memoryTotalMB:      dev.memory_total_mb ?? dev.memory_total ?? 0,
      temperatureC:       dev.temperature    ?? null,
      powerWatts:         dev.power_draw     ?? null,
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

function queryAppleGpu(): GpuStatus | null {
  try {
    const raw = execSync(
      'ioreg -r -c AGXAccelerator -d 1',
      { stdio: 'pipe', timeout: 3000, encoding: 'utf-8' },
    ).trim();

    const nameMatch = raw.match(/"IOClass"\s*=\s*"([^"]+)"/);
    const gpuName = nameMatch ? nameMatch[1] : 'Apple GPU';

    let utilization = 0;
    let power: number | null = null;
    try {
      const pmRaw = execSync(
        'powermetrics --samplers gpu_power -n 1 -i 500 --format json',
        { stdio: 'pipe', timeout: 3000, encoding: 'utf-8' },
      ).trim();
      const pmData = JSON.parse(pmRaw);
      const gpu = pmData.gpu_power?.[0] || pmData.gpu;
      if (gpu) {
        utilization = gpu.gpu_busy_pct ?? gpu.utilization ?? 0;
        power = gpu.gpu_power_mw ? gpu.gpu_power_mw / 1000 : null;
      }
    } catch { /* powermetrics unavailable or needs sudo */ }

    let memTotal = 0;
    try {
      const sysctlRaw = execSync('sysctl hw.memsize', { stdio: 'pipe', timeout: 1000, encoding: 'utf-8' }).trim();
      const memMatch = sysctlRaw.match(/(\d+)/);
      if (memMatch) memTotal = Math.round(Number.parseInt(memMatch[1], 10) / (1024 * 1024));
    } catch { /* ignore */ }

    return {
      vendor: 'apple',
      name: gpuName,
      utilizationPercent: utilization,
      memoryUsedMB: 0,
      memoryTotalMB: memTotal,
      temperatureC: null,
      powerWatts: power,
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

function queryGpuStatus(): GpuStatus | null {
  switch (detectedGpuVendor) {
    case 'nvidia': return queryNvidiaGpu();
    case 'amd':    return queryAmdGpu();
    case 'intel':  return queryIntelGpu();
    case 'apple':  return queryAppleGpu();
    default:       return null;
  }
}

let lastGpuStatus: GpuStatus | null = null;
let lastGpuQueryTime = 0;
const GPU_QUERY_MIN_INTERVAL_MS = 1000;

// ─── Media file detection helpers ────────────────────────────────────

/** Directories under user_data that store binary media files (not JSON) */
const MEDIA_DIR_PREFIXES = [
  'character_images/',
  'character_voices/',
  'multiplayer_character_images/',
  'multiplayer_character_voices/',
  'context_images/',
  'location_images/',
  'audio_track_audio/',
  'prompt_block_images/',
  'factorization_machine_data/'
];

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const AUDIO_EXTENSIONS = ['.ogg', '.mp3', '.wav', '.flac'];
const ALL_MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, ...AUDIO_EXTENSIONS];

function isMediaUploadPath(relativePath: string): boolean {
  return MEDIA_DIR_PREFIXES.some(prefix => relativePath.includes(prefix));
}

function getMimeType(ext: string): string {
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ogg': 'audio/ogg',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

// ─── Startup Data Sanitizer ──────────────────────────────────────────

const MANIFEST_DIRS = [
  'character_data',
  'multiplayer_character_data',
  'sampler_data',
  'context_data',
  'location_data',
  'model_data',
  'stop_pattern_data',
  'interaction_messages',
  'interaction_data',
  'budget_strategies',
  'profile_data',
  'world_data',
  'webpage_data',
  'memory_data',
  'audio_track_data',
  'prompt_block_data',
  'account_data',
  'multiplayer_data',
];

/**
 * Read a manifest.json array, remove IDs whose .json files no longer exist,
 * rewrite the manifest. Creates directory and empty manifest if missing.
 * Returns count of removed entries.
 */
function sanitizeManifestDir(dirName: string): number {
  const dirPath = path.join(ROOT_DIR, 'user_data', dirName);
  const manifestPath = path.join(dirPath, 'manifest.json');

  if (!fs.existsSync(dirPath)) {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
      log.info(`Created directory: ${dirPath}`);
    } catch { /* ignore */ }
  }

  if (!fs.existsSync(manifestPath)) {
    try {
      fs.writeFileSync(manifestPath, '[]', 'utf-8');
    } catch { /* ignore */ }
    return 0;
  }

  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const manifest: unknown = JSON.parse(raw);

    if (!Array.isArray(manifest)) return 0;

    const validIds: string[] = [];
    let removedCount = 0;

    for (const entry of manifest) {
      const id = typeof entry === 'string' ? entry : String(entry);
      const filePath = path.join(dirPath, `${id}.json`);
      if (fs.existsSync(filePath)) {
        validIds.push(id);
      } else {
        removedCount++;
      }
    }

    if (removedCount > 0) {
      fs.writeFileSync(manifestPath, JSON.stringify(validIds, null, 2), 'utf-8');
      log.warn(`Sanitized ${dirName}/manifest.json: removed ${removedCount} orphaned entr${removedCount === 1 ? 'y' : 'ies'}`);
    }

    return removedCount;
  } catch (e) {
    log.warn(`Failed to sanitize ${dirName}/manifest.json: ${(e as Error).message}`);
    return 0;
  }
}

/**
 * Scan interaction_messages/ for .json files not referenced by any chat's
 * interactionIdHistory. Deletes orphans and rewrites the messages manifest.
 */
function sanitizeOrphanedMessages(): number {
  const messagesDir = path.join(ROOT_DIR, 'user_data', 'interaction_messages');
  const chatsDir = path.join(ROOT_DIR, 'user_data', 'interaction_data');

  if (!fs.existsSync(messagesDir)) return 0;

  const referencedMessageIds = new Set<string>();

  if (fs.existsSync(chatsDir)) {
    const chatFiles = fs.readdirSync(chatsDir).filter(f => f.endsWith('.json') && f !== 'manifest.json');
    for (const file of chatFiles) {
      try {
        const raw = fs.readFileSync(path.join(chatsDir, file), 'utf-8');
        const chat = JSON.parse(raw);
        if (Array.isArray(chat.interactionIdHistory)) {
          for (const msgId of chat.interactionIdHistory) {
            if (typeof msgId === 'string') referencedMessageIds.add(msgId);
          }
        }
      } catch { /* skip corrupt chat files */ }
    }
  }

  if (fs.existsSync(chatsDir)) {
    const chatFiles = fs.readdirSync(chatsDir).filter(f => f.endsWith('.json') && f !== 'manifest.json');
    for (const file of chatFiles) {
      try {
        const raw = fs.readFileSync(path.join(chatsDir, file), 'utf-8');
        const chat = JSON.parse(raw);
        if (Array.isArray(chat.interactionHistory)) {
          for (const msg of chat.interactionHistory) {
            if (msg && typeof msg.id === 'string') referencedMessageIds.add(msg.id);
          }
        }
      } catch { /* skip */ }
    }
  }

  const messageFiles = fs.readdirSync(messagesDir).filter(f => f.endsWith('.json') && f !== 'manifest.json');
  let orphanedCount = 0;

  for (const file of messageFiles) {
    const msgId = file.replace(/\.json$/, '');
    if (!referencedMessageIds.has(msgId)) {
      try {
        fs.unlinkSync(path.join(messagesDir, file));
        orphanedCount++;
      } catch { /* skip permission errors */ }
    }
  }

  const messagesManifestPath = path.join(messagesDir, 'manifest.json');
  if (fs.existsSync(messagesManifestPath)) {
    try {
      const raw = fs.readFileSync(messagesManifestPath, 'utf-8');
      const manifest: unknown = JSON.parse(raw);
      if (Array.isArray(manifest)) {
        const cleaned = manifest.filter((id: unknown) =>
          typeof id === 'string' && referencedMessageIds.has(id)
        );
        fs.writeFileSync(messagesManifestPath, JSON.stringify(cleaned, null, 2), 'utf-8');
      }
    } catch { /* skip */ }
  }

  if (orphanedCount > 0) {
    log.warn(`Sanitized interaction_messages/: removed ${orphanedCount} orphaned message file${orphanedCount === 1 ? '' : 's'}`);
  }

  return orphanedCount;
}

/**
 * Delete chat messages with empty textContent (hollow chat messages).
 * Interaction-type messages are preserved — they're legitimate silent markers.
 */
function sanitizeHollowMessages(): number {
  const messagesDir = path.join(ROOT_DIR, 'user_data', 'interaction_messages');
  if (!fs.existsSync(messagesDir)) return 0;

  const messageFiles = fs.readdirSync(messagesDir).filter(f => f.endsWith('.json') && f !== 'manifest.json');
  let hollowCount = 0;

  for (const file of messageFiles) {
    try {
      const raw = fs.readFileSync(path.join(messagesDir, file), 'utf-8');
      const msg = JSON.parse(raw);

      if (msg.messageType === 'chat' && (!msg.textContent || !String(msg.textContent).trim())) {
        fs.unlinkSync(path.join(messagesDir, file));
        hollowCount++;
      }
    } catch { /* skip corrupt files */ }
  }

  if (hollowCount > 0) {
    log.warn(`Sanitized interaction_messages/: removed ${hollowCount} hollow message file${hollowCount === 1 ? '' : 's'}`);
  }

  return hollowCount;
}

/**
 * Remove stale IDs from chat interactionIdHistory arrays that point to
 * message files that no longer exist on disk.
 */
function sanitizeChatHistories(): number {
  const chatsDir = path.join(ROOT_DIR, 'user_data', 'interaction_data');
  const messagesDir = path.join(ROOT_DIR, 'user_data', 'interaction_messages');

  if (!fs.existsSync(chatsDir)) return 0;

  const existingMessageIds = new Set<string>();
  if (fs.existsSync(messagesDir)) {
    const msgFiles = fs.readdirSync(messagesDir).filter(f => f.endsWith('.json') && f !== 'manifest.json');
    for (const f of msgFiles) {
      existingMessageIds.add(f.replace(/\.json$/, ''));
    }
  }

  const chatFiles = fs.readdirSync(chatsDir).filter(f => f.endsWith('.json') && f !== 'manifest.json');
  let totalPruned = 0;

  for (const file of chatFiles) {
    try {
      const filePath = path.join(chatsDir, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const chat = JSON.parse(raw);

      if (Array.isArray(chat.interactionIdHistory)) {
        const originalLength = chat.interactionIdHistory.length;
        chat.interactionIdHistory = chat.interactionIdHistory.filter(
          (id: unknown) => typeof id === 'string' && existingMessageIds.has(id)
        );
        const pruned = originalLength - chat.interactionIdHistory.length;
        if (pruned > 0) {
          fs.writeFileSync(filePath, JSON.stringify(chat, null, 2), 'utf-8');
          totalPruned += pruned;
        }
      }
    } catch { /* skip corrupt files */ }
  }

  if (totalPruned > 0) {
    log.warn(`Sanitized chat histories: pruned ${totalPruned} dangling message reference${totalPruned === 1 ? '' : 's'}`);
  }

  return totalPruned;
}

/** Run all sanitization passes on server startup */
function runStartupSanitization(): void {
  log.info('Running startup data sanitization...');

  let totalManifestOrphans = 0;
  for (const dir of MANIFEST_DIRS) {
    totalManifestOrphans += sanitizeManifestDir(dir);
  }

  const hollowMessages = sanitizeHollowMessages();
  const orphanedMessages = sanitizeOrphanedMessages();
  const prunedReferences = sanitizeChatHistories();

  sanitizeManifestDir('interaction_messages');

  const totalCleaned = totalManifestOrphans + hollowMessages + orphanedMessages + prunedReferences;
  if (totalCleaned > 0) {
    log.success(
      `Startup sanitization complete: ${totalCleaned} issue${totalCleaned === 1 ? '' : 's'} fixed ` +
      `(${totalManifestOrphans} manifest orphans, ${hollowMessages} hollow messages, ` +
      `${orphanedMessages} unreferenced messages, ${prunedReferences} dangling references)`
    );
  } else {
    log.info('Startup sanitization: data is clean.');
  }
}

// ─── Fast Snippet Extractor for Search ────────────────────────────────
function createSnippet(text: string, query: string, radius = 50): string {
  const lowerText = text.toLowerCase();
  const idx = lowerText.indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, radius * 2);

  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

// --- /search Route (Strategy B: Multi-Chat Branch-Aware Filesystem Search) ---
app.get('/search', async (req, response) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const limit = Math.min(Number.parseInt(String(req.query.limit || '40'), 10), 100);

  if (!query || query.length <= 0) {
    return response.json({ query, results: [], count: 0, durationMs: 0 });
  }

  const startTime = Date.now();
  const lowerQuery = query.toLowerCase();

  const chatsDir = path.join(ROOT_DIR, 'user_data', 'interaction_data');
  const messagesDir = path.join(ROOT_DIR, 'user_data', 'interaction_messages');

  // 1. Build 1-to-Many map: messageId -> Array<{ chatId, chatName }>
  const messageToChatsMap = new Map<string, Array<{ chatId: string; chatName: string }>>();
  const chatResults: Array<{ type: 'chat'; id: string; name: string }> = [];

  if (fs.existsSync(chatsDir)) {
    const chatFiles = fs.readdirSync(chatsDir).filter(f => f.endsWith('.json') && f !== 'manifest.json');
    for (const file of chatFiles) {
      try {
        const raw = fs.readFileSync(path.join(chatsDir, file), 'utf-8');
        const chat = JSON.parse(raw);
        const chatId = file.replace(/\.json$/, '');
        const chatName = chat.name || 'Untitled Chat';

        // Check if chat title itself matches query
        if (chatName.toLowerCase().includes(lowerQuery)) {
          chatResults.push({ type: 'chat', id: chatId, name: chatName });
        }

        // Map every message in history to this chat
        if (Array.isArray(chat.interactionIdHistory)) {
          for (const msgId of chat.interactionIdHistory) {
            if (typeof msgId === 'string') {
              let list = messageToChatsMap.get(msgId);
              if (!list) {
                list = [];
                messageToChatsMap.set(msgId, list);
              }
              if (!list.some(c => c.chatId === chatId)) {
                list.push({ chatId, chatName });
              }
            }
          }
        }
      } catch { /* skip corrupt chat files */ }
    }
  }

  // 2. Scan interaction_messages directly from disk
  const messageResults: Array<{
    type: 'message';
    id: string;
    chats: Array<{ chatId: string; chatName: string }>;
    characterId?: string;
    snippet: string;
    timestamp: number;
  }> = [];

  if (fs.existsSync(messagesDir)) {
    const msgFiles = fs.readdirSync(messagesDir).filter(f => f.endsWith('.json') && f !== 'manifest.json');

    for (const file of msgFiles) {
      if (messageResults.length >= limit) break;

      try {
        const filePath = path.join(messagesDir, file);
        const raw = fs.readFileSync(filePath, 'utf-8');
        
        // Fast raw substring search before parsing JSON
        if (raw.toLowerCase().includes(lowerQuery)) {
          const msg = JSON.parse(raw);
          const msgId = file.replace(/\.json$/, '');
          const textContent = msg.textContent || '';

          if (textContent.toLowerCase().includes(lowerQuery)) {
            const containingChats = messageToChatsMap.get(msgId) || [];

            messageResults.push({
              type: 'message',
              id: msgId,
              chats: containingChats,
              characterId: msg.characterId,
              snippet: createSnippet(textContent, query),
              timestamp: msg.lastUpdatedTimestamp || msg.firstCreatedTimestamp || 0,
            });
          }
        }
      } catch { /* skip corrupt messages */ }
    }
  }

  const durationMs = Date.now() - startTime;
  const allResults = [...chatResults, ...messageResults].slice(0, limit);

  log.info(`Search for "${query}" completed in ${durationMs}ms with ${allResults.length} result(s)`);
  response.json({ query, results: allResults, count: allResults.length, durationMs });
});

// --- /user_data routes ---
app.use('/user_data', (req, response) => {
  const relativePath = req.url?.startsWith('/') ? req.url?.slice(1) : req.url;
  if (!relativePath || relativePath.includes('..')) {
    log.warn(`Blocked suspicious path attempt: ${relativePath}`);
    return response.status(403).json({ error: 'Invalid path structure' });
  }

  const filePath  = path.join(ROOT_DIR, 'user_data', relativePath);
  const directory = path.dirname(filePath);

  const originalStatus = response.status.bind(response);
  response.status = (code: number) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && code >= 400) log.reqError(req.method, req.url || '/', code);
    return originalStatus(code);
  };

  // ─── HEAD Request Handler (for existence checks) ─────────────────
  if (req.method === 'HEAD') {
    if (!fs.existsSync(filePath)) {
        for (const ext of ALL_MEDIA_EXTENSIONS) {
            if (fs.existsSync(filePath + ext)) {
                response.setHeader('Content-Type', getMimeType(ext));
                response.status(200).end();
                return;
            }
        }
        return response.status(404).end();
    }

    fs.stat(filePath, (error, stats) => {
        if (error) return response.status(500).end();
        response.setHeader('Content-Length', stats.size);
        const ext = path.extname(filePath).toLowerCase();
        if (ALL_MEDIA_EXTENSIONS.includes(ext)) {
            response.setHeader('Content-Type', getMimeType(ext));
        }
        response.status(200).end();
    });
    return;
  }

  if (req.method === 'GET') {
    if (!fs.existsSync(filePath)) {
      for (const ext of ALL_MEDIA_EXTENSIONS) {
        const withExt = filePath + ext;
        if (fs.existsSync(withExt)) {
          response.setHeader('Content-Type', getMimeType(ext));
          fs.readFile(withExt, (ie, buf) => {
            if (ie) return response.status(500).send('Media Read Error');
            response.send(buf);
          });
          return;
        }
      }
      log.reqError('GET', req.url || '/', 404);
      return response.status(404).json({ error: 'Resource not found' });
    }
    fs.stat(filePath, (error, stats) => {
      if (error) { log.reqError('GET', req.url || '/', 500); return response.status(500).json({ error: 'FS Error' }); }
      if (stats.isDirectory()) {
        const manifestPath = path.join(filePath, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
          try {
            fs.writeFileSync(manifestPath, '[]', 'utf-8');
          } catch { /* ignore */ }
        }
        fs.readdir(filePath, (error, files) => {
          if (error) { log.reqError('GET', req.url || '/', 500); return response.status(500).json({ error: 'Directory Read Error' }); }
          response.json(files);
        });
      } else {
        const ext = path.extname(filePath).toLowerCase();
        if (ALL_MEDIA_EXTENSIONS.includes(ext)) {
          response.setHeader('Content-Type', getMimeType(ext));
          fs.readFile(filePath, (ie, buf) => {
            if (ie) { log.reqError('GET', req.url || '/', 500); return response.status(500).send('Media Read Error'); }
            response.send(buf);
          });
        } else {
          fs.readFile(filePath, 'utf8', (error, data) => {
            if (error) { log.reqError('GET', req.url || '/', 500); return response.status(500).json({ error: 'Read Error' }); }
            if (ext === '.json') {
              response.setHeader('Content-Type', 'application/json');
            }
            response.send(data);
          });
        }
      }
    });
    return;
  }

  if (req.method === 'PUT') {
    if (!fs.existsSync(directory)) {
      try {
        fs.mkdirSync(directory, { recursive: true });
        log.success(`Created directory: ${directory}`);
      } catch (e: unknown) {
        return response.status(500).json({
          error: 'Mkdir Failed',
          details: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    }
    const body: unknown = req.body;
    const isMediaUpload = isMediaUploadPath(relativePath);
    const base64 =
      typeof body === 'object' && body !== null && 'base64' in body && typeof (body as Record<string, unknown>).base64 === 'string'
        ? (body as Record<string, string>).base64
        : undefined;

    if (isMediaUpload && base64) {
      try {
        const buffer = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
        fs.writeFile(filePath, buffer, (error) =>
          error ? response.status(500).json({ error: 'Write Media Failed' }) : response.json({ success: true }),
        );
        return;
      } catch {
        return response.status(400).json({ error: 'Invalid Base64' });
      }
    }

    fs.writeFile(filePath, JSON.stringify(body, null, 2), (error) =>
      error ? response.status(500).json({ error: 'Write JSON Failed' }) : response.json({ success: true }),
    );
    return;
  }

  if (req.method === 'DELETE') {
    fs.unlink(filePath, (error) => {
      if (error && error.code !== 'ENOENT') return response.status(500).json({ error: 'Delete Failed' });

      const relativeDir = path.dirname(relativePath);
      const fileName = path.basename(filePath);

      if (MANIFEST_DIRS.includes(relativeDir) && fileName.endsWith('.json') && fileName !== 'manifest.json') {
        const id = fileName.replace(/\.json$/, '');
        const manifestPath = path.join(directory, 'manifest.json');

        if (fs.existsSync(manifestPath)) {
          try {
            const raw = fs.readFileSync(manifestPath, 'utf-8');
            const manifest: unknown = JSON.parse(raw);
            if (Array.isArray(manifest)) {
              const cleaned = manifest.filter((entry: unknown) => {
                const entryId = typeof entry === 'string' ? entry : String(entry);
                return entryId !== id;
              });
              if (cleaned.length !== manifest.length) {
                fs.writeFileSync(manifestPath, JSON.stringify(cleaned, null, 2), 'utf-8');
                log.info(`Removed ${id} from ${relativeDir}/manifest.json`);
              }
            }
          } catch (e) {
            log.warn(`Failed to update ${relativeDir}/manifest.json: ${(e as Error).message}`);
          }
        }
      }

      response.json({ success: true });
    });
    return;
  }

  response.status(405).json({ error: 'Method Not Allowed' });
});

// --- Model Management ---

app.get('/models/status', (_req, response) => {
  const status = Array.from(activeModels.entries()).map(([id, instance]) => ({
    id,
    port: instance.port,
    status: instance.status,
    backend: instance.backend,
    modelPath: instance.modelPath,
    uptime: Date.now() - instance.startTime,
  }));
  response.json({ activeModels: status, count: status.length });
});

app.post('/models/load', async (req, response) => {
  const { id, modelPath, port: requestedPort, args = [], backend: requestedBackend } = req.body;

  if (!id || !modelPath) return response.status(400).json({ error: 'Missing id or modelPath' });
  if (activeModels.has(id)) {
    return response.status(409).json({
      error: `Model ${id} is already loaded`,
      port: activeModels.get(id)?.port,
    });
  }

  const backendName = (requestedBackend || 'Llama.cpp') as LocalBackend;
  const config = BACKEND_CONFIGS[backendName];

  if (!config) {
    return response.status(400).json({
      error: `Unsupported local backend: ${backendName}. Supported: ${Object.keys(BACKEND_CONFIGS).join(', ')}`,
    });
  }

  if (!fs.existsSync(config.binaryPath)) {
    return response.status(500).json({
      error: `${backendName} binary not found at ${config.binaryPath}. Run the backend installer from start.bat / start.sh first.`,
    });
  }

  const absoluteModelPath = config.modelNameNotPath ? modelPath : resolveModelPath(modelPath);
  if (!config.modelNameNotPath && !fs.existsSync(absoluteModelPath)) {
    return response.status(404).json({ error: `Model file not found at ${absoluteModelPath}` });
  }

  const mutableArgs = [...args];
  if (backendName === 'Llama.cpp') {
    validateAuxPaths(mutableArgs);
  }

  const port = requestedPort || await getFreePort();
  log.info(`Starting ${backendName} model "${id}" on port ${port} ...`);
  log.info(`Model path : ${absoluteModelPath}`);

  const launchArgs = config.buildArgs(absoluteModelPath, port, mutableArgs);
  log.info(`Launch args: ${launchArgs.join(' ')}`);

  const spawnCwd = config.cwd
    ? path.join(ROOT_DIR, config.cwd)
    : path.dirname(config.binaryPath);

  const envOverrides = config.envOverrides ? config.envOverrides(port) : {};

  const proc = spawn(config.binaryPath, launchArgs, {
    cwd: spawnCwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...envOverrides },
    shell: IS_WINDOWS,
  });

  const instance: ModelInstance = {
    id,
    process: proc,
    port,
    status: 'starting',
    modelPath: absoluteModelPath,
    backend: backendName,
    startTime: Date.now(),
  };
  activeModels.set(id, instance);

  proc.stdout?.on('data', (data: Buffer) => {
    const str = data.toString().trim();
    if (str) log.backend(config.logLabel, `[${id}] ${str}`);
    if (config.readyPattern?.test(str)) instance.status = 'ready';
  });

  proc.stderr?.on('data', (data: Buffer) => {
    const str = data.toString().trim();
    if (!str) return;
    const lowerStr = str.toLowerCase();
    const isError =
      lowerStr.includes('error:')       || lowerStr.includes('fatal')       ||
      lowerStr.includes('failed to')    || lowerStr.includes('exception')   ||
      lowerStr.includes('abort');
    const isFalsePositive =
      lowerStr.includes('was not control-type')    || lowerStr.includes('overridden')           ||
      lowerStr.includes('n_ctx_seq')               || lowerStr.includes('no implementations')   ||
      lowerStr.includes('already set by user');
    if (isError && !isFalsePositive) {
      log.error(`[${config.logLabel}:${id}] ${str}`);
    } else {
      log.backend(config.logLabel, `[${id}] ${str}`);
    }
  });

  proc.on('exit', (code) => {
    log.warn(`[${config.logLabel}:${id}] Process exited with code ${code}`);
    activeModels.delete(id);
  });

  const healthUrl = config.healthUrl(port);
  const isReady   = await waitForModelReady(healthUrl);

  if (isReady) {
    instance.status = 'ready';
    log.success(`${backendName} model "${id}" loaded successfully on port ${port}`);
    response.json({ success: true, id, port, status: 'ready', backend: backendName });
  } else {
    instance.status = 'error';
    log.error(`${backendName} model "${id}" failed to start within timeout. Killing process.`);
    proc.kill();
    activeModels.delete(id);
    response.status(504).json({ error: 'Model failed to initialize within timeout' });
  }
});

app.post('/models/unload', (req, response) => {
  const { id } = req.body;
  if (!id) return response.status(400).json({ error: 'Missing id' });

  const instance = activeModels.get(id);
  if (!instance) return response.status(404).json({ error: `Model ${id} not found` });

  log.info(`Unloading ${instance.backend} model "${id}" ...`);

  if (IS_WINDOWS) {
    try {
      execSync(`taskkill /PID ${instance.process.pid} /T /F`, { stdio: 'pipe' });
    } catch { /* process may have already exited */ }
  } else {
    instance.process.kill('SIGTERM');
    setTimeout(() => {
      if (instance.process.pid) {
        try { process.kill(instance.process.pid, 'SIGKILL'); } catch { /* already exited */ }
      }
    }, 2000);
  }

  activeModels.delete(id);
  log.success(`${instance.backend} model "${id}" unloaded`);
  response.json({ success: true, message: 'Model unloaded' });
});

app.all('/proxy/:modelId/{*path}', async (req, response) => {
  const modelId       = req.params.modelId;
  const remainingPath = (req.params as { path?: string }).path || '';
  const instance      = activeModels.get(modelId);

  if (!instance || instance.status !== 'ready') {
    return response.status(503).json({ error: `Model ${modelId} is not loaded or ready` });
  }

  const targetUrl = `http://127.0.0.1:${instance.port}/${remainingPath}`;

  try {
    const proxyRes = await fetch(targetUrl, {
      method: req.method,
      headers: Object.fromEntries(
        Object.entries(req.headers).flatMap(([key, value]) =>
          value === undefined ? [] : [[key, Array.isArray(value) ? value.join(', ') : value]],
        ),
      ),
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
    });

    response.status(proxyRes.status);
    proxyRes.headers.forEach((value, key) => {
      const skipHeaders = ['transfer-encoding', 'connection', 'keep-alive'];
      if (!skipHeaders.includes(key.toLowerCase())) {
        response.setHeader(key, value);
      }
    });

    if (proxyRes.body) {
      const reader = proxyRes.body.getReader();
      const pump = async (): Promise<void> => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            response.end();
            return;
          }
          response.write(Buffer.from(value));
        }
      };
      await pump();
    } else {
      response.end();
    }
  } catch (error) {
    response.status(502).json({ error: 'Proxy error', details: (error as Error).message });
  }
});

// --- GPU Status Endpoint ---

app.get('/gpu/status', (_req, response) => {
  const now = Date.now();

  if (now - lastGpuQueryTime < GPU_QUERY_MIN_INTERVAL_MS && lastGpuStatus) {
    response.json(lastGpuStatus);
    return;
  }

  const status = queryGpuStatus();
  if (status) {
    lastGpuStatus    = status;
    lastGpuQueryTime = now;
    response.json(status);
  } else if (lastGpuStatus) {
    response.json(lastGpuStatus);
  } else {
    response.json({
      vendor: detectedGpuVendor,
      utilizationPercent: 0,
      memoryUsedMB: 0,
      memoryTotalMB: 0,
      temperatureC: null,
      powerWatts: null,
      name: 'No GPU detected',
      timestamp: now,
    });
  }
});

// --- Web Fetch Proxy (CORS bypass) ---

app.post('/fetch', async (req, response) => {
  const { url, headers: reqHeaders } = req.body;
  if (!url || typeof url !== 'string') return response.status(400).json({ error: 'Missing url' });

  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: reqHeaders || {
        'User-Agent': 'LoreReactor/1.0 (Context Fetcher)',
        'Accept': 'text/html,text/plain,image/*,*/*',
      },
    });
    clearTimeout(timeoutId);

    const contentType = res.headers.get('content-type') || '';

    if (contentType.startsWith('image/')) {
      const buffer = Buffer.from(await res.arrayBuffer());
      response.json({ ok: res.ok, status: res.status, contentType, base64: buffer.toString('base64') });
    } else {
      const text = await res.text();
      response.json({ ok: res.ok, status: res.status, contentType, text });
    }
  } catch (e: unknown) {
    const error    = e instanceof Error ? e : new Error(String(e));
    const errorMsg = error.name === 'AbortError' ? 'Timeout' : error.message;
    log.reqError('FETCH', url, 0);
    log.warn(`Fetch failed for ${url}: ${errorMsg}`);
    response.json({ ok: false, status: 0, contentType: '', error: errorMsg });
  }
});

// ─── Tool Endpoints (/tool) ──────────────────────────────────────────

app.post('/tool/text', (req, res) => {
  const { text, voice, speed = 1.0 } = req.body;
  if (!text) return res.status(400).json({ error: 'Missing text' });

  say.speak(text, voice || undefined, speed, (err) => {
    if (err) return log.error(`TTS failed: ${err}`);
  });
  res.json({ success: true, message: 'Speech queued' });
});

app.post('/tool/text_to_speech/stop', (_req, res) => {
  say.stop();
  res.json({ success: true, message: 'Speech stopped' });
});

app.get('/tool/system-info', async (_req, res) => {
  try {
    const [cpu, mem, currentLoad, fsSize] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.currentLoad(),
      si.fsSize()
    ]);

    res.json({
      success: true,
      data: {
        cpuManufacturer: cpu.manufacturer,
        cpuBrand: cpu.brand,
        cores: cpu.cores,
        loadPercent: Math.round(currentLoad.currentLoad),
        memoryTotalMB: Math.round(mem.total / (1024 * 1024)),
        memoryUsedMB: Math.round(mem.used / (1024 * 1024)),
        disks: fsSize.map(d => ({
          fs: d.fs,
          type: d.type,
          sizeGB: Math.round(d.size / (1024 * 1024 * 1024)),
          usedGB: Math.round(d.used / (1024 * 1024 * 1024)),
          usePercent: d.use
        }))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post('/tool/notify', (req, res) => {
  const { title, message } = req.body;
  if (!message) return res.status(400).json({ success: false, error: 'Missing message' });

  notifier.notify(
    {
      title: title || 'LoreReactor Agent',
      message: message,
      sound: true, // Only plays if OS allows
      wait: false
    },
    (err) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, message: 'Notification sent' });
    }
  );
});

app.post('/tool/clipboard', async (req, res) => {
  const { action, text } = req.body; // action: 'read' | 'write'

  try {
    if (action === 'read') {
      const content = await clipboardy.read();
      return res.json({ success: true, content });
    }
    
    if (action === 'write') {
      if (typeof text !== 'string') return res.status(400).json({ success: false, error: 'Missing text parameter' });
      await clipboardy.write(text);
      return res.json({ success: true, message: 'Successfully copied to clipboard' });
    }

    res.status(400).json({ success: false, error: 'Invalid action. Use "read" or "write".' });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post('/tool/screenshot', async (_req, res) => {
  try {
    // Captures primary display buffer as a base64 JPEG string
    const imgBuffer = await screenshot({ format: 'jpg' });
    const base64Image = imgBuffer.toString('base64');

    res.json({
      success: true,
      contentType: 'image/jpeg',
      base64: base64Image
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

const activeWatchers = new Map<string, FSWatcher>();
const fileChangeEvents: Array<{ event: string; path: string; timestamp: number }> = [];

app.post('/tool/file-watcher/start', (req, res) => {
  const { dirPath } = req.body;
  const targetDir = path.isAbsolute(dirPath) ? dirPath : path.join(ROOT_DIR, dirPath);

  if (activeWatchers.has(targetDir)) {
    return res.json({ success: true, message: `Already watching ${targetDir}` });
  }

  try {
    const watcher = chokidar.watch(targetDir, { ignoreInitial: true });
    watcher.on('all', (event, filePath) => {
      fileChangeEvents.push({ event, path: filePath, timestamp: Date.now() });
      if (fileChangeEvents.length > 50) fileChangeEvents.shift(); // keep last 50 events
    });

    activeWatchers.set(targetDir, watcher);
    log.info(`File watcher started on: ${targetDir}`);
    res.json({ success: true, path: targetDir });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.get('/tool/file-watcher/events', (_req, res) => {
  // Return the queued events and clear buffer
  const events = [...fileChangeEvents];
  fileChangeEvents.length = 0;
  res.json({ success: true, events });
});

app.get('/tool/window-monitor', async (_req, res) => {
  try {
    const currentWindow = await activeWindow();
    if (!currentWindow) {
      return res.json({ success: true, window: null, message: 'No active window detected' });
    }

    res.json({
      success: true,
      window: {
        title: currentWindow.title,
        appName: currentWindow.owner?.name,
        processId: currentWindow.owner?.processId,
        url: ('url' in currentWindow && currentWindow.url) ? currentWindow.url : undefined,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.get('/tool/process-monitor', async (req, res) => {
  const filter = typeof req.query.q === 'string' ? req.query.q.toLowerCase() : '';
  const limit = Math.min(Number.parseInt(String(req.query.limit || '10'), 10), 50);

  try {
    const procData = await si.processes();
    let list = procData.list;

    if (filter) {
      list = list.filter(p => p.name.toLowerCase().includes(filter));
    }

    // Sort by CPU usage descending
    list = list.sort((a, b) => b.cpu - a.cpu).slice(0, limit);

    res.json({
      success: true,
      totalCount: procData.all,
      runningCount: procData.running,
      processes: list.map(p => ({
        pid: p.pid,
        name: p.name,
        cpu: p.cpu,
        memPercent: p.mem,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Single unified endpoint to open files, videos, directories, or URLs
app.post('/tool/read-file', async (req, response) => {
  const { target } = req.body;
  if (!target) {
    return response.status(400).json({ success: false, error: 'Missing target' });
  }

  try {
    const isUrl = /^https?:\/\//i.test(target);
    const resolvedTarget = isUrl
      ? target
      : path.isAbsolute(target)
      ? target
      : path.join(ROOT_DIR, target);

    if (!isUrl && !fs.existsSync(resolvedTarget)) {
      return response.status(404).json({ success: false, error: `File or target not found: ${target}` });
    }

    await open(resolvedTarget);
    log.info(`Opened target: ${resolvedTarget}`);
    response.json({ success: true, target: resolvedTarget });
  } catch (error) {
    log.error(`Failed to open target ${target}: ${(error as Error).message}`);
    response.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post('/tool/write-file', (req, response) => {
  const { filePath, content } = req.body;
  if (!filePath || content === undefined) {
    return response.status(400).json({ success: false, error: 'Missing filePath or content' });
  }

  try {
    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(ROOT_DIR, filePath);
    const dir = path.dirname(resolvedPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(resolvedPath, content, 'utf-8');
    log.success(`File written: ${resolvedPath} (${content.length} bytes)`);
    response.json({ success: true, path: resolvedPath, bytes: Buffer.byteLength(content, 'utf-8') });
  } catch (error) {
    log.error(`Write file failed for ${filePath}: ${(error as Error).message}`);
    response.status(500).json({ success: false, error: (error as Error).message });
  }
});

const execAsync = promisify(exec);

app.post('/tool/shell', async (req, res) => {
  const { command } = req.body;
  if (!command || typeof command !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing command' });
  }

  // Safety filter example: block catastrophic commands if exposed to autonomous agents
  const dangerousPatterns = [/rm\s+-rf\s+\//i, /mkfs/i, />\s*\/dev\/sd/i];
  if (dangerousPatterns.some(pattern => pattern.test(command))) {
    return res.status(403).json({ success: false, error: 'Command blocked by security policy' });
  }

  try {
    log.info(`Executing shell command: ${command}`);
    const { stdout, stderr } = await execAsync(command, { timeout: 10000, cwd: ROOT_DIR });
    res.json({ success: true, stdout: stdout.trim(), stderr: stderr.trim() });
  } catch (error: unknown) {
    const err = error as Error & { stdout?: string; stderr?: string };
    res.status(500).json({ 
      success: false, 
      error: err.message, 
      stdout: err.stdout?.trim() || '', 
      stderr: err.stderr?.trim() || '' 
    });
  }
});

app.get('/tool/hardware/list', async (_req, res) => {
  try {
    const ports = await SerialPort.list();
    res.json({ success: true, ports });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post('/tool/hardware/send', async (req, res) => {
  const { portPath, command, baudRate = 9600 } = req.body;
  if (!portPath || !command) return res.status(400).json({ error: 'Missing portPath or command' });

  try {
    const port = new SerialPort({ path: portPath, baudRate });
    port.write(`${command}\n`, (err) => {
      port.close();
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, sent: command });
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// --- Startup ---

const startServer = () => {
  detectedGpuVendor = detectGpuVendor();

  runStartupSanitization();

  const border = '────────────────────────────────────────';
  const title  = `${Colors.Bright}${Colors.FgCyan}⚛️  ${APP_NAME} Server${Colors.Reset}`;

  const archLabel = process.arch === 'x64'   ? 'x64'
                  : process.arch === 'ia32'  ? 'x86 (32-bit)'
                  : process.arch === 'arm64' ? 'ARM64'
                  : process.arch;

  const platLabel = IS_WINDOWS ? `Windows ${archLabel}`
                  : IS_MACOS   ? `macOS ${archLabel}`
                  :              `Linux ${archLabel}`;

  console.clear();
  console.log(`${Colors.BgBlue}${Colors.Bright}${Colors.FgWhite}  ${APP_NAME}  ${Colors.Reset}`);
  console.log(border);
  console.log(`  ${title}`);
  console.log(`  🖥️  Platform : ${Colors.Dim}${platLabel}${Colors.Reset}`);
  console.log(`  📂 Backends  : ${Colors.Dim}${path.join(ROOT_DIR, LOCAL_BACKENDS_PATH)}${Colors.Reset}`);

  for (const [name, cfg] of Object.entries(BACKEND_CONFIGS)) {
    const exists = fs.existsSync(cfg.binaryPath);
    const icon   = exists
      ? `${Colors.FgGreen}●${Colors.Reset}`
      : `${Colors.FgRed}○${Colors.Reset}`;
    console.log(`     ${icon} ${(name as string).padEnd(16)} ${Colors.Dim}${cfg.binaryPath}${Colors.Reset}`);
  }

  console.log(border);
  console.log(`  📡 API Port  : ${Colors.FgGreen}http://127.0.0.1:${PORT}${Colors.Reset}`);
  console.log(`  💾 Data Path : ${Colors.Dim}/user_data/${Colors.Reset}`);
  console.log(`  🎮 GPU Monitor: ${Colors.FgGreen}${detectedGpuVendor}${Colors.Reset} ${Colors.Dim}(GET /gpu/status)${Colors.Reset}`);
  console.log(border);
  console.log(`  ${Colors.FgGreen}●${Colors.Reset} System Ready.`);
  console.log(`  ${Colors.FgMagenta}●${Colors.Reset} Multi-Backend Model Control Enabled.`);
  console.log('');

  app.listen(PORT, '0.0.0.0', () => {});
};

startServer()