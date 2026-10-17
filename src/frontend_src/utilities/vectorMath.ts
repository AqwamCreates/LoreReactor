// src/frontend_src/utilities/vectorMath.ts

export interface VectorSearchItem {
    id: string;
    embedding: number[];
    [key: string]: any; // Allow passing through other data like content, text, etc.
}

export interface VectorSearchResult<T extends VectorSearchItem = VectorSearchItem> {
    item: T;
    score: number;
}

/**
 * Calculates the standard dot product of two vectors.
 */
export function dotProduct(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
        throw new Error(`Vector length mismatch: ${vecA.length} vs ${vecB.length}`);
    }
    let sum = 0;
    for (let i = 0; i < vecA.length; i++) {
        sum += vecA[i] * vecB[i];
    }
    return sum;
}

/**
 * Calculates the cosine similarity between two vectors.
 * Returns a value between -1 and 1 (typically 0 to 1 for normalized text embeddings).
 * Use this if you are comparing vectors that were NOT normalized.
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
        throw new Error(`Vector length mismatch: ${vecA.length} vs ${vecB.length}`);
    }
    
    let dot = 0;
    let magA = 0;
    let magB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
        const a = vecA[i];
        const b = vecB[i];
        dot += a * b;
        magA += a * a;
        magB += b * b;
    }
    
    const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
    if (magnitude === 0) return 0;
    
    return dot / magnitude;
}

/**
 * Normalized Dot Product.
 * If you know your vectors are already normalized (length = 1) via the EmbeddingEngine,
 * this is mathematically identical to Cosine Similarity but skips the magnitude calculation,
 * making it significantly faster for bulk comparisons.
 */
export function normalizedDotProduct(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
        return 0; // Fail gracefully instead of throwing in hot loops
    }
    let sum = 0;
    for (let i = 0; i < vecA.length; i++) {
        sum += vecA[i] * vecB[i];
    }
    return sum;
}

/**
 * Finds the top K most similar items to a query vector.
 * Uses normalized dot product for speed, assuming embeddings were generated with `normalize: true`.
 * 
 * @param queryVector - The vector to search against (e.g., the embedded chat context).
 * @param items - Array of objects containing an `embedding` number array and an `id`.
 * @param k - Number of top results to return.
 * @param threshold - Minimum similarity score (0 to 1) to include in results.
 * @returns Sorted array of items and their scores, descending.
 */
export function findTopKSimilar<T extends VectorSearchItem>(
    queryVector: number[], 
    items: T[], 
    k: number, 
    threshold = 0.0
): VectorSearchResult<T>[] {
    
    const scored: VectorSearchResult<T>[] = [];
    
    for (const item of items) {
        if (!item.embedding || item.embedding.length !== queryVector.length) continue;
        
        const score = normalizedDotProduct(queryVector, item.embedding);
        
        if (score >= threshold) {
            scored.push({ item, score });
        }
    }
    
    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);
    
    // Return top K
    return scored.slice(0, k);
}