// src/utilities/serverTools.ts
import { localURL } from '../configurations';

export interface SystemInfoResult {
  success: boolean;
  data?: {
    cpuManufacturer: string;
    cpuBrand: string;
    cores: number;
    loadPercent: number;
    memoryTotalMB: number;
    memoryUsedMB: number;
    disks: Array<{ fs: string; type: string; sizeGB: number; usedGB: number; usePercent: number }>;
  };
  error?: string;
}

export interface ScreenshotResult {
  success: boolean;
  contentType?: string;
  base64?: string;
  error?: string;
}


export interface OpenTargetResult {
  success: boolean;
  target?: string;
  error?: string;
}
export interface FileWriteResult {
  success: boolean;
  path?: string;
  bytes?: number;
  error?: string;
}


export interface ShellResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export interface VirtualInputParams {
  action: 'move' | 'click' | 'type' | 'press' | 'scroll' | 'screen_size' | 'get_position';
  x?: number;
  y?: number;
  button?: 'left' | 'right' | 'middle';
  double?: boolean;
  text?: string;
  key?: string;
  modifier?: string;
  smooth?: boolean;
}

export async function speakText(text: string, voice?: string, speed = 1.0) {
  const res = await fetch(`${localURL}/tool/text_to_speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, speed }),
  });
  return res.json();
}

export async function stopSpeech() {
  const res = await fetch(`${localURL}/tool/text_to_speech/stop`, { method: 'POST' });
  return res.json();
}

export async function getSystemInfo(): Promise<SystemInfoResult> {
  try {
    const response = await fetch(`${localURL}/tool/system-info`);
    return await response.json();
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function sendDesktopNotification(
  title: string, 
  message: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`${localURL}/tool/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, message }),
    });
    return await response.json();
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function controlVolume(
  action: 'get' | 'set' | 'mute' | 'unmute',
  level?: number
): Promise<{ success: boolean; volume?: number; muted?: boolean; error?: string }> {
  try {
    const response = await fetch(`${localURL}/tool/volume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, level }),
    });
    return await response.json();
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function lockScreen(): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const response = await fetch(`${localURL}/tool/lock-screen`, { method: 'POST' });
    return await response.json();
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function clipboardAction(
  action: 'read' | 'write', 
  text?: string
): Promise<{ success: boolean; content?: string; message?: string; error?: string }> {
  try {
    const response = await fetch(`${localURL}/tool/clipboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, text }),
    });
    return await response.json();
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function captureScreenshot(): Promise<ScreenshotResult> {
  try {
    const response = await fetch(`${localURL}/tool/screenshot`, {
      method: 'POST',
    });
    return await response.json();
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function scanLocalNetwork(): Promise<{
  success: boolean;
  devices?: Array<{ name: string; ip: string; mac: string }>;
  error?: string;
}> {
  try {
    const response = await fetch(`${localURL}/tool/network`);
    return await response.json();
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function startFileWatcher(dirPath: string) {
  const res = await fetch(`${localURL}/tool/file-watcher/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dirPath }),
  });
  return res.json();
}

export async function getFileWatcherEvents() {
  const res = await fetch(`${localURL}/tool/file-watcher/events`);
  return res.json();
}

export async function getActiveWindowInfo() {
  const res = await fetch(`${localURL}/tool/window-monitor`);
  return res.json();
}

export async function getRunningProcesses(query?: string, limit = 5) {
  const params = new URLSearchParams();
  if (query) params.append('q', query);
  params.append('limit', limit.toString());
  const res = await fetch(`${localURL}/tool/process-monitor?${params.toString()}`);
  return res.json();
}

export async function moveToTrash(targetPath: string): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const response = await fetch(`${localURL}/tool/trash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPath }),
    });
    return await response.json();
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

/**
 * Universal opener for files, videos, directories, and URLs.
 */
export async function readFile(target: string): Promise<OpenTargetResult> {
  try {
    const response = await fetch(`${localURL}/tool/read-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target }),
    });
    return await response.json();
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function writeFile(filePath: string, content: string): Promise<FileWriteResult> {
  try {
    const response = await fetch(`${localURL}/tool/write-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath, content }),
    });
    return await response.json();
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function runShellCommand(command: string): Promise<ShellResult> {
  try {
    const response = await fetch(`${localURL}/tool/shell`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    return await response.json();
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function sendVirtualInput(params: VirtualInputParams): Promise<{
  success: boolean;
  message?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  error?: string;
}> {
  try {
    const response = await fetch(`${localURL}/tool/virtual-input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await response.json();
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function getHardwarePorts() {
  const res = await fetch(`${localURL}/tool/hardware/list`);
  return res.json();
}

export async function sendHardwareCommand(portPath: string, command: string, baudRate = 9600) {
  const res = await fetch(`${localURL}/tool/hardware/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ portPath, command, baudRate }),
  });
  return res.json();
}