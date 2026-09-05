/**
 * Storage Implementation - Main storage access layer
 * This consolidates all storage operations from the original storage.tsx
 */
import { localURL } from "../../configurations";
import { getTimestamp, DEFAULT_VALUES, MANIFEST_FILE } from "../../core";
import type { Sampler, LanguageModel } from "../../types";


// Default objects
const now = getTimestamp();

export const DefaultSampler: Sampler = {
  id: "default-sampler",
  name: "Default",
  description: "Fallback sampler",
  parameters: { 
    temperature: DEFAULT_VALUES.SAMPLER.TEMPERATURE, 
    top_k: DEFAULT_VALUES.SAMPLER.TOP_K, 
    repeat_penalty: DEFAULT_VALUES.SAMPLER.REPEAT_PENALTY, 
    n_predict: DEFAULT_VALUES.SAMPLER.N_PREDICT, 
    stop: [], 
    frequency_penalty: DEFAULT_VALUES.SAMPLER.FREQUENCY_PENALTY, 
    presence_penalty: DEFAULT_VALUES.SAMPLER.PRESENCE_PENALTY 
  },
  stopPatterns: [],
  maximumNumberOfTokens: DEFAULT_VALUES.SAMPLER.N_PREDICT,
  firstCreatedTimestamp: now,
  lastUpdatedTimestamp: now,
};

export const DefaultModel: LanguageModel = {
  id: "default-model",
  name: "Default Model",
  description: "Fallback model",
  contextLength: 4096,
  firstCreatedTimestamp: now,
  lastUpdatedTimestamp: now,
};

// HTTP helpers
async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const cleanUrl = url.startsWith('/') ? url : `/${url}`;
    const targetUrl = `${localURL}${cleanUrl}`;
    
    const response = await fetch(targetUrl);
    
    if (!response.ok) {
      if (response.status === 404) return null;
      console.warn(`HTTP Error ${response.status} for ${url}`);
      return null;
    }

    const contentType = response.headers.get("content-type");
    if (!contentType || (!contentType.includes("application/json") && !contentType.includes("text/plain"))) {
      if (contentType && contentType.includes("text")) {
        // Allow text/plain for simple arrays
      } else {
        return null;
      }
    }

    const text = await response.text();
    if (!text.trim()) return null;
    
    return JSON.parse(text) as T;
  } catch (error) {
    console.warn(`Failed to parse JSON from ${url}:`, error);
    return null;
  }
}

async function putJson<T>(url: string, data: T): Promise<void> {
  const cleanUrl = url.startsWith('/') ? url : `/${url}`;
  const targetUrl = `${localURL}${cleanUrl}`;
  const response = await fetch(targetUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!response.ok) throw new Error(`Failed to save data to ${targetUrl}: HTTP ${response.status}`);
}

async function deleteResource(url: string): Promise<void> {
  const cleanUrl = url.startsWith('/') ? url : `/${url}`;
  const targetUrl = `${localURL}${cleanUrl}`;
  const response = await fetch(targetUrl, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw new Error(`Failed to delete resource at ${targetUrl}: HTTP ${response.status}`);
}

// Manifest helpers
async function ensureManifest(folderPath: string): Promise<string[]> {
  const manifestUrl = `${folderPath}/${MANIFEST_FILE}`;
  
  let currentIds = await fetchJson<string[]>(manifestUrl);
  
  if (currentIds && Array.isArray(currentIds)) {
    return currentIds;
  }

  console.log(`Manifest missing for ${folderPath}. Scanning directory...`);
  try {
    const files = await fetchJson<string[]>(folderPath);
    
    if (files && Array.isArray(files)) {
      const ids = files
        .filter(f => f.endsWith('.json') && f !== MANIFEST_FILE)
        .map(f => f.replace('.json', ''));
      
      console.log(`Found ${ids.length} items in ${folderPath}. Creating manifest.`);
      await putJson(manifestUrl, ids);
      return ids;
    }
  } catch (e) {
    console.warn(`Failed to scan directory ${folderPath}:`, e);
  }

  return [];
}

async function updateManifest(folderPath: string, id: string, action: 'add' | 'remove'): Promise<void> {
  const currentIds = await ensureManifest(folderPath);
  
  let newIds: string[];
  if (action === 'add') {
    if (currentIds.includes(id)) return;
    newIds = [...currentIds, id];
  } else {
    newIds = currentIds.filter(existingId => existingId !== id);
  }
  
  const manifestUrl = `${folderPath}/${MANIFEST_FILE}`;
  await putJson(manifestUrl, newIds);
}

// Export storage functions
export { fetchJson, putJson, deleteResource, ensureManifest, updateManifest };
