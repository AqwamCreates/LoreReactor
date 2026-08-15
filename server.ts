import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import { spawn, ChildProcess } from 'node:child_process';
import net from 'node:net';

// --- Configuration ---
const app = express();
const PORT = 3001;
const ROOT_DIR = process.cwd();
const APP_NAME = "LoreReactor";

const LLAMA_SERVER_PATH = path.join(ROOT_DIR, 'llama', 'llama-server.exe');

interface ModelInstance {
  id: string;
  process: ChildProcess;
  port: number;
  status: 'starting' | 'ready' | 'error';
  modelPath: string;
  startTime: number;
}

const activeModels: Map<string, ModelInstance> = new Map();

const Colors = {
  Reset: "\x1b[0m", Bright: "\x1b[1m", Dim: "\x1b[2m",
  FgBlue: "\x1b[34m", FgGreen: "\x1b[32m", FgRed: "\x1b[31m",
  FgYellow: "\x1b[33m", FgCyan: "\x1b[36m", FgMagenta: "\x1b[35m",
  BgBlue: "\x1b[44m", BgWhite: "\x1b[47m",
};

const log = {
  info: (msg: string) => console.log(`${Colors.FgBlue}[INFO]${Colors.Reset} ${msg}`),
  success: (msg: string) => console.log(`${Colors.FgGreen}[OK]${Colors.Reset} ${msg}`),
  warn: (msg: string) => console.log(`${Colors.FgYellow}[WARN]${Colors.Reset} ${msg}`),
  error: (msg: string) => console.log(`${Colors.FgRed}[ERROR]${Colors.Reset} ${msg}`),
  req: (method: string, url: string) => console.log(`${Colors.Dim}${Colors.FgCyan}↙ ${method}${Colors.Reset} ${url}`),
  llama: (msg: string) => console.log(`${Colors.FgMagenta}[LLAMA]${Colors.Reset} ${msg}`)
};

app.use(cors({
  origin: '*', 
  credentials: true
}));
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

async function waitForModelReady(port: number, timeoutMs: number = 60000): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      await fetch(`http://localhost:${port}/health`);
      return true;
    } catch (e) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return false;
}

// --- /user_data routes ---
app.use('/user_data', (req, res) => {
  const relativePath = req.url?.startsWith('/') ? req.url?.slice(1) : req.url;
  if (!relativePath || relativePath.includes('..')) {
    log.warn(`Blocked suspicious path attempt: ${relativePath}`);
    return res.status(403).json({ error: 'Invalid path structure' });
  }

  const filePath = path.join(ROOT_DIR, 'user_data', relativePath);
  const dir = path.dirname(filePath);
  log.req(req.method || 'UNKNOWN', req.url || '/');

  if (req.method === 'GET') {
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Resource not found' });
    fs.stat(filePath, (err, stats) => {
      if (err) return res.status(500).json({ error: 'FS Error' });
      if (stats.isDirectory()) {
        fs.readdir(filePath, (err, files) => err ? res.status(500).json({ error: 'Dir Read Error' }) : res.json(files));
      } else {
        fs.readFile(filePath, 'utf8', (err, data) => {
          if (err) return res.status(500).json({ error: 'Read Error' });
          const ext = path.extname(filePath).toLowerCase();
          if (ext === '.json') { res.setHeader('Content-Type', 'application/json'); res.send(data); }
          else if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
            const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
            res.setHeader('Content-Type', mimeMap[ext]);
            fs.readFile(filePath, (ie, buf) => ie ? res.status(500).send('Img Error') : res.send(buf));
          } else { res.send(data); }
        });
      }
    });
    return;
  }

  if (req.method === 'PUT') {
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); log.success(`Created dir: ${dir}`); }
      catch (e: any) { return res.status(500).json({ error: 'Mkdir Failed', details: e.message }); }
    }
    const body = req.body as any;
    const isImage = relativePath.includes('character_images/') || relativePath.includes('context_data/');
    if (isImage && body?.base64) {
      try {
        const buffer = Buffer.from(body.base64.replace(/^data:image\/\w+;base64,/, ""), 'base64');
        fs.writeFile(filePath, buffer, (err: any) => err ? res.status(500).json({ error: 'Write Img Failed' }) : res.json({ success: true }));
        return;
      } catch (e: any) { return res.status(400).json({ error: 'Invalid Base64' }); }
    }
    fs.writeFile(filePath, JSON.stringify(req.body, null, 2), (err: any) => err ? res.status(500).json({ error: 'Write JSON Failed' }) : res.json({ success: true }));
    return;
  }

  if (req.method === 'DELETE') {
    fs.unlink(filePath, (err: any) => {
      if (err && err.code !== 'ENOENT') return res.status(500).json({ error: 'Delete Failed' });
      res.json({ success: true });
    });
    return;
  }

  res.status(405).json({ error: 'Method Not Allowed' });
});

// --- Model Management ---

app.get('/models/status', (req, res) => {
  const status = Array.from(activeModels.entries()).map(([id, instance]) => ({
    id, port: instance.port, status: instance.status,
    modelPath: instance.modelPath, uptime: Date.now() - instance.startTime
  }));
  res.json({ activeModels: status, count: status.length });
});

