import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { getStemmedContentWords } from './stemmerHelper';

export interface PruningMessageCandidate {
    id: string;
    textContent: string;
    locationId?: string;
}

/**
 * Unified calculation of cutoff boundary for entropy pruning.
 * Standardized on tokenEngine.countTokens().
 */
export async function calculateEntropyPruningCutoff(
    messages: PruningMessageCandidate[],
    chunkSize = 3,
    threshold = 0.35,
    maxRawTokens = 2000
): Promise<number> {
    if (messages.length <= chunkSize) return messages.length;

    const tokenEngine = getLanguageModelEngine();
    let accumulatedTokens = 0;
    let cutoffIndex = messages.length;

    for (let i = messages.length; i > chunkSize; i -= chunkSize) {
        const chunkStart = Math.max(0, i - chunkSize);
        const currentChunk = messages.slice(chunkStart, i);
        const previousChunk = messages.slice(Math.max(0, chunkStart - chunkSize), chunkStart);

        for (const msg of currentChunk) {
            accumulatedTokens += await tokenEngine.countTokens(msg.textContent);
        }

        let hardBoundary = false;
        for (let j = 1; j < currentChunk.length; j++) {
            const prev = currentChunk[j - 1];
            const curr = currentChunk[j];
            if (prev.locationId !== undefined && curr.locationId !== undefined && prev.locationId !== curr.locationId) {
                hardBoundary = true;
                break;
            }
        }

        if (hardBoundary || accumulatedTokens >= maxRawTokens) {
            cutoffIndex = i;
            break;
        }

        if (previousChunk.length > 0) {
            const currentWords = new Set<string>();
            for (const msg of currentChunk) {
                for (const w of getStemmedContentWords(msg.textContent)) currentWords.add(w);
            }

            const previousWords = new Set<string>();
            for (const msg of previousChunk) {
                for (const w of getStemmedContentWords(msg.textContent)) previousWords.add(w);
            }

            let intersection = 0;
            for (const w of currentWords) {
                if (previousWords.has(w)) intersection++;
            }

            const union = currentWords.size + previousWords.size - intersection;
            const lexicalOverlap = union > 0 ? intersection / union : 0;
            const driftScore = 1 - lexicalOverlap;

            if (driftScore < threshold) {
                cutoffIndex = chunkStart;
                break;
            }
        }
        cutoffIndex = chunkStart;
    }

    return cutoffIndex;
}