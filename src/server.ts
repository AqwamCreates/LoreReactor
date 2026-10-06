// src/server.ts
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import { spawn, spawnSync, execSync, type ChildProcess } from 'node:child_process';
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
import { activeWindow, openWindows } from 'get-windows';
import loudness from 'loudness';
import findDevices from 'local-devices';
import trash from 'trash';
import robot from '@jitsi/robotjs';
import sharp from 'sharp';

// --- Configuration ---
const app = express();
const PORT = 8448;
const ROOT_DIR = process.cwd();
const APP_NAME = "LoreReactor";

const LOCAL_LANGUAGE_MODEL_BACKENDS_PATH = 'local_language_model_backends';

// ── Platform helpers ────────────────────────────────────────────────
const IS_WINDOWS = process.platform === 'win32';
const IS_MACOS   = process.platform === 'darwin';

/** Append .exe on Windows, nothing on Linux/macOS */
function bin(name: string): string {
  return IS_WINDOWS ? `${name}.exe` : name;
}

/**
 * Resolve a Python interpreter path inside a backend directory.
 * Checks both direct root and isolated venv locations.
 */
function pythonBin(backendDir: string): string {
  const direct = path.join(ROOT_DIR, LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, backendDir, bin('python'));
  if (fs.existsSync(direct)) return direct;

  const venvScript = IS_WINDOWS
    ? path.join(ROOT_DIR, LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, backendDir, 'venv', 'Scripts', 'python.exe')
    : path.join(ROOT_DIR, LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, backendDir, 'venv', 'bin', 'python');
  if (fs.existsSync(venvScript)) return venvScript;

  return direct;
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
    binaryPath: path.join(ROOT_DIR, LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, 'llama', bin('llama-server')),
    buildArgs: (modelPath, port, extraArgs) => [
      '-m', modelPath, '--port', port.toString(), '--host', '0.0.0.0', ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/health`,
    cwd: path.join(LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, 'llama'),
    logLabel: 'LLAMA',
    readyPattern: /HTTP server listening/i,
  },

  'Transformers': {
    binaryPath: path.join(ROOT_DIR, LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, 'transformers', bin('text-generation-launcher')),
    buildArgs: (modelPath, port, extraArgs) => [
      '--model-id', modelPath, '--port', port.toString(), '--hostname', '0.0.0.0', ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/health`,
    cwd: path.join(LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, 'transformers'),
    logLabel: 'TGI',
    readyPattern: /Connected/i,
  },

  'ExLlamaV3': {
    binaryPath: pythonBin('exllamav3'),
    buildArgs: (modelPath, port, extraArgs) => [
      'start.py', '--model-dir', modelPath, '--port', port.toString(), '--host', '0.0.0.0', ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/v1/language_models`,
    cwd: path.join(LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, 'exllamav3'),
    logLabel: 'EXLV3',
    readyPattern: /Uvicorn running/i,
  },

  'ExLlamaV3 HF': {
    binaryPath: pythonBin('exllamav3_hf'),
    buildArgs: (modelPath, port, extraArgs) => [
      'start.py', '--model-dir', modelPath, '--port', port.toString(), '--host', '0.0.0.0', '--hf-model', ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/v1/language_models`,
    cwd: path.join(LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, 'exllamav3_hf'),
    logLabel: 'EXLV3HF',
    readyPattern: /Uvicorn running/i,
  },

  'ExLlamaV2': {
    binaryPath: pythonBin('exllamav2'),
    buildArgs: (modelPath, port, extraArgs) => [
      'start.py', '--model-dir', modelPath, '--port', port.toString(), '--host', '0.0.0.0', ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/v1/language_models`,
    cwd: path.join(LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, 'exllamav2'),
    logLabel: 'EXLV2',
    readyPattern: /Uvicorn running/i,
  },

  'TensorRT-LLM': {
    binaryPath: path.join(ROOT_DIR, LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, 'tensorrt-llm', bin('tritonserver')),
    buildArgs: (modelPath, port, extraArgs) => [
      '--model-repository', modelPath, '--http-port', port.toString(), ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/v2/health/ready`,
    cwd: path.join(LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, 'tensorrt-llm'),
    logLabel: 'TRTLLM',
    readyPattern: /Started HTTPService/i,
  },

  'Ollama': {
    binaryPath: path.join(ROOT_DIR, LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, 'ollama', bin('ollama')),
    buildArgs: (_modelPath, _port, _extraArgs) => ['serve'],
    healthUrl: (port) => `http://127.0.0.1:${port}/`,
    cwd: path.join(LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, 'ollama'),
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
    cwd: path.join(LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, 'vllm'),
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
    cwd: path.join(LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, 'sglang'),
    logLabel: 'SGLANG',
    readyPattern: /The server is fired up and ready/i,
  },

  'LM Studio': {
    binaryPath: path.join(ROOT_DIR, LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, 'lmstudio', bin('lms')),
    buildArgs: (_modelPath, port, extraArgs) => [
      'server', 'start', '--port', port.toString(), ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/v1/language_models`,
    cwd: path.join(LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, 'lmstudio'),
    logLabel: 'LMS',
    readyPattern: /Server started/i,
    modelNameNotPath: true,
  },

  'LocalAI': {
    binaryPath: path.join(ROOT_DIR, LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, 'localai', bin('local-ai')),
    buildArgs: (_modelPath, port, extraArgs) => [
      '--address', `0.0.0.0:${port}`, ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/readyz`,
    cwd: path.join(LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, 'localai'),
    logLabel: 'LOCAI',
    readyPattern: /LocalAI is ready|listening on/i,
    modelNameNotPath: true,
  },

  'mistral.rs': {
    binaryPath: path.join(ROOT_DIR, LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, 'mistral-rs', bin('mistralrs-server')),
    buildArgs: (modelPath, port, extraArgs) => [
      '--model-id', modelPath, '--port', port.toString(), '--host', '0.0.0.0', ...extraArgs,
    ],
    healthUrl: (port) => `http://127.0.0.1:${port}/v1/language_models`,
    cwd: path.join(LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, 'mistral-rs'),
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

// ─── Real-Time Notifications & SSE Dispatcher (/language_models/notify) ─

export interface BackendInstallNotification {
  backend: string;
  status: 'idle' | 'downloading' | 'extracting' | 'installing' | 'ready' | 'error';
  percent: number;
  message: string;
  timestamp: number;
}

const activeNotifications: Map<string, BackendInstallNotification> = new Map();
const notifySseClients: Set<express.Response> = new Set();

function broadcastNotify(
  backend: string,
  status: BackendInstallNotification['status'],
  percent: number,
  message: string
) {
  const notification: BackendInstallNotification = {
    backend,
    status,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    message,
    timestamp: Date.now(),
  };

  activeNotifications.set(backend, notification);
  log.info(`[Notify:${backend}] (${notification.percent}%) ${message}`);

  const payload = `data: ${JSON.stringify(notification)}\n\n`;
  for (const client of notifySseClients) {
    try {
      client.write(payload);
    } catch {
      notifyClientsClean(client);
    }
  }
}

function notifyClientsClean(client: express.Response) {
  notifySseClients.delete(client);
}

app.get('/language_models/notify', (req, res) => {
  if (req.headers.accept?.includes('text/event-stream')) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    notifySseClients.add(res);

    // Initial snapshot of active install statuses
    for (const notif of activeNotifications.values()) {
      res.write(`data: ${JSON.stringify(notif)}\n\n`);
    }

    req.on('close', () => notifyClientsClean(res));
  } else {
    res.json({
      success: true,
      notifications: Array.from(activeNotifications.values()),
    });
  }
});

app.post('/language_models/notify', (req, res) => {
  const { backend = 'General', status = 'downloading', percent = 0, message = '' } = req.body;
  broadcastNotify(backend, status, percent, message);
  res.json({ success: true });
});

// ─── Automated On-Demand Installer Utilities ────────────────────────

function ensureDirectory(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function downloadFileWithProgress(
  url: string,
  destPath: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': 'LoreReactor/1.0' } });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download from ${url}: HTTP ${res.status}`);
  }

  const total = Number(res.headers.get('content-length')) || 0;
  let loaded = 0;

  const fileStream = fs.createWriteStream(destPath);
  const reader = res.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      loaded += value.length;
      fileStream.write(Buffer.from(value));
      if (onProgress && total > 0) {
        onProgress(loaded, total);
      }
    }
  }

  await new Promise<void>((resolve, reject) => {
    fileStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
  });
}

function extractArchive(archivePath: string, destDir: string): void {
  ensureDirectory(destDir);
  const ext = path.extname(archivePath).toLowerCase();

  if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    execSync(`tar -xzf "${archivePath}" -C "${destDir}"`, { stdio: 'pipe' });
  } else if (ext === '.zip') {
    if (IS_WINDOWS) {
      try {
        execSync(`tar -xf "${archivePath}" -C "${destDir}"`, { stdio: 'pipe' });
      } catch {
        execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`, { stdio: 'pipe' });
      }
    } else {
      try {
        execSync(`unzip -o "${archivePath}" -d "${destDir}"`, { stdio: 'pipe' });
      } catch {
        execSync(`tar -xf "${archivePath}" -C "${destDir}"`, { stdio: 'pipe' });
      }
    }
  }
}

/**
 * Bootstrap Astral's standalone `uv` executable.
 * Eliminates system Python requirements completely for Python backends.
 */
async function ensureUv(): Promise<string> {
  const uvDir = path.join(ROOT_DIR, LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, 'tools', 'uv');
  const uvBinary = path.join(uvDir, bin('uv'));

  if (fs.existsSync(uvBinary)) return uvBinary;

  broadcastNotify('uv', 'downloading', 10, 'Bootstrapping standalone Python manager (uv)...');
  ensureDirectory(uvDir);

  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  let asset = '';

  if (IS_WINDOWS) {
    asset = 'uv-x86_64-pc-windows-msvc.zip';
  } else if (IS_MACOS) {
    asset = `uv-${arch}-apple-darwin.tar.gz`;
  } else {
    asset = `uv-${arch}-unknown-linux-gnu.tar.gz`;
  }

  const uvUrl = `https://github.com/astral-sh/uv/releases/latest/download/${asset}`;
  const tempArchive = path.join(uvDir, `uv_archive${path.extname(asset)}`);

  await downloadFileWithProgress(uvUrl, tempArchive, (loaded, total) => {
    const pct = Math.round((loaded / total) * 100);
    broadcastNotify('uv', 'downloading', pct, `Downloading uv installer: ${pct}%`);
  });

  broadcastNotify('uv', 'extracting', 90, 'Extracting uv standalone binary...');
  extractArchive(tempArchive, uvDir);
  try { fs.unlinkSync(tempArchive); } catch {}

  // Find extracted uv binary if nested
  if (!fs.existsSync(uvBinary)) {
    for (const f of fs.readdirSync(uvDir)) {
      const nested = path.join(uvDir, f, bin('uv'));
      if (fs.existsSync(nested)) {
        fs.copyFileSync(nested, uvBinary);
        break;
      }
    }
  }

  if (!IS_WINDOWS && fs.existsSync(uvBinary)) {
    fs.chmodSync(uvBinary, 0o755);
  }

  broadcastNotify('uv', 'ready', 100, 'Standalone Python manager initialized.');
  return uvBinary;
}

/**
 * Primary On-Demand Installer Orchestrator
 */
async function installBackendOnDemand(backend: LocalBackend): Promise<void> {
  const destDir = path.join(ROOT_DIR, LOCAL_LANGUAGE_MODEL_BACKENDS_PATH, BACKEND_CONFIGS[backend].cwd || '');
  ensureDirectory(destDir);

  log.info(`[AutoInstaller] Initiating on-demand setup for "${backend}"...`);
  broadcastNotify(backend, 'downloading', 0, `Initializing setup for ${backend}...`);

  // 1. LLAMA.CPP
  if (backend === 'Llama.cpp') {
    broadcastNotify(backend, 'downloading', 5, 'Resolving latest Llama.cpp release assets...');
    const releaseRes = await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases/latest', {
      headers: { 'User-Agent': 'LoreReactor/1.0' }
    });
    const release = await releaseRes.json();
    const tag = release.tag_name || 'latest';
    const tagNorm = tag.replace(/-/g, '_');

    let assetPattern = /bin-win-avx2-x64\.zip$/i;
    if (IS_WINDOWS) {
      if (detectedGpuVendor === 'nvidia') assetPattern = /bin-win-cuda-.*-x64\.zip$/i;
      else if (detectedGpuVendor === 'amd' || detectedGpuVendor === 'intel') assetPattern = /bin-win-vulkan-x64\.zip$/i;
    } else if (IS_MACOS) {
      assetPattern = /bin-macos-universal\.tar\.gz$/i;
    } else {
      if (detectedGpuVendor === 'nvidia') assetPattern = /bin-ubuntu-cuda-.*-x64\.tar\.gz$/i;
      else if (detectedGpuVendor === 'amd' || detectedGpuVendor === 'intel') assetPattern = /bin-ubuntu-vulkan-x64\.tar\.gz$/i;
      else assetPattern = /bin-ubuntu-avx2-x64\.tar\.gz$/i;
    }

    const asset = release.assets.find((a: any) => assetPattern.test(a.name))
      || release.assets.find((a: any) => /avx2|universal/i.test(a.name));

    if (!asset?.browser_download_url) throw new Error(`Could not locate suitable Llama.cpp binary release asset.`);

    const tempPath = path.join(destDir, `llama_pkg_${Date.now()}${path.extname(asset.name)}`);
    await downloadFileWithProgress(asset.browser_download_url, tempPath, (loaded, total) => {
      const pct = Math.round((loaded / total) * 100);
      broadcastNotify(backend, 'downloading', pct, `Downloading Llama.cpp (${(loaded / 1048576).toFixed(1)}MB / ${(total / 1048576).toFixed(1)}MB)`);
    });

    broadcastNotify(backend, 'extracting', 95, 'Extracting Llama.cpp binaries...');
    extractArchive(tempPath, destDir);
    try { fs.unlinkSync(tempPath); } catch {}

    // Lift nested llama-server binary if extracted in build/bin
    const binaryName = bin('llama-server');
    const nestedBinary = path.join(destDir, 'build', 'bin', binaryName);
    if (fs.existsSync(nestedBinary)) {
      fs.copyFileSync(nestedBinary, path.join(destDir, binaryName));
    }
    if (!IS_WINDOWS && fs.existsSync(path.join(destDir, binaryName))) {
      fs.chmodSync(path.join(destDir, binaryName), 0o755);
    }
  }

  // 2. MISTRAL.RS
  else if (backend === 'mistral.rs') {
    broadcastNotify(backend, 'downloading', 5, 'Resolving mistral.rs release assets...');
    const releaseRes = await fetch('https://api.github.com/repos/EricLBuehler/mistral.rs/releases/latest', {
      headers: { 'User-Agent': 'LoreReactor/1.0' }
    });
    const release = await releaseRes.json();

    let assetPattern = IS_WINDOWS
      ? (detectedGpuVendor === 'nvidia' ? /cuda\.exe$/i : /windows.*\.exe$/i)
      : (detectedGpuVendor === 'nvidia' ? /linux-gnu-cuda$/i : /linux-gnu$/i);

    if (IS_MACOS) assetPattern = /apple-darwin$/i;

    const asset = release.assets.find((a: any) => assetPattern.test(a.name)) || release.assets[0];
    if (!asset?.browser_download_url) throw new Error('Could not find mistral.rs asset.');

    const targetBinary = path.join(destDir, bin('mistralrs-server'));
    await downloadFileWithProgress(asset.browser_download_url, targetBinary, (loaded, total) => {
      const pct = Math.round((loaded / total) * 100);
      broadcastNotify(backend, 'downloading', pct, `Downloading mistral.rs binary: ${pct}%`);
    });

    if (!IS_WINDOWS) fs.chmodSync(targetBinary, 0o755);
  }

  // 3. OLLAMA
  else if (backend === 'Ollama') {
    broadcastNotify(backend, 'downloading', 10, 'Fetching portable Ollama binary...');
    if (IS_WINDOWS) {
      const zipUrl = 'https://ollama.com/download/ollama-windows-amd64.zip';
      const tempZip = path.join(destDir, 'ollama.zip');
      await downloadFileWithProgress(zipUrl, tempZip, (loaded, total) => {
        const pct = Math.round((loaded / total) * 100);
        broadcastNotify(backend, 'downloading', pct, `Downloading Ollama runtime: ${pct}%`);
      });
      extractArchive(tempZip, destDir);
      try { fs.unlinkSync(tempZip); } catch {}
    } else {
      execSync('curl -fsSL https://ollama.com/install.sh | sh', { stdio: 'inherit' });
      const systemOllama = execSync('which ollama').toString().trim();
      if (systemOllama) fs.copyFileSync(systemOllama, path.join(destDir, 'ollama'));
    }
  }

  // 4. LM STUDIO (CLI)
  else if (backend === 'LM Studio') {
    broadcastNotify(backend, 'installing', 30, 'Installing LM Studio CLI (lms)...');
    execSync('npx --yes lmstudio install-cli', { stdio: 'pipe' });
    const whichLms = IS_WINDOWS ? execSync('where lms').toString().split('\r\n')[0] : execSync('which lms').toString().trim();
    if (whichLms && fs.existsSync(whichLms)) {
      fs.copyFileSync(whichLms, path.join(destDir, bin('lms')));
    }
  }

  // 5. LOCALAI
  else if (backend === 'LocalAI') {
    broadcastNotify(backend, 'downloading', 10, 'Locating prebuilt LocalAI distribution...');
    const releaseRes = await fetch('https://api.github.com/repos/mudler/LocalAI/releases/latest', {
      headers: { 'User-Agent': 'LoreReactor/1.0' }
    });
    const release = await releaseRes.json();
    const asset = release.assets.find((a: any) => /Linux-x86_64|Darwin-arm64|windows/i.test(a.name));
    if (!asset) throw new Error('LocalAI prebuilt asset not found.');

    const target = path.join(destDir, bin('local-ai'));
    await downloadFileWithProgress(asset.browser_download_url, target, (loaded, total) => {
      const pct = Math.round((loaded / total) * 100);
      broadcastNotify(backend, 'downloading', pct, `Downloading LocalAI: ${pct}%`);
    });
    if (!IS_WINDOWS) fs.chmodSync(target, 0o755);
  }

  // 6. EXLLAMAV2 / EXLLAMAV3 / EXLLAMAV3 HF (Headless via TabbyAPI + uv)
  else if (backend === 'ExLlamaV2' || backend === 'ExLlamaV3' || backend === 'ExLlamaV3 HF') {
    const uvBin = await ensureUv();
    broadcastNotify(backend, 'downloading', 20, 'Downloading TabbyAPI engine code...');

    const zipUrl = 'https://github.com/theroyallab/tabbyAPI/archive/refs/heads/main.zip';
    const tempZip = path.join(destDir, 'tabby.zip');
    await downloadFileWithProgress(zipUrl, tempZip);
    extractArchive(tempZip, destDir);
    try { fs.unlinkSync(tempZip); } catch {}

    const extractedFolder = path.join(destDir, 'tabbyAPI-main');
    if (fs.existsSync(extractedFolder)) {
      for (const item of fs.readdirSync(extractedFolder)) {
        fs.renameSync(path.join(extractedFolder, item), path.join(destDir, item));
      }
      try { fs.rmdirSync(extractedFolder); } catch {}
    }

    broadcastNotify(backend, 'installing', 40, 'Installing isolated Python 3.11 environment via uv...');
    execSync(`"${uvBin}" python install 3.11`, { stdio: 'pipe' });
    execSync(`"${uvBin}" venv "${path.join(destDir, 'venv')}" --python 3.11`, { stdio: 'pipe' });

    broadcastNotify(backend, 'installing', 60, 'Installing ExLlama runtime dependencies (PyTorch/CUDA wheels)...');
    execSync(`"${uvBin}" pip --python "${path.join(destDir, 'venv')}" install -r "${path.join(destDir, 'requirements.txt')}"`, { stdio: 'pipe' });

    // Link Python directly inside backend directory root
    const venvPy = IS_WINDOWS ? path.join(destDir, 'venv', 'Scripts', 'python.exe') : path.join(destDir, 'venv', 'bin', 'python');
    const rootPy = path.join(destDir, bin('python'));
    if (fs.existsSync(venvPy) && !fs.existsSync(rootPy)) {
      fs.copyFileSync(venvPy, rootPy);
    }
  }

  // 7. VLLM (Headless via uv)
  else if (backend === 'vLLM') {
    const uvBin = await ensureUv();
    broadcastNotify(backend, 'installing', 25, 'Provisioning portable Python 3.11 for vLLM...');
    execSync(`"${uvBin}" python install 3.11`, { stdio: 'pipe' });
    execSync(`"${uvBin}" venv "${path.join(destDir, 'venv')}" --python 3.11`, { stdio: 'pipe' });

    broadcastNotify(backend, 'installing', 50, 'Fetching vLLM high-throughput engine wheels (this may take a moment)...');
    execSync(`"${uvBin}" pip --python "${path.join(destDir, 'venv')}" install vllm`, { stdio: 'pipe' });

    const venvPy = IS_WINDOWS ? path.join(destDir, 'venv', 'Scripts', 'python.exe') : path.join(destDir, 'venv', 'bin', 'python');
    const rootPy = path.join(destDir, bin('python'));
    if (fs.existsSync(venvPy) && !fs.existsSync(rootPy)) fs.copyFileSync(venvPy, rootPy);
  }

  // 8. SGLANG (Headless via uv)
  else if (backend === 'SGLang') {
    const uvBin = await ensureUv();
    broadcastNotify(backend, 'installing', 25, 'Provisioning isolated Python environment for SGLang...');
    execSync(`"${uvBin}" python install 3.11`, { stdio: 'pipe' });
    execSync(`"${uvBin}" venv "${path.join(destDir, 'venv')}" --python 3.11`, { stdio: 'pipe' });

    broadcastNotify(backend, 'installing', 50, 'Installing sglang[srt] optimized runtime...');
    execSync(`"${uvBin}" pip --python "${path.join(destDir, 'venv')}" install "sglang[srt]"`, { stdio: 'pipe' });

    const venvPy = IS_WINDOWS ? path.join(destDir, 'venv', 'Scripts', 'python.exe') : path.join(destDir, 'venv', 'bin', 'python');
    const rootPy = path.join(destDir, bin('python'));
    if (fs.existsSync(venvPy) && !fs.existsSync(rootPy)) fs.copyFileSync(venvPy, rootPy);
  }

  // 9. DOCKER CONTAINERS (TensorRT-LLM & Transformers/TGI)
  else if (backend === 'TensorRT-LLM' || backend === 'Transformers') {
    broadcastNotify(backend, 'installing', 20, `Verifying Docker engine for ${backend}...`);
    try {
      execSync('docker --version', { stdio: 'pipe' });
    } catch {
      throw new Error(`Docker is required for ${backend}. Please install Docker Desktop and configure NVIDIA Container Toolkit.`);
    }

    const image = backend === 'TensorRT-LLM'
      ? 'nvcr.io/nvidia/tritonserver:24.05-trtllm-python-backend'
      : 'ghcr.io/huggingface/text-generation-inference:latest';

    broadcastNotify(backend, 'downloading', 40, `Pulling container image: ${image}...`);
    execSync(`docker pull ${image}`, { stdio: 'inherit' });

    // Generate a lightweight executable script wrapper for uniform execution
    const wrapperPath = BACKEND_CONFIGS[backend].binaryPath;
    if (IS_WINDOWS) {
      fs.writeFileSync(wrapperPath, `@echo off\ndocker run --gpus all --rm ${image} %*\n`, 'utf-8');
    } else {
      fs.writeFileSync(wrapperPath, `#!/bin/sh\nexec docker run --gpus all --rm ${image} "$@"\n`, 'utf-8');
      fs.chmodSync(wrapperPath, 0o755);
    }
  }

  broadcastNotify(backend, 'ready', 100, `${backend} is installed and ready.`);
  log.success(`[AutoInstaller] ${backend} installed successfully!`);
}

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

// ─── Virtual Controller State (ViGEmBus / XInput) ────────────────────
let ViGEmClient: any = null;
let vigemBus: any = null;
let x360Controller: any = null;
let vigemInitError: string | null = null;

// Valid native button names on controller.button for X360Controller
const X360_BUTTON_MAP: Record<string, string> = {
  'A': 'A',
  'B': 'B',
  'X': 'X',
  'Y': 'Y',
  'LB': 'LEFT_SHOULDER',
  'L1': 'LEFT_SHOULDER',
  'LEFT_SHOULDER': 'LEFT_SHOULDER',
  'RB': 'RIGHT_SHOULDER',
  'R1': 'RIGHT_SHOULDER',
  'RIGHT_SHOULDER': 'RIGHT_SHOULDER',
  'START': 'START',
  'MENU': 'START',
  'BACK': 'BACK',
  'SELECT': 'BACK',
  'VIEW': 'BACK',
  'GUIDE': 'GUIDE',
  'HOME': 'GUIDE',
  'LS': 'LEFT_THUMB',
  'L3': 'LEFT_THUMB',
  'L_STICK': 'LEFT_THUMB',
  'LEFT_STICK': 'LEFT_THUMB',
  'LEFT_THUMB': 'LEFT_THUMB',
  'RS': 'RIGHT_THUMB',
  'R3': 'RIGHT_THUMB',
  'R_STICK': 'RIGHT_THUMB',
  'RIGHT_STICK': 'RIGHT_THUMB',
  'RIGHT_THUMB': 'RIGHT_THUMB',
};

const DPAD_DIRECTIONS = new Set([
  'UP', 'DOWN', 'LEFT', 'RIGHT',
  'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT'
]);

function getOrInitVirtualController(): { controller: any; error: string | null } {
  if (!IS_WINDOWS) {
    return { controller: null, error: 'Virtual controller is currently supported on Windows only (requires ViGEmBus).' };
  }
  if (x360Controller) {
    return { controller: x360Controller, error: null };
  }

  try {
    if (!ViGEmClient) {
      ViGEmClient = require('vigemclient');
    }
    if (!vigemBus) {
      vigemBus = new ViGEmClient();
      const connectErr = vigemBus.connect();
      if (connectErr) {
        vigemBus = null;
        vigemInitError = `ViGEmBus connection failed: ${connectErr.message || connectErr}. Ensure ViGEmBus driver is installed.`;
        log.warn(`[ViGEm] ${vigemInitError}`);
        return { controller: null, error: vigemInitError };
      }
    }

    const ctrl = vigemBus.createX360Controller();
    const targetErr = ctrl.connect();
    if (targetErr) {
      vigemInitError = `Failed to connect virtual controller target: ${targetErr.message || targetErr}`;
      log.warn(`[ViGEm] ${vigemInitError}`);
      return { controller: null, error: vigemInitError };
    }

    x360Controller = ctrl;
    vigemInitError = null;
    log.success('🎮 Virtual Xbox 360 Controller connected to ViGEmBus');
    return { controller: x360Controller, error: null };
  } catch (err: any) {
    vigemInitError = `vigemclient not available: ${err.message}. Install 'vigemclient' and the ViGEmBus driver.`;
    log.warn(`[ViGEm] ${vigemInitError}`);
    return { controller: null, error: vigemInitError };
  }
}

function cleanupVirtualController() {
  if (x360Controller) {
    try {
      x360Controller.disconnect();
      log.info('🎮 Virtual controller disconnected cleanly.');
    } catch {}
    x360Controller = null;
  }
}
process.on('SIGINT', () => { cleanupVirtualController(); process.exit(0); });
process.on('SIGTERM', () => { cleanupVirtualController(); process.exit(0); });
process.on('exit', () => { cleanupVirtualController(); });

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
    } catch { /* ignore */ }

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

const MEDIA_DIR_PREFIXES = [
  'character_images/',
  'character_voices/',
  'multiplayer_character_images/',
  'multiplayer_character_voices/',
  'context_images/',
  'location_images/',
  'audio_track_audio/',
  'prompt_block_images/',
  'factorization_machine_data/',
  'screenshots/',
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
  'language_model_data',
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

        if (chat.interactionHistories && typeof chat.interactionHistories === 'object') {
          for (const locId in chat.interactionHistories) {
            const msgIds = chat.interactionHistories[locId];
            if (Array.isArray(msgIds)) {
              for (const msgId of msgIds) {
                if (typeof msgId === 'string') referencedMessageIds.add(msgId);
              }
            }
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
      } catch { /* skip */ }
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
    } catch { /* skip */ }
  }

  if (hollowCount > 0) {
    log.warn(`Sanitized interaction_messages/: removed ${hollowCount} hollow message file${hollowCount === 1 ? '' : 's'}`);
  }

  return hollowCount;
}

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

      if (chat.interactionHistories && typeof chat.interactionHistories === 'object') {
        let pruned = 0;
        let changed = false;
        for (const locId in chat.interactionHistories) {
          if (Array.isArray(chat.interactionHistories[locId])) {
            const originalLength = chat.interactionHistories[locId].length;
            chat.interactionHistories[locId] = chat.interactionHistories[locId].filter(
              (id: unknown) => typeof id === 'string' && existingMessageIds.has(id)
            );
            const diff = originalLength - chat.interactionHistories[locId].length;
            if (diff > 0) {
              pruned += diff;
              changed = true;
            }
          }
        }
        if (changed) {
          fs.writeFileSync(filePath, JSON.stringify(chat, null, 2), 'utf-8');
          totalPruned += pruned;
        }
      }
    } catch { /* skip */ }
  }

  if (totalPruned > 0) {
    log.warn(`Sanitized chat histories: pruned ${totalPruned} dangling message reference${totalPruned === 1 ? '' : 's'}`);
  }

  return totalPruned;
}

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

