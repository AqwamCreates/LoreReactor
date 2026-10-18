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

export function computeBestMatch25Scores(query: string, documents: string[]): number[] {
    const k1 = 1.5;
    const b = 0.75;
    
    const tokenize = (text: string) => text.toLowerCase().match(/\b\w+\b/g) || [];
    
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return documents.map(() => 0);

    const docTokens = documents.map(tokenize);
    const docLengths = docTokens.map(t => t.length);
    const avgDocLength = docLengths.reduce((a, b) => a + b, 0) / (docLengths.length || 1);

    // Document Frequency (DF)
    const df: Record<string, number> = {};
    for (const tokens of docTokens) {
        const unique = new Set(tokens);
        for (const term of unique) {
            df[term] = (df[term] || 0) + 1;
        }
    }

    const N = docTokens.length;
    const scores = new Array(N).fill(0);

    for (const term of queryTerms) {
        const idf = Math.log((N - (df[term] || 0) + 0.5) / ((df[term] || 0) + 0.5) + 1);
        for (let i = 0; i < N; i++) {
            const tf = docTokens[i].filter(t => t === term).length;
            const dl = docLengths[i];
            const numerator = tf * (k1 + 1);
            const denominator = tf + k1 * (1 - b + b * (dl / avgDocLength));
            scores[i] += idf * (numerator / denominator);
        }
    }
    return scores;
}

/**
 * Reciprocal Rank Fusion (RRF)
 * Merges Dense (vector) and Sparse (BM25) rankings into a single unified score.
 * Solves the problem of dense and sparse scores operating on completely different scales.
 */
export function reciprocalRankFusion(
    denseScores: number[], 
    sparseScores: number[], 
    k: number = 60 // Standard RRF constant
): number[] {
    const n = denseScores.length;
    const rrfScores = new Array(n).fill(0);

    // Rank Dense (Higher is better)
    const denseRanked = denseScores
        .map((score, index) => ({ score, index }))
        .sort((a, b) => b.score - a.score)
        .map((item, rank) => ({ ...item, rank: rank + 1 }));

    // Rank Sparse (Higher is better)
    const sparseRanked = sparseScores
        .map((score, index) => ({ score, index }))
        .sort((a, b) => b.score - a.score)
        .map((item, rank) => ({ ...item, rank: rank + 1 }));

    for (const item of denseRanked) {
        rrfScores[item.index] += 1 / (k + item.rank);
    }
    for (const item of sparseRanked) {
        rrfScores[item.index] += 1 / (k + item.rank);
    }

    return rrfScores;
}