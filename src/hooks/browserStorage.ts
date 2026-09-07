// src/hooks/browserStorage.ts
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'LoreReactor';
const DB_VERSION = 1;
const STORE_NAME = 'user_data';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
    if (!dbPromise) {
        dbPromise = openDB(DB_NAME, DB_VERSION, {
            upgrade(db) {
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            },
        });
    }
    return dbPromise;
}

/**
 * Check if the server-side /user_data API is reachable.
 * Returns true if running with backend, false for browser-only/PWA mode.
 */
export async function isServerAvailable(): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        await fetch('/user_data/', { signal: controller.signal });
        clearTimeout(timeout);
        return true;
    } catch {
        return false;
    }
}

// ─── Read Operations ────────────────────────────────────────────────

export async function browserReadFile(relativePath: string): Promise<string | null> {
    const db = await getDb();
    const value = await db.get(STORE_NAME, relativePath);
    if (value === undefined) return null;
    return typeof value === 'string' ? value : JSON.stringify(value);
}

export async function browserReadJson<T>(relativePath: string): Promise<T | null> {
    const db = await getDb();
    const value = await db.get(STORE_NAME, relativePath);
    if (value === undefined) return null;
    return value as T;
}

export async function browserListDirectory(dirPath: string): Promise<string[]> {
    const db = await getDb();
    const allKeys = await db.getAllKeys(STORE_NAME);
    const prefix = dirPath.endsWith('/') ? dirPath : dirPath + '/';
    const entries = new Set<string>();

    for (const key of allKeys) {
        if (typeof key === 'string' && key.startsWith(prefix)) {
            const remainder = key.slice(prefix.length);
            const firstSegment = remainder.split('/')[0];
            if (firstSegment) entries.add(firstSegment);
        }
    }

    return Array.from(entries);
}

export async function browserExists(relativePath: string): Promise<boolean> {
    const db = await getDb();
    const value = await db.get(STORE_NAME, relativePath);
    return value !== undefined;
}

// ─── Write Operations ───────────────────────────────────────────────

export async function browserWriteFile(relativePath: string, content: string): Promise<void> {
    const db = await getDb();
    await db.put(STORE_NAME, content, relativePath);
}

export async function browserWriteJson(relativePath: string, data: unknown): Promise<void> {
    const db = await getDb();
    await db.put(STORE_NAME, data, relativePath);
}

export async function browserWriteBase64Image(relativePath: string, base64: string): Promise<void> {
    // Store as raw base64 string — IndexedDB handles large strings fine
    const db = await getDb();
    await db.put(STORE_NAME, base64, relativePath);
}

// ─── Delete Operations ──────────────────────────────────────────────

export async function browserDeleteFile(relativePath: string): Promise<void> {
    const db = await getDb();
    await db.delete(STORE_NAME, relativePath);
}

export async function browserDeleteDirectory(dirPath: string): Promise<void> {
    const db = await getDb();
    const allKeys = await db.getAllKeys(STORE_NAME);
    const prefix = dirPath.endsWith('/') ? dirPath : dirPath + '/';
    const tx = db.transaction(STORE_NAME, 'readwrite');

    for (const key of allKeys) {
        if (typeof key === 'string' && key.startsWith(prefix)) {
            await tx.store.delete(key);
        }
    }

    await tx.done;
}

// ─── Bulk Operations ────────────────────────────────────────────────

export async function browserGetAllKeys(): Promise<string[]> {
    const db = await getDb();
    const keys = await db.getAllKeys(STORE_NAME);
    return keys.filter((k): k is string => typeof k === 'string');
}

export async function browserExportAll(): Promise<Record<string, unknown>> {
    const db = await getDb();
    const result: Record<string, unknown> = {};
    const keys = await db.getAllKeys(STORE_NAME);
    for (const key of keys) {
        if (typeof key === 'string') {
            result[key] = await db.get(STORE_NAME, key);
        }
    }
    return result;
}

export async function browserImportAll(data: Record<string, unknown>): Promise<void> {
    const db = await getDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    for (const [key, value] of Object.entries(data)) {
        await tx.store.put(value, key);
    }
    await tx.done;
}

export async function browserClearAll(): Promise<void> {
    const db = await getDb();
    await db.clear(STORE_NAME);
}