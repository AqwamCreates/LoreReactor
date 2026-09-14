// server.ts
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import net from 'node:net';

// --- Configuration ---
const app = express();
const PORT = 3001;
const ROOT_DIR = process.cwd();
const APP_NAME = "LoreReactor";

const LOCAL_BACKENDS_PATH = 'local_backends';

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
  /** Build launch args given model path, port, and user-supplied extra args */
  buildArgs: (modelPath: string, port: number, extraArgs: string[]) => string[];
  /** Health check URL for readiness polling */
  healthUrl: (port: number) => string;
  /** Working directory for the spawned process (relative to ROOT_DIR) */
  cwd?: string;
  /** Log label prefix */
  logLabel: string;
  /** Stdout pattern that indicates the server is ready (optional, supplements health polling) */
  readyPattern?: RegExp;
  /** Environment variable overrides for the spawned process */
  envOverrides?: (port: number) => Record<string, string>;
  /** If true, modelPath is a tag/name rather than a file path on disk */
  modelNameNotPath?: boolean;
}

const BACKEND_CONFIGS: Record<LocalBackend, BackendConfig> = {
  // ─── Llama.cpp (native /completion API) ──────────────────────────
  'Llama.cpp': {
    binaryPath: path.join(ROOT_DIR, LOCAL_BACKENDS_PATH, 'llama', 'llama-server.exe'),
    buildArgs: (modelPath, port, extraArgs) => [
      '-m', modelPath, '--port', port.toString(), '--host', '0.0.0.0', ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/health`,
    cwd: path.join(LOCAL_BACKENDS_PATH, 'llama'),
    logLabel: 'LLAMA',
    readyPattern: /HTTP server listening/i,
  },

  // ─── HuggingFace Transformers / TGI ──────────────────────────────
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

  // ─── ExLlamaV3 via TabbyAPI ──────────────────────────────────────
  'ExLlamaV3': {
    binaryPath: path.join(ROOT_DIR, LOCAL_BACKENDS_PATH, 'exllamav3', 'python'),
    buildArgs: (modelPath, port, extraArgs) => [
      'start.py', '--model-dir', modelPath, '--port', port.toString(), '--host', '0.0.0.0', ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/v1/models`,
    cwd: path.join(LOCAL_BACKENDS_PATH, 'exllamav3'),
    logLabel: 'EXLV3',
    readyPattern: /Uvicorn running/i,
  },

  // ─── ExLlamaV3 HF via TabbyAPI (HuggingFace model format) ───────
  'ExLlamaV3 HF': {
    binaryPath: path.join(ROOT_DIR, LOCAL_BACKENDS_PATH, 'exllamav3_hf', 'python'),
    buildArgs: (modelPath, port, extraArgs) => [
      'start.py', '--model-dir', modelPath, '--port', port.toString(), '--host', '0.0.0.0', '--hf-model', ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/v1/models`,
    cwd: path.join(LOCAL_BACKENDS_PATH, 'exllamav3'),
    logLabel: 'EXLV3HF',
    readyPattern: /Uvicorn running/i,
  },

  // ─── ExLlamaV2 via TabbyAPI ──────────────────────────────────────
  'ExLlamaV2': {
    binaryPath: path.join(ROOT_DIR, LOCAL_BACKENDS_PATH, 'exllamav2', 'python'),
    buildArgs: (modelPath, port, extraArgs) => [
      'start.py', '--model-dir', modelPath, '--port', port.toString(), '--host', '0.0.0.0', ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/v1/models`,
    cwd: path.join(LOCAL_BACKENDS_PATH, 'exllamav2'),
    logLabel: 'EXLV2',
    readyPattern: /Uvicorn running/i,
  },

  // ─── NVIDIA TensorRT-LLM via Triton Inference Server ─────────────
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

  // ─── Ollama ──────────────────────────────────────────────────────
  'Ollama': {
    binaryPath: path.join(ROOT_DIR, LOCAL_BACKENDS_PATH, 'ollama', 'ollama.exe'),
    buildArgs: (_modelPath, _port, _extraArgs) => ['serve'],
    healthUrl: (port) => `http://127.0.0.1:${port}/`,
    cwd: path.join(LOCAL_BACKENDS_PATH, 'ollama'),
    logLabel: 'OLLAMA',
    readyPattern: /server listening/i,
    envOverrides: (port) => ({ OLLAMA_HOST: `0.0.0.0:${port}` }),
    modelNameNotPath: true,
  },

  // ─── vLLM (PagedAttention, high-throughput serving) ─────────────
  'vLLM': {
    binaryPath: path.join(ROOT_DIR, LOCAL_BACKENDS_PATH, 'vllm', 'python'),
    buildArgs: (modelPath, port, extraArgs) => [
      '-m', 'vllm.entrypoints.openai.api_server',
      '--model', modelPath, '--port', port.toString(), '--host', '0.0.0.0', ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/health`,
    cwd: path.join(LOCAL_BACKENDS_PATH, 'vllm'),
    logLabel: 'VLLM',
    readyPattern: /Application startup complete/i,
  },

  // ─── SGLang (RadixAttention, structured generation) ─────────────
  'SGLang': {
    binaryPath: path.join(ROOT_DIR, LOCAL_BACKENDS_PATH, 'sglang', 'python'),
    buildArgs: (modelPath, port, extraArgs) => [
      '-m', 'sglang.launch_server',
      '--model-path', modelPath, '--port', port.toString(), '--host', '0.0.0.0', ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/health`,
    cwd: path.join(LOCAL_BACKENDS_PATH, 'sglang'),
    logLabel: 'SGLANG',
    readyPattern: /The server is fired up and ready/i,
  },

  // ─── LM Studio (GUI-backed local server) ────────────────────────
  'LM Studio': {
    binaryPath: path.join(ROOT_DIR, LOCAL_BACKENDS_PATH, 'lmstudio', 'lms'),
    buildArgs: (_modelPath, port, extraArgs) => [
      'server', 'start', '--port', port.toString(), ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/v1/models`,
    cwd: path.join(LOCAL_BACKENDS_PATH, 'lmstudio'),
    logLabel: 'LMS',
    readyPattern: /Server started/i,
    modelNameNotPath: true,
  },

  // ─── LocalAI (multi-modal drop-in OpenAI replacement) ───────────
  'LocalAI': {
    binaryPath: path.join(ROOT_DIR, LOCAL_BACKENDS_PATH, 'localai', 'local-ai'),
    buildArgs: (_modelPath, port, extraArgs) => [
      'run', '--address', `0.0.0.0:${port}`, ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/readyz`,
    cwd: path.join(LOCAL_BACKENDS_PATH, 'localai'),
    logLabel: 'LOCAI',
    readyPattern: /LocalAI is ready/i,
    modelNameNotPath: true,
  },

  // ─── mistral.rs (Rust-based, no Python dependency) ──────────────
  'mistral.rs': {
    binaryPath: path.join(ROOT_DIR, LOCAL_BACKENDS_PATH, 'mistral-rs', 'mistralrs-server'),
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

/** Detect which GPU monitoring CLI is available on this system */
function detectGpuVendor(): GpuVendor {
  const checks: { vendor: GpuVendor; cmd: string }[] = [
    { vendor: 'nvidia', cmd: 'nvidia-smi --query-gpu=name --format=csv,noheader,nounits' },
    { vendor: 'amd', cmd: 'rocm-smi --showproductname --json' },
    { vendor: 'intel', cmd: 'xpu-smi discovery' },
  ];

  for (const { vendor, cmd } of checks) {
    try {
      execSync(cmd, { stdio: 'pipe', timeout: 3000 });
      return vendor;
    } catch { /* not available */ }
  }

  // Apple Silicon detection
  if (process.platform === 'darwin') {
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

    // Take first GPU if multi-GPU
    const line = raw.split('\n')[0];
    const parts = line.split(',').map(s => s.trim());
    if (parts.length < 4) return null;

    return {
      vendor: 'nvidia',
      name: parts[0],
      utilizationPercent: parseFloat(parts[1]) || 0,
      memoryUsedMB: parseFloat(parts[2]) || 0,
      memoryTotalMB: parseFloat(parts[3]) || 0,
      temperatureC: parts[4] ? parseFloat(parts[4]) : null,
      powerWatts: parts[5] ? parseFloat(parts[5]) : null,
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
    // rocm-smi JSON structure varies; take first card
    const cardKeys = Object.keys(data).filter(k => k.startsWith('card'));
    if (cardKeys.length === 0) return null;

    const card = data[cardKeys[0]];
    const gpuUse = card['GPU use (%)'] ?? card['gpu_use_percent'] ?? 0;
    const memUsed = card['VRAM Total Used Memory (MB)'] ?? card['vram_used_mb'] ?? 0;
    const memTotal = card['VRAM Total Memory (MB)'] ?? card['vram_total_mb'] ?? 0;
    const temp = card['Temperature (Sensor edge) (C)'] ?? card['temp_edge_c'] ?? null;

    return {
      vendor: 'amd',
      name: cardKeys[0],
      utilizationPercent: parseFloat(String(gpuUse)) || 0,
      memoryUsedMB: parseFloat(String(memUsed)) || 0,
      memoryTotalMB: parseFloat(String(memTotal)) || 0,
      temperatureC: temp !== null ? parseFloat(String(temp)) : null,
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

    // xpu-smi discovery outputs JSON array
    const devices = JSON.parse(raw);
    if (!Array.isArray(devices) || devices.length === 0) return null;

    const dev = devices[0];
    return {
      vendor: 'intel',
      name: dev.device_name || dev.name || 'Intel GPU',
      utilizationPercent: dev.utilization ?? 0,
      memoryUsedMB: dev.memory_used_mb ?? dev.memory_used ?? 0,
      memoryTotalMB: dev.memory_total_mb ?? dev.memory_total ?? 0,
      temperatureC: dev.temperature ?? null,
      powerWatts: dev.power_draw ?? null,
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

function queryAppleGpu(): GpuStatus | null {
  try {
    // powermetrics requires sudo; use ioreg for basic info without elevation
    const raw = execSync(
      'ioreg -r -c AGXAccelerator -d 1',
      { stdio: 'pipe', timeout: 3000, encoding: 'utf-8' },
    ).trim();

    // Extract GPU name from ioreg output
    const nameMatch = raw.match(/"IOClass"\s*=\s*"([^"]+)"/);
    const gpuName = nameMatch ? nameMatch[1] : 'Apple GPU';

    // Try powermetrics for utilization (may fail without sudo)
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

    // Unified memory: approximate from system memory
    let memTotal = 0;
    try {
      const sysctlRaw = execSync('sysctl hw.memsize', { stdio: 'pipe', timeout: 1000, encoding: 'utf-8' }).trim();
      const memMatch = sysctlRaw.match(/(\d+)/);
      if (memMatch) memTotal = Math.round(parseInt(memMatch[1], 10) / (1024 * 1024));
    } catch { /* ignore */ }

    return {
      vendor: 'apple',
      name: gpuName,
      utilizationPercent: utilization,
      memoryUsedMB: 0, // Unified memory — can't separate GPU usage without IOKit
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
    case 'amd': return queryAmdGpu();
    case 'intel': return queryIntelGpu();
    case 'apple': return queryAppleGpu();
    default: return null;
  }
}

// Cache last successful result to avoid hammering CLI on every poll
let lastGpuStatus: GpuStatus | null = null;
let lastGpuQueryTime = 0;
const GPU_QUERY_MIN_INTERVAL_MS = 1000; // Don't query more than once per second

// --- /user_data routes ---
app.use('/user_data', (req, response) => {
  const relativePath = req.url?.startsWith('/') ? req.url?.slice(1) : req.url;
  if (!relativePath || relativePath.includes('..')) {
    log.warn(`Blocked suspicious path attempt: ${relativePath}`);
    return response.status(403).json({ error: 'Invalid path structure' });
  }

  const filePath = path.join(ROOT_DIR, 'user_data', relativePath);
  const directory = path.dirname(filePath);

  const originalStatus = response.status.bind(response);
  response.status = (code: number) => {
    if (req.method === 'GET' && code >= 400) log.reqError(req.method || 'GET', req.url || '/', code);
    return originalStatus(code);
  };

  if (req.method === 'GET') {
    if (!fs.existsSync(filePath)) {
      log.reqError('GET', req.url || '/', 404);
      return response.status(404).json({ error: 'Resource not found' });
    }
    fs.stat(filePath, (error, stats) => {
      if (error) { log.reqError('GET', req.url || '/', 500); return response.status(500).json({ error: 'FS Error' }); }
      if (stats.isDirectory()) {
        fs.readdir(filePath, (error, files) => {
          if (error) { log.reqError('GET', req.url || '/', 500); return response.status(500).json({ error: 'Directory Read Error' }); }
          response.json(files);
        });
      } else {
        fs.readFile(filePath, 'utf8', (error, data) => {
          if (error) { log.reqError('GET', req.url || '/', 500); return response.status(500).json({ error: 'Read Error' }); }
          const ext = path.extname(filePath).toLowerCase();
          if (ext === '.json') { response.setHeader('Content-Type', 'application/json'); response.send(data); }
          else if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
            const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
            response.setHeader('Content-Type', mimeMap[ext]);
            fs.readFile(filePath, (ie, buf) => {
              if (ie) { log.reqError('GET', req.url || '/', 500); return response.status(500).send('Image Error'); }
              response.send(buf);
            });
          } else { response.send(data); }
        });
      }
    });
    return;
  }

  if (req.method === 'PUT') {
    if (!fs.existsSync(directory)) {
      try { fs.mkdirSync(directory, { recursive: true }); log.success(`Created directory: ${directory}`); }
      catch (e: unknown) { return response.status(500).json({ error: 'Mkdir Failed', details: e instanceof Error ? e.message : 'Unknown error' }); }
    }
    const body: unknown = req.body;
    const isImage = relativePath.includes('character_images/') || relativePath.includes('context_data/');
    const base64 = typeof body === 'object' && body !== null && 'base64' in body && typeof body.base64 === 'string' ? body.base64 : undefined;
    if (isImage && base64) {
      try {
        const buffer = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ""), 'base64');
        fs.writeFile(filePath, buffer, (error) => error ? response.status(500).json({ error: 'Write Image Failed' }) : response.json({ success: true }));
        return;
      } catch { return response.status(400).json({ error: 'Invalid Base64' }); }
    }
    fs.writeFile(filePath, JSON.stringify(body, null, 2), (error) => error ? response.status(500).json({ error: 'Write JSON Failed' }) : response.json({ success: true }));
    return;
  }

  if (req.method === 'DELETE') {
    fs.unlink(filePath, (error) => {
      if (error && error.code !== 'ENOENT') return response.status(500).json({ error: 'Delete Failed' });
      response.json({ success: true });
    });
    return;
  }

  response.status(405).json({ error: 'Method Not Allowed' });
});

// --- Model Management ---

app.get('/models/status', (_req, response) => {
  const status = Array.from(activeModels.entries()).map(([id, instance]) => ({
    id, port: instance.port, status: instance.status, backend: instance.backend,
    modelPath: instance.modelPath, uptime: Date.now() - instance.startTime,
  }));
  response.json({ activeModels: status, count: status.length });
});

app.post('/models/load', async (req, response) => {
  const { id, modelPath, port: requestedPort, args = [], backend: requestedBackend } = req.body;
  if (!id || !modelPath) return response.status(400).json({ error: 'Missing id or modelPath' });
  if (activeModels.has(id)) return response.status(409).json({ error: `Model ${id} is already loaded`, port: activeModels.get(id)?.port });

  // Resolve backend
  const backendName = (requestedBackend || 'Llama.cpp') as LocalBackend;
  const config = BACKEND_CONFIGS[backendName];
  if (!config) {
    return response.status(400).json({
      error: `Unsupported local backend: ${backendName}. Supported: ${Object.keys(BACKEND_CONFIGS).join(', ')}`,
    });
  }

  // Validate binary exists
  if (!fs.existsSync(config.binaryPath)) {
    return response.status(500).json({ error: `${backendName} binary not found at ${config.binaryPath}` });
  }

  // Resolve model path — some backends use tag names instead of file paths
  const absoluteModelPath = config.modelNameNotPath ? modelPath : resolveModelPath(modelPath);
  if (!config.modelNameNotPath && !fs.existsSync(absoluteModelPath)) {
    return response.status(404).json({ error: `Model file not found at ${absoluteModelPath}` });
  }

  // Validate auxiliary paths for llama.cpp-style backends
  const mutableArgs = [...args];
  if (backendName === 'Llama.cpp') {
    validateAuxPaths(mutableArgs);
  }

  const port = requestedPort || await getFreePort();
  log.info(`Starting ${backendName} model ${id} on port ${port}...`);
  log.info(`Model Path: ${absoluteModelPath}`);

  const launchArgs = config.buildArgs(absoluteModelPath, port, mutableArgs);
  log.info(`Launch args: ${launchArgs.join(' ')}`);

  const spawnCwd = config.cwd ? path.join(ROOT_DIR, config.cwd) : path.dirname(config.binaryPath);

  // Merge environment overrides
  const envOverrides = config.envOverrides ? config.envOverrides(port) : {};

  const proc = spawn(config.binaryPath, launchArgs, {
    cwd: spawnCwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...envOverrides },
  });

  const instance: ModelInstance = {
    id, process: proc, port, status: 'starting',
    modelPath: absoluteModelPath, backend: backendName, startTime: Date.now(),
  };
  activeModels.set(id, instance);

  proc.stdout?.on('data', (data) => {
    const str = data.toString().trim();
    if (str) log.backend(config.logLabel, `[${id}] ${str}`);
    if (config.readyPattern && config.readyPattern.test(str)) instance.status = 'ready';
  });

  proc.stderr?.on('data', (data) => {
    const str = data.toString().trim();
    if (!str) return;
    const lowerStr = str.toLowerCase();
    const isError = lowerStr.includes('error:') || lowerStr.includes('fatal') ||
      lowerStr.includes('failed to') || lowerStr.includes('exception') || lowerStr.includes('abort');
    const isFalsePositive = lowerStr.includes('was not control-type') || lowerStr.includes('overridden') ||
      lowerStr.includes('n_ctx_seq') || lowerStr.includes('no implementations specified') ||
      lowerStr.includes('already set by user');
    if (isError && !isFalsePositive) log.error(`[${config.logLabel}:${id}] ${str}`);
    else log.backend(config.logLabel, `[${id}] ${str}`);
  });

  proc.on('exit', (code) => {
    log.warn(`[${config.logLabel}:${id}] Process exited with code ${code}`);
    activeModels.delete(id);
  });

  const healthUrl = config.healthUrl(port);
  const isReady = await waitForModelReady(healthUrl);
  if (isReady) {
    instance.status = 'ready';
    log.success(`${backendName} model ${id} loaded successfully on port ${port}`);
    response.json({ success: true, id, port, status: 'ready', backend: backendName });
  } else {
    instance.status = 'error';
    log.error(`${backendName} model ${id} failed to start within timeout. Killing process.`);
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

  log.info(`Unloading ${instance.backend} model ${id}...`);
  instance.process.kill('SIGTERM');
  setTimeout(() => {
    if (instance.process.pid) {
      try { process.kill(instance.process.pid, 'SIGKILL'); } catch { /* may have already exited */ }
    }
  }, 2000);
  activeModels.delete(id);
  log.success(`${instance.backend} model ${id} unloaded`);
  response.json({ success: true, message: 'Model unloaded' });
});

app.all('/proxy/:modelId/{*path}', (req, response) => {
  const modelId = req.params.modelId;
  const remainingPath = (req.params as { path?: string }).path || '';
  const instance = activeModels.get(modelId);
  if (!instance || instance.status !== 'ready') {
    return response.status(503).json({ error: `Model ${modelId} is not loaded or ready` });
  }

  const targetUrl = `http://127.0.0.1:${instance.port}/${remainingPath}`;
  fetch(targetUrl, {
    method: req.method,
    headers: Object.fromEntries(
      Object.entries(req.headers).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, Array.isArray(value) ? value.join(', ') : value]],
      ),
    ),
    body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
  })
    .then(res => res.json())
    .then(data => response.json(data))
    .catch(error => response.status(502).json({ error: 'Proxy error', details: error.message }));
});

// --- GPU Status Endpoint ---

app.get('/gpu/status', (_req, response) => {
  const now = Date.now();

  // Rate-limit CLI queries to avoid hammering system tools
  if (now - lastGpuQueryTime < GPU_QUERY_MIN_INTERVAL_MS && lastGpuStatus) {
    response.json(lastGpuStatus);
    return;
  }

  const status = queryGpuStatus();
  if (status) {
    lastGpuStatus = status;
    lastGpuQueryTime = now;
    response.json(status);
  } else if (lastGpuStatus) {
    // Return stale cache rather than nothing
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
    const timeoutId = setTimeout(() => controller.abort(), 15000);
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
    const error = e instanceof Error ? e : new Error(String(e));
    const errorMsg = error.name === 'AbortError' ? 'Timeout' : error.message;
    log.reqError('FETCH', url, 0);
    log.warn(`Fetch failed for ${url}: ${errorMsg}`);
    response.json({ ok: false, status: 0, contentType: '', error: errorMsg });
  }
});

// --- Startup ---
const startServer = () => {
  // Detect GPU vendor once at startup
  detectedGpuVendor = detectGpuVendor();

  const border = "────────────────────────────────────────";
  const title = `${Colors.Bright}${Colors.FgCyan}⚛️  ${APP_NAME} Server${Colors.Reset}`;
  console.clear();
  console.log(`${Colors.BgBlue}${Colors.Bright}${Colors.FgWhite}  ${APP_NAME}  ${Colors.Reset}`);
  console.log(border);
  console.log(`  ${title}`);
  console.log(`  📂 Backends Dir: ${Colors.Dim}${path.join(ROOT_DIR, LOCAL_BACKENDS_PATH)}${Colors.Reset}`);
  for (const [name, cfg] of Object.entries(BACKEND_CONFIGS)) {
    const exists = fs.existsSync(cfg.binaryPath);
    const icon = exists ? `${Colors.FgGreen}●${Colors.Reset}` : `${Colors.FgRed}○${Colors.Reset}`;
    console.log(`     ${icon} ${(name as string).padEnd(16)} ${Colors.Dim}${cfg.binaryPath}${Colors.Reset}`);
  }
  console.log(border);
  console.log(`  📡 API Port:  ${Colors.FgGreen}http://127.0.0.1:${PORT}${Colors.Reset}`);
  console.log(`  💾 Data Path: ${Colors.Dim}/user_data/${Colors.Reset}`);
  console.log(`  🖥️  GPU Monitor: ${Colors.FgGreen}${detectedGpuVendor}${Colors.Reset} ${Colors.Dim}(GET /gpu/status)${Colors.Reset}`);
  console.log(border);
  console.log(`  ${Colors.FgGreen}●${Colors.Reset} System Ready.`);
  console.log(`  ${Colors.FgMagenta}●${Colors.Reset} Multi-Backend Model Control Enabled.`);
  console.log("");
  app.listen(PORT, '0.0.0.0', () => {});
};

startServer();