// src/utilities/serverTools.ts
import { localURL } from '../configurations';

export interface FileWriteResult {
  success: boolean;
  path?: string;
  bytes?: number;
  error?: string;
}

export interface FileReadResult {
  success?: boolean;
  path?: string;
  content?: string;
  error?: string;
}

export interface OpenTargetResult {
  success: boolean;
  target?: string;
  error?: string;
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

