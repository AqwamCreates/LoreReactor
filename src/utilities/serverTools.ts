// src/utilities/serverTools.ts
import { localURL } from '../configurations';

export interface SysInfoResult {
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

export interface SysInfoResult {
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

export async function getSystemInfo(): Promise<SysInfoResult> {
  try {
    const response = await fetch(`${localURL}/tool/sysinfo`);
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