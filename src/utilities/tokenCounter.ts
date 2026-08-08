// src/utilities/tokenCounter.ts

const tokenCache = new Map<string, number>();

/**
 * Counts tokens using llama-server's /tokenize endpoint.
 * Falls back to character-based estimation if the server is unavailable.
 */
export async function countTokens(text: string, port: number): Promise<number> {
    // Cache by text+port to avoid redundant calls
    const cacheKey = `${port}:${text.length}:${text.substring(0, 100)}`;
    if (tokenCache.has(cacheKey)) return tokenCache.get(cacheKey)!;

    try {
        const res = await fetch(`http://localhost:${port}/tokenize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: text }),
        });

        if (!res.ok) throw new Error(`Tokenize failed: ${res.status}`);

        const data = await res.json();
        const count = data.tokens?.length ?? Math.ceil(text.length / 4);
        
        tokenCache.set(cacheKey, count);
        
        // Prevent unbounded cache growth
        if (tokenCache.size > 500) {
            const firstKey = tokenCache.keys().next().value;
            if (firstKey) tokenCache.delete(firstKey);
        }

        return count;
    } catch {
        // Fallback: rough estimation
        return Math.ceil(text.length / 4);
    }
}

/**
 * Synchronous estimation fallback when async isn't available.
 * Uses ~4 chars per token as a rough average for most models.
 */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}