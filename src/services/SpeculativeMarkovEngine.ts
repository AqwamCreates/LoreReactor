// src/services/SpeculativeMarkovEngine.ts

interface NGramNode {
    nextTokens: Map<string, number>;
    totalCount: number;
}

interface CharacterSessionState {
    nGramMap: Map<string, NGramNode>;
    lastProcessedTimestamp: number;
}

export class SpeculativeMarkovEngine {
    private n = 3; // Order-3 Markov
    private sessionCache = new Map<string, CharacterSessionState>();

    private getOrCreateState(interactionDataId: string, characterId: string): CharacterSessionState {
        const key = `${interactionDataId}-${characterId}`;
        if (!this.sessionCache.has(key)) {
            this.sessionCache.set(key, { nGramMap: new Map(), lastProcessedTimestamp: 0 });
        }
        return this.sessionCache.get(key)!;
    }

    /**
     * FULL TRAIN: Wipes existing state and rebuilds from scratch.
     * Use this when a new chat session is loaded.
     */
    public fullTrain(
        messages: { textContent: string; lastUpdatedTimestamp: number; characterId: string }[],
        interactionDataId: string
    ) {
        // Group by character to handle multi-character sessions efficiently
        const charMessages = new Map<string, { textContent: string; lastUpdatedTimestamp: number }[]>();
        
        for (const msg of messages) {
            if (!charMessages.has(msg.characterId)) {
                charMessages.set(msg.characterId, []);
            }
            charMessages.get(msg.characterId)!.push({
                textContent: msg.textContent,
                lastUpdatedTimestamp: msg.lastUpdatedTimestamp
            });
        }

        for (const [charId, msgs] of charMessages.entries()) {
            const state = this.getOrCreateState(interactionDataId, charId);
            state.nGramMap.clear(); // Wipe slate clean
            state.lastProcessedTimestamp = 0;
            
            for (const msg of msgs) {
                this.addMessageToMap(state.nGramMap, msg.textContent);
                state.lastProcessedTimestamp = Math.max(state.lastProcessedTimestamp, msg.lastUpdatedTimestamp);
            }
        }
    }

    /**
     * INCREMENTAL SYNC: Only processes messages newer than the last sync.
     * Use this during streaming to catch up on new turns.
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
        // Updated regex to explicitly include whitespace (\s+), numbers/words (\w+), and punctuation ([^\w\s])
        const tokens = textContent.match(/\w+|\s+|[^\w\s]/g) || [];
        
        for (let i = 0; i <= tokens.length - this.n; i++) {
            const prefix = tokens.slice(i, i + this.n - 1).join(' ');
            const nextToken = tokens[i + this.n - 1];
            
            if (!map.has(prefix)) {
                map.set(prefix, { nextTokens: new Map(), totalCount: 0 });
            }
            const node = map.get(prefix)!;
            node.nextTokens.set(nextToken, (node.nextTokens.get(nextToken) || 0) + 1);
            node.totalCount++;
        }
    }

    /**
     * PREDICT: Greedily generates tokens until confidence drops below the financial threshold.
     * Formula: confidenceThreshold = cacheMissCost / outputCost
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
        // Updated regex to match the training tokenization
        const tokens = currentText.match(/\w+|\s+|[^\w\s]/g) || [];
        if (tokens.length < this.n - 1) return null;

        // FORMULA 1: The confidence threshold required to continue generating
        const confidenceThreshold = cacheMissCost / outputCost;

        const appendedTokens: string[] = [];
        let currentPrefix = tokens.slice(-(this.n - 1)).join(' ');

        // Loop until confidence drops or we hit a safety cap (100 tokens)
        for (let i = 0; i < 100; i++) {
            const node = map.get(currentPrefix);
            if (!node || node.totalCount === 0) break;

            let maxProb = 0;
            const weights = new Map<string, number>();
            let totalWeight = 0;

            for (const [token, count] of node.nextTokens.entries()) {
                const prob = count / node.totalCount;
                if (prob > maxProb) maxProb = prob;

                const weight = prob ** (1 / temperature);
                weights.set(token, weight);
                totalWeight += weight;
            }

            // STOP CONDITION: If the best guess isn't confident enough, stop.
            if (maxProb < confidenceThreshold) {
                break; 
            }

            // Weighted Random Sampling
            let random = Math.random() * totalWeight;
            let selectedToken = '';
            for (const [token, weight] of weights.entries()) {
                random -= weight;
                if (random <= 0) {
                    selectedToken = token;
                    break;
                }
            }
            if (!selectedToken) selectedToken = Array.from(node.nextTokens.keys())[0];

            appendedTokens.push(selectedToken);
            const newTokens = [...currentPrefix.split(' '), selectedToken];
            currentPrefix = newTokens.slice(-(this.n - 1)).join(' ');
        }

        if (appendedTokens.length > 0) {
            const joined = appendedTokens.join('');
            const lastChar = currentText.slice(-1);
            
            // Prevent double-spacing if the Markov chain naturally predicted a leading space
            const alreadyHasLeadingSpace = /^\s/.test(joined);
            const needsSpace = !/[\s\p{P}]/u.test(lastChar) && !alreadyHasLeadingSpace;
            
            return (needsSpace ? ' ' : '') + joined; 
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