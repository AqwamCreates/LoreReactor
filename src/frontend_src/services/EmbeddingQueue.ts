// src/frontend_src/services/EmbeddingQueue.ts
import { embeddingEngine } from './EmbeddingEngine';

interface EmbeddingTask {
    id: string;
    text: string;
    resolve: (embedding: number[] | null) => void;
}

class EmbeddingQueue {
    private queue: EmbeddingTask[] = [];
    private isProcessing = false;

    async enqueue(id: string, text: string): Promise<number[] | null> {
        return new Promise((resolve) => {
            this.queue.push({ id, text, resolve });
            this.processQueue();
        });
    }

    private async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const task = this.queue.shift()!;
            try {
                // The engine already knows its device preference from App.tsx
                const embedding = await embeddingEngine.embed(task.text);
                task.resolve(embedding);
            } catch (err) {
                console.error('[EmbeddingQueue] Embedding failed:', err);
                task.resolve(null);
            }
        }
        
        this.isProcessing = false;
    }
    
    getQueueLength(): number {
        return this.queue.length;
    }
}

export const embeddingQueue = new EmbeddingQueue();