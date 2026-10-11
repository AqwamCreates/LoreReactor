// frontend_src/services/StreamingVoicePlayer.ts
export class StreamingVoicePlayer {
    private context: AudioContext | null = null;
    private nextStartTime: number = 0;
    private isPlaying: boolean = false;

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

    async enqueue(wavBuffer: ArrayBuffer) {
        if (!this.context || !this.isPlaying) return;

        try {
            const voiceBuffer = await this.context.decodeAudioData(wavBuffer.slice(0));
            if (!this.isPlaying) return;

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

    stop() {
        this.isPlaying = false;
        if (this.context) {
            this.context.close().catch(() => {});
            this.context = null;
        }
        this.nextStartTime = 0;
    }
}