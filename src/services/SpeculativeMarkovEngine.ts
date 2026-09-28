// src/services/SpeculativeMarkovEngine.ts

interface NGramNode {
    nextTokens: Map<string, number>;
    totalCount: number;
}

export class SpeculativeMarkovEngine {
    private n = 3; // Order-3 Markov (looks at the last 2 tokens to predict the 3rd)
    private nGramMap = new Map<string, NGramNode>();
    private lastProcessedTimestamp = 0;
    private currentCharacterId: string | null = null;

    /**
     * Incrementally syncs the engine with new messages.
     * Only processes messages newer than the last sync, or resets entirely if the character changes.
     */
    public syncMessages(
        messages: { textContent: string; lastUpdatedTimestamp: number }[], 
        characterId: string
    ) {
        // If the character changed, wipe the slate clean to maintain voice consistency
        if (this.currentCharacterId !== characterId) {
            this.nGramMap.clear();
            this.lastProcessedTimestamp = 0;
            this.currentCharacterId = characterId;
        }

        // Only process messages that are newer than our last sync
        for (const msg of messages) {
            if (msg.lastUpdatedTimestamp > this.lastProcessedTimestamp) {
                this.addMessageToMap(msg.textContent);
                // Update the high-water mark
                this.lastProcessedTimestamp = Math.max(this.lastProcessedTimestamp, msg.lastUpdatedTimestamp);
            }
        }
    }

    private addMessageToMap(textContent: string) {
        const tokens = textContent.match(/\w+|[^\w\s]/g) || [];
        
        for (let i = 0; i <= tokens.length - this.n; i++) {
            const prefix = tokens.slice(i, i + this.n - 1).join(' ');
            const nextToken = tokens[i + this.n - 1];
            
            if (!this.nGramMap.has(prefix)) {
                this.nGramMap.set(prefix, { nextTokens: new Map(), totalCount: 0 });
            }
            const node = this.nGramMap.get(prefix)!;
            node.nextTokens.set(nextToken, (node.nextTokens.get(nextToken) || 0) + 1);
            node.totalCount++;
        }
    }

    /**
     * Predicts the next sequence of tokens using temperature-scaled weighted sampling.
     */
    public predictSequence(
        currentText: string, 
        minConfidence: number, 
        maxTokens = 3,
        temperature = 1
    ): string | null {
        const tokens = currentText.match(/\w+|[^\w\s]/g) || [];
        if (tokens.length < this.n - 1) return null;

        const appendedTokens: string[] = [];
        let currentPrefix = tokens.slice(-(this.n - 1)).join(' ');

        for (let i = 0; i < maxTokens; i++) {
            const node = this.nGramMap.get(currentPrefix);
            if (!node || node.totalCount === 0) break;

            let maxProb = 0;
            const weights = new Map<string, number>();
            let totalWeight = 0;

            for (const [token, count] of node.nextTokens.entries()) {
                const prob = count / node.totalCount;
                if (prob > maxProb) maxProb = prob;

                // Temperature-scaled weight
                const weight = prob ** (1 / temperature);
                weights.set(token, weight);
                totalWeight += weight;
            }

            // BREAK-EVEN CHECK
            if (maxProb < minConfidence) {
                break; 
            }

            // WEIGHTED RANDOM SAMPLING
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
            const needsSpace = !/[\s\p{P}]/u.test(lastChar);
            return (needsSpace ? ' ' : '') + joined; 
        }

        return null;
    }
}

export const speculativeMarkovEngine = new SpeculativeMarkovEngine();