app.post('/models/load', async (req, res) => {
  const { id, modelPath, port: requestedPort, args = [] } = req.body;
  if (!id || !modelPath) return res.status(400).json({ error: 'Missing id or modelPath' });
  if (activeModels.has(id)) return res.status(409).json({ error: `Model ${id} is already loaded`, port: activeModels.get(id)?.port });

  const absoluteModelPath = resolveModelPath(modelPath);
  if (!fs.existsSync(LLAMA_SERVER_PATH)) return res.status(500).json({ error: `llama-server.exe not found at ${LLAMA_SERVER_PATH}` });
  if (!fs.existsSync(absoluteModelPath)) return res.status(404).json({ error: `Model file not found at ${absoluteModelPath}` });

  const port = requestedPort || await getFreePort();
  log.info(`Starting model ${id} on port ${port}...`);
  log.info(`Model Path: ${absoluteModelPath}`);

  const launchArgs = ['-m', absoluteModelPath, '--port', port.toString(), '--host', '127.0.0.1', ...args];

  const proc = spawn(LLAMA_SERVER_PATH, launchArgs, {
    cwd: path.dirname(LLAMA_SERVER_PATH),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const instance: ModelInstance = { id, process: proc, port, status: 'starting', modelPath: absoluteModelPath, startTime: Date.now() };
  activeModels.set(id, instance);

  proc.stdout?.on('data', (data) => {
    const str = data.toString().trim();
    if (str) log.llama(`[${id}] ${str}`);
    if (str.includes("HTTP server listening")) instance.status = 'ready';
  });

  proc.stderr?.on('data', (data) => {
    const str = data.toString().trim();
    if (!str) return;
    const lowerStr = str.toLowerCase();
    const isError = lowerStr.includes('error:') || lowerStr.includes('fatal') || lowerStr.includes('failed to') || lowerStr.includes('exception') || lowerStr.includes('abort');
    const isFalsePositive = lowerStr.includes('was not control-type') || lowerStr.includes('overridden') || lowerStr.includes('n_ctx_seq') || lowerStr.includes('no implementations specified') || lowerStr.includes('already set by user');
    if (isError && !isFalsePositive) log.error(`[${id}] ${str}`);
    else log.llama(`[${id}] ${str}`);
  });

  proc.on('exit', (code) => { log.warn(`[${id}] Process exited with code ${code}`); activeModels.delete(id); });

  const isReady = await waitForModelReady(port);
  if (isReady) {
    instance.status = 'ready';
    log.success(`Model ${id} loaded successfully on port ${port}`);
    res.json({ success: true, id, port, status: 'ready' });
  } else {
    instance.status = 'error';
    log.error(`Model ${id} failed to start within timeout. Killing process.`);
    proc.kill();
    activeModels.delete(id);
    res.status(504).json({ error: 'Model failed to initialize within timeout' });
  }
});

app.post('/models/unload', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing id' });
  const instance = activeModels.get(id);
  if (!instance) return res.status(404).json({ error: `Model ${id} not found` });

  log.info(`Unloading model ${id}...`);
  instance.process.kill('SIGTERM');
  setTimeout(() => { if (instance.process.pid) { try { process.kill(instance.process.pid, 'SIGKILL'); } catch(e) {} } }, 2000);
  activeModels.delete(id);
  log.success(`Model ${id} unloaded`);
  res.json({ success: true, message: 'Model unloaded' });
});

// ✅ FIXED: Express 5 requires named wildcard parameter {*path} instead of bare *
app.all('/proxy/:modelId/{*path}', (req, res) => {
  const modelId = req.params.modelId;
  const remainingPath = req.params.path || '';
  const instance = activeModels.get(modelId);
  if (!instance || instance.status !== 'ready') return res.status(503).json({ error: `Model ${modelId} is not loaded or ready` });

  const targetUrl = `http://127.0.0.1:${instance.port}/${remainingPath}`;
  fetch(targetUrl, {
    method: req.method, headers: req.headers as any,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined
  })
  .then(response => response.json())
  .then(data => res.json(data))
  .catch(err => res.status(502).json({ error: 'Proxy error', details: err.message }));
});

const startServer = () => {
  const border = "────────────────────────────────────────";
  const title = `${Colors.Bright}${Colors.FgCyan}⚛️  ${APP_NAME} Server${Colors.Reset}`;
  console.clear();
  console.log(`${Colors.BgBlue}${Colors.Bright}${Colors.FgWhite}  ${APP_NAME}  ${Colors.Reset}`);
  console.log(border);
  console.log(`  ${title}`);
  console.log(`  🤖 Llama Path: ${Colors.Dim}${LLAMA_SERVER_PATH}${Colors.Reset}`);
  console.log(border);
  console.log(`  📡 API Port:  ${Colors.FgGreen}http://localhost:${PORT}${Colors.Reset}`);
  console.log(`  💾 Data Path: ${Colors.Dim}/user_data/${Colors.Reset}`);
  console.log(border);
  console.log(`  ${Colors.FgGreen}●${Colors.Reset} System Ready.`);
  console.log(`  ${Colors.FgMagenta}●${Colors.Reset} Model Control Enabled.`);
  console.log("");
  app.listen(PORT, '0.0.0.0', () => {});
};

startServer();