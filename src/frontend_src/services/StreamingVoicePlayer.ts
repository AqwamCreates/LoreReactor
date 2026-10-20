// src/frontend_src/services/StreamingVoicePlayer.ts
export class StreamingVoicePlayer {
    private context: AudioContext | null = null;
    private nextStartTime: number = 0;
    private isPlaying: boolean = false;
    
    // Internal queue and processing lock to prevent concurrent Web Audio scheduling
    private playbackQueue: ArrayBuffer[] = [];
    private isProcessingQueue: boolean = false;

    async init() {
        if (!this.context) {
            this.context = new AudioContext();
        }
        if (this.context.state === 'suspended') {
            await this.context.resume();
        }
        this.nextStartTime = this.context.currentTime + 0.1;
        this.isPlaying = true;
    }

    enqueue(wavBuffer: ArrayBuffer) {
        if (!this.context || !this.isPlaying) return;
        this.playbackQueue.push(wavBuffer);
        this.processQueue();
    }

    private async processQueue() {
        // Lock prevents multiple loops from decoding and scheduling out of order
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;

        while (this.playbackQueue.length > 0 && this.isPlaying && this.context) {
            const wavBuffer = this.playbackQueue.shift()!;
            
            try {
                const voiceBuffer = await this.context.decodeAudioData(wavBuffer.slice(0));
                if (!this.isPlaying) break; 

                const source = this.context.createBufferSource();
                source.buffer = voiceBuffer;
                source.connect(this.context.destination);

                if (this.nextStartTime < this.context.currentTime) {
                    this.nextStartTime = this.context.currentTime;
                }

                source.start(this.nextStartTime);
                this.nextStartTime += voiceBuffer.duration;
            } catch (e) {
                console.warn("[StreamingVoicePlayer] Decode failed:", e);
            }
        }

        this.isProcessingQueue = false;
    }

    async waitUntilFinished(): Promise<void> {
        if (!this.context || !this.isPlaying) return;

        while (this.playbackQueue.length > 0 || (this.context && this.context.currentTime < this.nextStartTime)) {
            if (!this.isPlaying || !this.context) break;
            const remainingMs = Math.max(50, (this.nextStartTime - this.context.currentTime) * 1000);
            await new Promise(resolve => setTimeout(resolve, Math.min(remainingMs, 200)));
        }
    }

    stop() {
        this.isPlaying = false;
        this.playbackQueue = [];
        if (this.context) {
            this.context.close().catch(() => {});
            this.context = null;
        }
        this.nextStartTime = 0;
    }
}