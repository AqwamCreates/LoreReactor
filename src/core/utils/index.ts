/**
 * Utility functions for the LoreReactor application
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Generates a unique ID
 */
export function generateId(): string {
  return uuidv4();
}

/**
 * Gets the current timestamp
 */
export function getTimestamp(): number {
  return Date.now();
}

/**
 * Creates an object with base metadata fields
 */
export function createBaseObject(name: string, description?: string): {
  name: string;
  description?: string;
  firstCreatedTimestamp: number;
  lastUpdatedTimestamp: number;
} {
  const now = getTimestamp();
  return {
    name,
    description,
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
  };
}

/**
 * Updates the lastUpdatedTimestamp of an object
 */
export function updateTimestamp<T extends { lastUpdatedTimestamp: number }>(obj: T): T {
  return {
    ...obj,
    lastUpdatedTimestamp: getTimestamp(),
  };
}

/**
 * Safely parses JSON, returning null on failure
 */
export function safeJsonParse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/**
 * Delays execution for a specified time
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Batches an array into chunks of specified size
 */
export function batchArray<T>(array: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < array.length; i += batchSize) {
    batches.push(array.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Loads items in batches with optional delay between batches
 */
export async function loadInBatches<T, R>(
  items: T[],
  loader: (item: T) => Promise<R>,
  batchSize: number = 5,
  delayBetweenBatchesMs: number = 10
): Promise<R[]> {
  const results: R[] = [];
  const batches = batchArray(items, batchSize);
  
  for (let i = 0; i < batches.length; i++) {
    const batchResults = await Promise.all(batches[i].map(loader));
    results.push(...batchResults);
    
    if (i < batches.length - 1) {
      await delay(delayBetweenBatchesMs);
    }
  }
  
  return results;
}

/**
 * Filters out null values from an array
 */
export function filterNull<T>(array: (T | null)[]): T[] {
  return array.filter((item): item is T => item !== null);
}

/**
 * Converts a file to base64 string
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Gets the current date and time as a formatted string
 */
export function getCurrentDateAndTimeString(): string {
  return new Date().toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Estimates token count from text length
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Deep clones an object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Debounces a function
 */
export function debounce<T extends (...args: unknown[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Throttles a function
 */
export function throttle<T extends (...args: unknown[]) => void>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}