// --- /search Route ---
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

        if (chatName.toLowerCase().includes(lowerQuery)) {
          chatResults.push({ type: 'chat', id: chatId, name: chatName });
        }

        if (chat.interactionHistories && typeof chat.interactionHistories === 'object') {
          for (const locId in chat.interactionHistories) {
            const msgIds = chat.interactionHistories[locId];
            if (Array.isArray(msgIds)) {
              for (const msgId of msgIds) {
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
          }
        }
      } catch { /* skip */ }
    }
  }

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
      } catch { /* skip */ }
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

// --- Language Model Management ---

app.get('/language_models/status', (_req, response) => {
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

app.post('/language_models/load', async (req, response) => {
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

  // ─── On-Demand Automatic Provisioning Hook ──────────────────────────
  if (!fs.existsSync(config.binaryPath)) {
    log.info(`Backend binary for "${backendName}" not found at ${config.binaryPath}. Triggering automated on-demand installation...`);
    try {
      await installBackendOnDemand(backendName);
    } catch (installErr: any) {
      broadcastNotify(backendName, 'error', 0, `On-demand installation failed: ${installErr.message}`);
      return response.status(500).json({
        error: `Automated on-demand installation of "${backendName}" failed: ${installErr.message}`,
      });
    }

    if (!fs.existsSync(config.binaryPath)) {
      return response.status(500).json({
        error: `${backendName} installation routine completed, but executable was not found at ${config.binaryPath}.`,
      });
    }
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
      log.backend(config.logLabel, `[id] ${str}`);
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

app.post('/language_models/unload', (req, response) => {
  const { id } = req.body;
  if (!id) return response.status(400).json({ error: 'Missing id' });

  const instance = activeModels.get(id);
  if (!instance) return response.status(404).json({ error: `Model ${id} not found` });

  log.info(`Unloading ${instance.backend} model "${id}" ...`);

  if (IS_WINDOWS) {
    try {
      execSync(`taskkill /PID ${instance.process.pid} /T /F`, { stdio: 'pipe' });
    } catch { /* ignore */ }
  } else {
    instance.process.kill('SIGTERM');
    setTimeout(() => {
      if (instance.process.pid) {
        try { process.kill(instance.process.pid, 'SIGKILL'); } catch { /* ignore */ }
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

app.post('/tool/text_to_speech/start', (req, res) => {
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
      sound: true,
      wait: false
    },
    (err) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, message: 'Notification sent' });
    }
  );
});

app.post('/tool/volume', async (req, res) => {
  const { action, level } = req.body;
  try {
    if (action === 'get') {
      const vol = await loudness.getVolume();
      const muted = await loudness.getMuted();
      return res.json({ success: true, volume: vol, muted });
    }
    if (action === 'set') {
      const num = Math.max(0, Math.min(100, Number(level) || 0));
      await loudness.setVolume(num);
      return res.json({ success: true, volume: num });
    }
    if (action === 'mute') {
      await loudness.setMuted(true);
      return res.json({ success: true, muted: true });
    }
    if (action === 'unmute') {
      await loudness.setMuted(false);
      return res.json({ success: true, muted: false });
    }
    res.status(400).json({ success: false, error: 'Invalid action. Use get, set, mute, or unmute.' });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

app.post('/tool/lock-screen', (_req, res) => {
  try {
    if (IS_WINDOWS) {
      execSync('rundll32.exe user32.dll,LockWorkStation');
    } else if (IS_MACOS) {
      execSync('pmset displaysleepnow');
    } else {
      execSync('xdg-screensaver lock || loginctl lock-session');
    }
    res.json({ success: true, message: 'Workstation locked' });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

// ── OS Power Control (sleep, shutdown, restart) ─────────────────────
app.post('/tool/power', (req, res) => {
  const { action } = req.body;
  if (!['sleep', 'shutdown', 'restart'].includes(action)) {
    return res.status(400).json({ success: false, error: 'Invalid power action' });
  }

  try {
    log.warn(`⚠️ SYSTEM POWER COMMAND INVOKED BY AI: ${action.toUpperCase()}`);

    if (IS_WINDOWS) {
      if (action === 'shutdown') execSync('shutdown /s /t 5');
      else if (action === 'restart') execSync('shutdown /r /t 5');
      else if (action === 'sleep') execSync('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
    } else if (IS_MACOS) {
      if (action === 'shutdown') execSync('osascript -e \'tell application "System Events" to shut down\'');
      else if (action === 'restart') execSync('osascript -e \'tell application "System Events" to restart\'');
      else if (action === 'sleep') execSync('pmset sleepnow');
    } else {
      if (action === 'shutdown') execSync('systemctl poweroff');
      else if (action === 'restart') execSync('systemctl reboot');
      else if (action === 'sleep') execSync('systemctl suspend');
    }

    res.json({ success: true, message: `System power action triggered: ${action}` });
  } catch (error) {
    log.error(`Power action failed: ${(error as Error).message}`);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post('/tool/clipboard', async (req, res) => {
  const { action, text } = req.body;

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

app.post('/tool/screenshot', async (req, res) => {
  try {
    const { characterId } = req.body;
    const screenshotDir = path.join(ROOT_DIR, 'user_data', 'screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    const imgBuffer = await screenshot({ format: 'jpg' });

    const cleanCharId = characterId ? `${String(characterId).replace(/[^a-zA-Z0-9_-]/g, '')}_` : '';
    const filename = `screenshot_${cleanCharId}${Date.now()}.jpg`;
    const filePath = path.join(screenshotDir, filename);
    fs.writeFileSync(filePath, imgBuffer);

    const base64Image = imgBuffer.toString('base64');

    res.json({
      success: true,
      contentType: 'image/jpeg',
      base64: base64Image,
      path: filePath
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.get('/tool/network', async (_req, res) => {
  try {
    const devices = await findDevices();
    res.json({ success: true, devices });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
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
      if (fileChangeEvents.length > 50) fileChangeEvents.shift();
    });

    activeWatchers.set(targetDir, watcher);
    log.info(`File watcher started on: ${targetDir}`);
    res.json({ success: true, path: targetDir });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.get('/tool/file-watcher/events', (_req, res) => {
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

app.post('/tool/trash', async (req, res) => {
  const { targetPath } = req.body;
  if (!targetPath) return res.status(400).json({ success: false, error: 'Missing targetPath' });

  try {
    const resolved = path.isAbsolute(targetPath) ? targetPath : path.join(ROOT_DIR, targetPath);
    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ success: false, error: `Path does not exist: ${resolved}` });
    }
    await trash([resolved]);
    res.json({ success: true, path: resolved, message: 'Item moved to recycle bin/trash' });
  } catch (e) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

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

const PITCH_CLASSES = [
  { sharp: 'C',  flat: 'C',  dual: 'C',       solfege: 'Do' },
  { sharp: 'C#', flat: 'Db', dual: 'C#/Db',   solfege: 'Do#' },
  { sharp: 'D',  flat: 'D',  dual: 'D',       solfege: 'Re' },
  { sharp: 'D#', flat: 'Eb', dual: 'D#/Eb',   solfege: 'Re#' },
  { sharp: 'E',  flat: 'E',  dual: 'E',       solfege: 'Mi' },
  { sharp: 'F',  flat: 'F',  dual: 'F',       solfege: 'Fa' },
  { sharp: 'F#', flat: 'Gb', dual: 'F#/Gb',   solfege: 'Fa#' },
  { sharp: 'G',  flat: 'G',  dual: 'G',       solfege: 'Sol' },
  { sharp: 'G#', flat: 'Ab', dual: 'G#/Ab',   solfege: 'Sol#' },
  { sharp: 'A',  flat: 'A',  dual: 'A',       solfege: 'La' },
  { sharp: 'A#', flat: 'Bb', dual: 'A#/Bb',   solfege: 'La#' },
  { sharp: 'B',  flat: 'B',  dual: 'B',       solfege: 'Ti' },
] as const;

let serverHearingProcess: ChildProcess | null = null;
let serverHearingChunks: Buffer[] = [];
let serverHearingTimer: NodeJS.Timeout | null = null;
let isServerHearingActive = false;

function serverDetectPitch(buffer: Float32Array, sampleRate: number): { pitch: number; clarity: number } | null {
  const size = buffer.length;
  let sumOfSquares = 0;
  for (let i = 0; i < size; i++) sumOfSquares += buffer[i] * buffer[i];
  const rms = Math.sqrt(sumOfSquares / size);
  if (rms < 0.015) return null;

  const windowSize = Math.floor(size / 2);
  const minLag = Math.max(2, Math.floor(sampleRate / 8000));
  const maxLag = Math.min(windowSize - 1, Math.ceil(sampleRate / 16));
  if (minLag >= maxLag) return null;

  const nsdf = new Float32Array(maxLag + 1);
  let m0 = 0;
  for (let j = 0; j < windowSize; j++) m0 += buffer[j] * buffer[j] + buffer[j] * buffer[j];

  let runningM = m0;
  for (let tau = 1; tau <= maxLag; tau++) {
    const prevSample = buffer[tau - 1];
    const nextSample = buffer[tau + windowSize - 1];
    runningM = runningM - (prevSample * prevSample) + (nextSample * nextSample);

    if (tau >= minLag) {
      let r = 0;
      for (let j = 0; j < windowSize; j++) r += buffer[j] * buffer[j + tau];
      nsdf[tau] = runningM > 0 ? (2 * r) / runningM : 0;
    }
  }

  const localPeaks: number[] = [];
  let globalMaxVal = 0;
  for (let tau = minLag; tau < maxLag; tau++) {
    if (nsdf[tau] > 0) {
      if (nsdf[tau] > nsdf[tau - 1] && nsdf[tau] >= nsdf[tau + 1]) {
        localPeaks.push(tau);
        if (nsdf[tau] > globalMaxVal) globalMaxVal = nsdf[tau];
      }
    }
  }

  if (globalMaxVal < 0.65 || localPeaks.length === 0) return null;

  const peakThreshold = globalMaxVal * 0.85;
  let chosenPeak = localPeaks[0];
  for (const peak of localPeaks) {
    if (nsdf[peak] >= peakThreshold) {
      chosenPeak = peak;
      break;
    }
  }

  const y0 = nsdf[chosenPeak - 1];
  const y1 = nsdf[chosenPeak];
  const y2 = nsdf[chosenPeak + 1];
  const denom = y0 - 2 * y1 + y2;
  const delta = denom !== 0 ? (y0 - y2) / (2 * denom) : 0;
  const refinedLag = chosenPeak + delta;
  if (refinedLag <= 0) return null;

  const fundamentalFreq = sampleRate / refinedLag;
  if (fundamentalFreq < 16 || fundamentalFreq > 8000) return null;

  return { pitch: fundamentalFreq, clarity: Math.max(0, Math.min(1, y1 - 0.25 * (y0 - y2) * delta)) };
}

function serverFrequencyToRichNote(freq: number): string | null {
  if (freq < 16 || freq > 8000) return null;
  const exactMidi = 12 * Math.log2(freq / 440) + 69;
  const roundedMidi = Math.round(exactMidi);
  const cents = Math.round((exactMidi - roundedMidi) * 100);
  if (Math.abs(cents) > 35) return null;

  const pitchClass = ((roundedMidi % 12) + 12) % 12;
  const octave = Math.floor(roundedMidi / 12) - 1;
  const info = PITCH_CLASSES[pitchClass];
  const centsTag = Math.abs(cents) >= 5 ? `(${cents > 0 ? '+' : ''}${cents}¢)` : '';
  return `${info.dual}${octave}${centsTag}`;
}

function stopServerHearingStream(): void {
  if (serverHearingTimer) {
    clearTimeout(serverHearingTimer);
    serverHearingTimer = null;
  }
  if (serverHearingProcess) {
    try {
      serverHearingProcess.kill('SIGTERM');
    } catch {}
    serverHearingProcess = null;
  }
  isServerHearingActive = false;
}

app.post('/tool/virtual-hearing', (req, res) => {
  const { action = 'start', duration = 30 } = req.body;
  const normalizedAction = String(action).toLowerCase();

  // 1. START LISTENING SESSION
  if (normalizedAction === 'start') {
    stopServerHearingStream();

    serverHearingChunks = [];
    isServerHearingActive = true;

    const durationSec = Math.max(5, Math.min(120, Number(duration) || 30));

    const audioArgs = IS_WINDOWS
      ? ['-y', '-f', 'wasapi', '-i', 'default', '-t', durationSec.toString(), '-ar', '16000', '-ac', '1', '-f', 'f32le', 'pipe:1']
      : IS_MACOS
      ? ['-y', '-f', 'avfoundation', '-i', ':default', '-t', durationSec.toString(), '-ar', '16000', '-ac', '1', '-f', 'f32le', 'pipe:1']
      : ['-y', '-f', 'pulse', '-i', 'default', '-t', durationSec.toString(), '-ar', '16000', '-ac', '1', '-f', 'f32le', 'pipe:1'];

    try {
      serverHearingProcess = spawn('ffmpeg', audioArgs, { stdio: ['ignore', 'pipe', 'ignore'] });

      serverHearingProcess.stdout?.on('data', (data: Buffer) => {
        if (isServerHearingActive) {
          serverHearingChunks.push(data);
        }
      });

      serverHearingProcess.on('error', (err) => {
        log.warn(`[VirtualHearing] FFmpeg loopback error: ${err.message}`);
        stopServerHearingStream();
      });

      serverHearingTimer = setTimeout(() => {
        stopServerHearingStream();
      }, durationSec * 1000);

      return res.json({
        success: true,
        active: true,
        message: `Ears opened on host server. Actively recording desktop audio for up to ${durationSec}s. Call action="stop" or action="end" when finished.`,
      });
    } catch (err: any) {
      stopServerHearingStream();
      return res.status(500).json({ success: false, error: `Failed to start server audio capture: ${err.message}` });
    }
  }

  // 2. STOP / END LISTENING SESSION & PROCESS CAPTURED BUFFER
  if (normalizedAction === 'stop' || normalizedAction === 'end') {
    const wasActive = isServerHearingActive;
    const capturedChunks = [...serverHearingChunks];
    stopServerHearingStream();

    if (!wasActive && capturedChunks.length === 0) {
      return res.json({
        success: true,
        active: false,
        rawObservation: '[Virtual Hearing: Session already idle (no audio captured)].',
        melody: [],
        events: []
      });
    }

    const combinedBuffer = Buffer.concat(capturedChunks);
    const floatCount = Math.floor(combinedBuffer.length / 4);
    const pcmData = new Float32Array(floatCount);
    for (let i = 0; i < floatCount; i++) {
      pcmData[i] = combinedBuffer.readFloatLE(i * 4);
    }

    if (pcmData.length === 0) {
      return res.json({
        success: true,
        active: false,
        rawObservation: '[Virtual Hearing Perception]\n- Ambient silence (no audio output detected during session).',
        melody: [],
        events: []
      });
    }

    const detectedNotes: string[] = [];
    const chunkSize = 2048;
    for (let offset = 0; offset + chunkSize < pcmData.length; offset += chunkSize) {
      const chunk = pcmData.subarray(offset, offset + chunkSize);
      const pitchRes = serverDetectPitch(chunk, 16000);
      if (pitchRes) {
        const noteStr = serverFrequencyToRichNote(pitchRes.pitch);
        if (noteStr && (!detectedNotes.length || detectedNotes[detectedNotes.length - 1] !== noteStr)) {
          detectedNotes.push(noteStr);
        }
      }
    }

    let sumSquares = 0;
    for (let i = 0; i < pcmData.length; i++) sumSquares += pcmData[i] * pcmData[i];
    const rms = Math.sqrt(sumSquares / pcmData.length);
    const events: string[] = [];
    if (rms > 0.15) events.push('Heavy Bass/Impact');
    else if (rms > 0.05) events.push('Notification Sound');

    const melodyCompact = detectedNotes.slice(0, 12).join('-');
    const lines: string[] = ['[Virtual Hearing Perception]'];
    if (melodyCompact) lines.push(`- Melody:${melodyCompact}`);
    if (events.length > 0) lines.push(`- Sounds:[${events.join(',')}]`);

    const rawObservation = lines.length > 1 ? lines.join('\n') : '[Virtual Hearing Perception]\n- Ambient silence.';

    return res.json({
      success: true,
      active: false,
      rawObservation,
      melody: melodyCompact ? [melodyCompact] : [],
      events,
    });
  }

  // 3. STATUS QUERY
  if (normalizedAction === 'status') {
    return res.json({
      success: true,
      active: isServerHearingActive,
      message: isServerHearingActive ? 'Virtual hearing is currently ACTIVE and recording.' : 'Virtual hearing is currently IDLE (off).'
    });
  }

  return res.status(400).json({ success: false, error: `Invalid action "${action}". Use "start", "stop", "end", or "status".` });
});

app.post('/tool/virtual-vision', async (req, res) => {
  const { target = 'active', appName, title, x, y, width, height } = req.body;

  try {
    const screenBuffer = await screenshot({ format: 'png' });
    let cropRegion: { left: number; top: number; width: number; height: number } | null = null;
    let targetLabel = 'fullscreen';

    if (appName || title) {
      const allWins = typeof openWindows === 'function' ? await openWindows() : [];
      const matchedWin = allWins.find(w =>
        (appName && w.owner?.name?.toLowerCase().includes(String(appName).toLowerCase())) ||
        (title && w.title?.toLowerCase().includes(String(title).toLowerCase()))
      );

      if (matchedWin?.bounds) {
        cropRegion = {
          left: Math.max(0, matchedWin.bounds.x),
          top: Math.max(0, matchedWin.bounds.y),
          width: Math.max(1, matchedWin.bounds.width),
          height: Math.max(1, matchedWin.bounds.height),
        };
        targetLabel = `window "${matchedWin.title}" (${matchedWin.owner?.name || 'Unknown'})`;
      }
    }

    if (!cropRegion && target === 'active') {
      const activeWin = await activeWindow();
      if (activeWin?.bounds) {
        cropRegion = {
          left: Math.max(0, activeWin.bounds.x),
          top: Math.max(0, activeWin.bounds.y),
          width: Math.max(1, activeWin.bounds.width),
          height: Math.max(1, activeWin.bounds.height),
        };
        targetLabel = `active window "${activeWin.title}" (${activeWin.owner?.name || 'Unknown'})`;
      }
    } else if (!cropRegion && typeof x === 'number' && typeof y === 'number' && typeof width === 'number' && typeof height === 'number') {
      cropRegion = {
        left: Math.max(0, x),
        top: Math.max(0, y),
        width: Math.max(1, width),
        height: Math.max(1, height),
      };
      targetLabel = `region (${x}, ${y}, ${width}x${height})`;
    }

    let finalBuffer = screenBuffer;
    if (cropRegion) {
      const metadata = await sharp(screenBuffer).metadata();
      const imgWidth = metadata.width || 1920;
      const imgHeight = metadata.height || 1080;

      const safeLeft = Math.min(cropRegion.left, imgWidth - 1);
      const safeTop = Math.min(cropRegion.top, imgHeight - 1);
      const safeWidth = Math.min(cropRegion.width, imgWidth - safeLeft);
      const safeHeight = Math.min(cropRegion.height, imgHeight - safeTop);

      finalBuffer = await sharp(screenBuffer)
        .extract({ left: safeLeft, top: safeTop, width: safeWidth, height: safeHeight })
        .png()
        .toBuffer();
    }

    const base64 = finalBuffer.toString('base64');
    res.json({
      success: true,
      target: targetLabel,
      contentType: 'image/png',
      base64,
      bounds: cropRegion,
    });
  } catch (error) {
    log.error(`Virtual vision capture failed: ${(error as Error).message}`);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ── Virtual Input Tool (Mouse & Keyboard) ───────────────────────────
app.post('/tool/virtual-input', async (req, res) => {
  const {
    action,
    x,
    y,
    toX,
    toY,
    button = 'left',
    double = false,
    text,
    key,
    modifier,
    smooth = true,
    durationMs = 500
  } = req.body;

  try {
    const clickBtn = button === 'right' || button === 'middle' ? button : 'left';

    if (action === 'move') {
      if (typeof x !== 'number' || typeof y !== 'number') return res.status(400).json({ success: false, error: 'x and y are required numbers' });
      if (smooth) robot.moveMouseSmooth(x, y); else robot.moveMouse(x, y);
      return res.json({ success: true, message: `Moved cursor to (${x}, ${y})` });
    }

    if (action === 'click') {
      robot.mouseClick(clickBtn, Boolean(double));
      return res.json({ success: true, message: `Clicked ${clickBtn} button` });
    }

    if (action === 'drag') {
      if (typeof x === 'number' && typeof y === 'number') robot.moveMouse(x, y);
      robot.mouseToggle('down', clickBtn);
      if (typeof toX === 'number' && typeof toY === 'number') {
        robot.moveMouseSmooth(toX, toY);
      }
      robot.mouseToggle('up', clickBtn);
      return res.json({ success: true, message: `Dragged ${clickBtn} from (${x}, ${y}) to (${toX}, ${toY})` });
    }

    if (action === 'hold') {
      if (!key || typeof key !== 'string') return res.status(400).json({ success: false, error: 'Key name is required' });
      robot.keyToggle(key.toLowerCase(), 'down');
      setTimeout(() => {
        try { robot.keyToggle(key.toLowerCase(), 'up'); } catch { /* ignore */ }
      }, Math.max(50, Math.min(10000, durationMs)));
      return res.json({ success: true, message: `Holding key "${key}" for ${durationMs}ms` });
    }

    if (action === 'key_down') {
      if (!key) return res.status(400).json({ success: false, error: 'Key required' });
      robot.keyToggle(key.toLowerCase(), 'down');
      return res.json({ success: true, message: `Key "${key}" down` });
    }
    if (action === 'key_up') {
      if (!key) return res.status(400).json({ success: false, error: 'Key required' });
      robot.keyToggle(key.toLowerCase(), 'up');
      return res.json({ success: true, message: `Key "${key}" up` });
    }

    if (action === 'type') {
      if (typeof text !== 'string') return res.status(400).json({ success: false, error: 'Text string is required' });
      robot.typeString(text);
      return res.json({ success: true, message: `Typed "${text}"` });
    }

    if (action === 'press') {
      if (!key || typeof key !== 'string') return res.status(400).json({ success: false, error: 'Key name is required' });
      if (modifier) robot.keyTap(key.toLowerCase(), modifier.toLowerCase()); else robot.keyTap(key.toLowerCase());
      return res.json({ success: true, message: `Tapped "${key}"` });
    }

    if (action === 'screen_size') {
      const size = robot.getScreenSize();
      return res.json({ success: true, width: size.width, height: size.height });
    }
    if (action === 'get_position') {
      const pos = robot.getMousePos();
      return res.json({ success: true, x: pos.x, y: pos.y });
    }

    res.status(400).json({ success: false, error: `Unknown virtual_input action: "${action}"` });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ── Virtual Controller (Xbox 360 / ViGEmBus) ────────────────────────
app.post('/tool/virtual-controller', (req, res) => {
  const { controller, error } = getOrInitVirtualController();
  if (!controller) {
    return res.status(503).json({ success: false, error: error || 'Virtual controller unavailable.' });
  }

  const {
    action = 'tap',
    button,
    stick = 'left',
    x,
    y,
    trigger = 'right',
    value,
    durationMs = 120
  } = req.body;

  try {
    if (action === 'reset') {
      if (typeof controller.resetInputs === 'function') {
        controller.resetInputs();
      } else {
        Object.values(X360_BUTTON_MAP).forEach((btn) => {
          try { controller.button[btn]?.setValue(false); } catch {}
        });
        controller.axis.leftX?.setValue(0.0);
        controller.axis.leftY?.setValue(0.0);
        controller.axis.rightX?.setValue(0.0);
        controller.axis.rightY?.setValue(0.0);
        controller.axis.leftTrigger?.setValue(0.0);
        controller.axis.rightTrigger?.setValue(0.0);
        controller.axis.dpadHorz?.setValue(0.0);
        controller.axis.dpadVert?.setValue(0.0);
      }
      return res.json({ success: true, message: 'Virtual controller inputs reset to neutral.' });
    }

    if (action === 'status') {
      return res.json({ success: true, message: 'Virtual Xbox 360 controller connected and active.' });
    }

    if (action === 'stick') {
      const numX = Number(x);
      const numY = Number(y);
      const clampedX = Math.max(-1.0, Math.min(1.0, Number.isFinite(numX) ? numX : 0.0));
      const clampedY = Math.max(-1.0, Math.min(1.0, Number.isFinite(numY) ? numY : 0.0));
      const isRight = String(stick).toLowerCase() === 'right';
      const targetX = isRight ? controller.axis.rightX : controller.axis.leftX;
      const targetY = isRight ? controller.axis.rightY : controller.axis.leftY;

      targetX.setValue(clampedX);
      targetY.setValue(clampedY);

      if (typeof durationMs === 'number' && durationMs > 0) {
        setTimeout(() => {
          try {
            targetX.setValue(0.0);
            targetY.setValue(0.0);
          } catch {}
        }, Math.max(30, Math.min(10000, durationMs)));
      }

      return res.json({
        success: true,
        message: `${isRight ? 'Right' : 'Left'} stick set to (${clampedX}, ${clampedY})${durationMs > 0 ? ` for ${durationMs}ms` : ''}`
      });
    }

    if (action === 'trigger') {
      const numVal = Number(value);
      const clampedVal = Math.max(0.0, Math.min(1.0, Number.isFinite(numVal) ? numVal : 1.0));
      const isLeft = String(trigger).toLowerCase() === 'left';
      const targetTrigger = isLeft ? controller.axis.leftTrigger : controller.axis.rightTrigger;

      targetTrigger.setValue(clampedVal);

      if (typeof durationMs === 'number' && durationMs > 0) {
        setTimeout(() => {
          try { targetTrigger.setValue(0.0); } catch {}
        }, Math.max(30, Math.min(10000, durationMs)));
      }

      return res.json({ success: true, message: `${isLeft ? 'Left' : 'Right'} trigger set to ${clampedVal}` });
    }

    if (!button || typeof button !== 'string') {
      return res.status(400).json({ success: false, error: 'Button name is required for button actions.' });
    }

    const normalizedBtn = button.trim().toUpperCase();

    if (normalizedBtn === 'LT' || normalizedBtn === 'L2') {
      if (action === 'press') {
        controller.axis.leftTrigger.setValue(1.0);
      } else if (action === 'release') {
        controller.axis.leftTrigger.setValue(0.0);
      } else {
        controller.axis.leftTrigger.setValue(1.0);
        setTimeout(() => { try { controller.axis.leftTrigger.setValue(0.0); } catch {} }, Math.max(30, Math.min(3000, durationMs)));
      }
      return res.json({ success: true, message: `${normalizedBtn} ${action}ed` });
    }

    if (normalizedBtn === 'RT' || normalizedBtn === 'R2') {
      if (action === 'press') {
        controller.axis.rightTrigger.setValue(1.0);
      } else if (action === 'release') {
        controller.axis.rightTrigger.setValue(0.0);
      } else {
        controller.axis.rightTrigger.setValue(1.0);
        setTimeout(() => { try { controller.axis.rightTrigger.setValue(0.0); } catch {} }, Math.max(30, Math.min(3000, durationMs)));
      }
      return res.json({ success: true, message: `${normalizedBtn} ${action}ed` });
    }

    if (DPAD_DIRECTIONS.has(normalizedBtn)) {
      const isUp = normalizedBtn === 'UP' || normalizedBtn === 'DPAD_UP';
      const isDown = normalizedBtn === 'DOWN' || normalizedBtn === 'DPAD_DOWN';
      const isLeft = normalizedBtn === 'LEFT' || normalizedBtn === 'DPAD_LEFT';
      const isRight = normalizedBtn === 'RIGHT' || normalizedBtn === 'DPAD_RIGHT';

      if (action === 'press') {
        if (isUp) controller.axis.dpadVert.setValue(1.0);
        if (isDown) controller.axis.dpadVert.setValue(-1.0);
        if (isLeft) controller.axis.dpadHorz.setValue(-1.0);
        if (isRight) controller.axis.dpadHorz.setValue(1.0);
      } else if (action === 'release') {
        if (isUp || isDown) controller.axis.dpadVert.setValue(0.0);
        if (isLeft || isRight) controller.axis.dpadHorz.setValue(0.0);
      } else {
        if (isUp) controller.axis.dpadVert.setValue(1.0);
        if (isDown) controller.axis.dpadVert.setValue(-1.0);
        if (isLeft) controller.axis.dpadHorz.setValue(-1.0);
        if (isRight) controller.axis.dpadHorz.setValue(1.0);

        setTimeout(() => {
          try {
            if (isUp || isDown) controller.axis.dpadVert.setValue(0.0);
            if (isLeft || isRight) controller.axis.dpadHorz.setValue(0.0);
          } catch {}
        }, Math.max(30, Math.min(3000, durationMs)));
      }
      return res.json({ success: true, message: `D-Pad ${normalizedBtn} ${action}ed` });
    }

    const internalKey = X360_BUTTON_MAP[normalizedBtn];
    if (!internalKey || !controller.button[internalKey]) {
      return res.status(400).json({
        success: false,
        error: `Unknown button "${button}". Valid: A, B, X, Y, LB, RB, LT, RT, START, BACK, GUIDE, LS, RS, UP, DOWN, LEFT, RIGHT.`
      });
    }

    if (action === 'press') {
      controller.button[internalKey].setValue(true);
      return res.json({ success: true, message: `Button ${normalizedBtn} pressed down.` });
    }

    if (action === 'release') {
      controller.button[internalKey].setValue(false);
      return res.json({ success: true, message: `Button ${normalizedBtn} released.` });
    }

    controller.button[internalKey].setValue(true);
    setTimeout(() => {
      try { controller.button[internalKey].setValue(false); } catch {}
    }, Math.max(30, Math.min(3000, durationMs)));

    return res.json({ success: true, message: `Tapped button ${normalizedBtn} (${durationMs}ms)` });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ── Hardware Control ────────────────────────────────────────────────
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
  console.log(`  📂 Backends  : ${Colors.Dim}${path.join(ROOT_DIR, LOCAL_LANGUAGE_MODEL_BACKENDS_PATH)}${Colors.Reset}`);

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

startServer();