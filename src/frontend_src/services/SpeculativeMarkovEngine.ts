// frontend_src/services/SpeculativeMarkovEngine.ts

interface NGramNode {
    nextTokens: Map<string, number>;
    totalCount: number;
}

interface CharacterSessionState {
    nGramMap: Map<string, NGramNode>;
    lastProcessedTimestamp: number;
}

// Delimiter that cannot occur inside textual tokens
const NGRAM_DELIMITER = '\u001F';

// Unicode-aware tokenizer: matches words/letters (including non-Latin), numbers, emojis, whitespace, or punctuation
const TOKEN_REGEX = /\p{Extended_Pictographic}|\p{L}+|\p{N}+|\s+|[^\s\p{L}\p{N}]/gu;

export class SpeculativeMarkovEngine {
    private n = 3; // Order-3 Markov (2 prefix tokens -> 1 next token)
    private sessionCache = new Map<string, CharacterSessionState>();

    private getOrCreateState(interactionDataId: string, characterId: string): CharacterSessionState {
        const key = `${interactionDataId}-${characterId}`;
        let state = this.sessionCache.get(key);
        if (!state) {
            state = { nGramMap: new Map(), lastProcessedTimestamp: 0 };
            this.sessionCache.set(key, state);
        }
        return state;
    }

    private tokenize(text: string): string[] {
        if (!text) return [];
        return text.match(TOKEN_REGEX) || [];
    }

    /**
     * FULL TRAIN: Wipes existing state and rebuilds from scratch.
     * Use this when a new chat session is loaded.
     */
    public fullTrain(
        messages: { textContent: string; lastUpdatedTimestamp: number; characterId: string }[],
        interactionDataId: string
    ) {
        const charMessages = new Map<string, { textContent: string; lastUpdatedTimestamp: number }[]>();
        
        for (const msg of messages) {
            let list = charMessages.get(msg.characterId);
            if (!list) {
                list = [];
                charMessages.set(msg.characterId, list);
            }
            list.push({
                textContent: msg.textContent,
                lastUpdatedTimestamp: msg.lastUpdatedTimestamp,
            });
        }

        for (const [charId, msgs] of charMessages.entries()) {
            const state = this.getOrCreateState(interactionDataId, charId);
            state.nGramMap.clear();
            state.lastProcessedTimestamp = 0;
            
            for (const msg of msgs) {
                this.addMessageToMap(state.nGramMap, msg.textContent);
                state.lastProcessedTimestamp = Math.max(state.lastProcessedTimestamp, msg.lastUpdatedTimestamp);
            }
        }
    }

    /**
     * INCREMENTAL SYNC: Only processes messages newer than the last sync.
     * 
     * IMPORTANT CONTRACT: The caller MUST filter `messages` to only include those 
     * actually authored by `characterId`. Passing witnessed messages from other 
     * characters will contaminate this character's n-gram model with foreign speech patterns.
     */
    public syncMessages(
        messages: { textContent: string; lastUpdatedTimestamp: number }[], 
        characterId: string,
        interactionDataId: string
    ) {
        const state = this.getOrCreateState(interactionDataId, characterId);

        for (const msg of messages) {
            if (msg.lastUpdatedTimestamp > state.lastProcessedTimestamp) {
                this.addMessageToMap(state.nGramMap, msg.textContent);
                state.lastProcessedTimestamp = Math.max(state.lastProcessedTimestamp, msg.lastUpdatedTimestamp);
            }
        }
    }

    private addMessageToMap(map: Map<string, NGramNode>, textContent: string) {
        const tokens = this.tokenize(textContent);
        if (tokens.length < this.n) return;
        
        for (let i = 0; i <= tokens.length - this.n; i++) {
            const prefix = tokens.slice(i, i + this.n - 1).join(NGRAM_DELIMITER);
            const nextToken = tokens[i + this.n - 1];
            
            let node = map.get(prefix);
            if (!node) {
                node = { nextTokens: new Map(), totalCount: 0 };
                map.set(prefix, node);
            }
            node.nextTokens.set(nextToken, (node.nextTokens.get(nextToken) || 0) + 1);
            node.totalCount++;
        }
    }

    /**
     * PREDICT: Generates tokens speculatively until confidence drops below the threshold.
     */
    public predictSequence(
        currentText: string, 
        outputCost: number,
        cacheMissCost: number,
        temperature: number,
        characterId: string,
        interactionDataId: string
    ): string | null {
        const state = this.sessionCache.get(`${interactionDataId}-${characterId}`);
        if (!state || state.nGramMap.size === 0) return null;

        const map = state.nGramMap;
        const tokens = this.tokenize(currentText);
        const prefixLength = this.n - 1;

        if (tokens.length < prefixLength) return null;

        // Confidence threshold calculation
        const safeOutputCost = Math.max(0.0001, outputCost);
        const confidenceThreshold = Math.min(1.0, cacheMissCost / safeOutputCost);

        const appendedTokens: string[] = [];
        // Maintain an array window rather than splitting strings
        const currentWindow: string[] = tokens.slice(-prefixLength);

        // Safety cap: up to 64 tokens
        for (let i = 0; i < 64; i++) {
            const currentPrefixKey = currentWindow.join(NGRAM_DELIMITER);
            const node = map.get(currentPrefixKey);
            if (!node || node.totalCount === 0) break;

            // Find best candidate (Argmax)
            let bestToken = '';
            let maxCount = 0;

            for (const [token, count] of node.nextTokens.entries()) {
                if (count > maxCount) {
                    maxCount = count;
                    bestToken = token;
                }
            }

            const bestProb = maxCount / node.totalCount;

            // STOP CONDITION: If confidence is lower than cost recovery threshold, break
            if (bestProb < confidenceThreshold || !bestToken) {
                break;
            }

            // Speculative decoding favors argmax, but if temperature is requested and valid:
            let selectedToken = bestToken;
            if (temperature > 0.05 && node.nextTokens.size > 1) {
                let totalWeight = 0;
                const weights = new Map<string, number>();

                for (const [token, count] of node.nextTokens.entries()) {
                    const prob = count / node.totalCount;
                    // Only consider tokens meeting the threshold
                    if (prob >= confidenceThreshold) {
                        const weight = prob ** (1 / Math.max(0.1, temperature));
                        weights.set(token, weight);
                        totalWeight += weight;
                    }
                }

                if (totalWeight > 0) {
                    let random = Math.random() * totalWeight;
                    for (const [token, weight] of weights.entries()) {
                        random -= weight;
                        if (random <= 0) {
                            selectedToken = token;
                            break;
                        }
                    }
                }
            }

            appendedTokens.push(selectedToken);

            // Advance the sliding window
            currentWindow.shift();
            currentWindow.push(selectedToken);
        }

        if (appendedTokens.length > 0) {
            return appendedTokens.join('');
        }

        return null;
    }

    public clearSession(interactionDataId: string) {
        for (const key of this.sessionCache.keys()) {
            if (key.startsWith(`${interactionDataId}-`)) {
                this.sessionCache.delete(key);
            }
        }
    }
}

export const speculativeMarkovEngine = new SpeculativeMarkovEngine();