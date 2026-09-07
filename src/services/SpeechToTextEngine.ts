// src/services/SpeechToTextEngine.ts

const HF_MODEL_ID = 'Xenova/whisper-tiny.en';
const IDLE_UNLOAD_MS = 3 * 60 * 1000; // 3 minutes

type AutomaticSpeechRecognitionPipeline = (audio: Float32Array | Float32Array[]) => Promise<{ text: string }>;

async function isWebGpuAvailable(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false;
    try {
        const adapter = await navigator.gpu.requestAdapter();
        return adapter !== null;
    } catch {
        return false;
    }
}

class SpeechToTextEngine {
    private pipeline: AutomaticSpeechRecognitionPipeline | null = null;
    private loading: Promise<void> | null = null;
    private loadError: string | null = null;
    private usingWebGpu = false;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;

    // Audio capture state
    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private processorNode: ScriptProcessorNode | null = null;
    private audioChunks: Float32Array[] = [];
    private isRecording = false;
    private onPartialTranscription: ((text: string) => void) | null = null;
    private transcriptionInterval: ReturnType<typeof setInterval> | null = null;

    /**
     * Load the model. Called automatically on first startRecording().
     * Safe to call multiple times.
     */
    private async ensureLoaded(): Promise<boolean> {
        if (this.pipeline) {
            this.resetIdleTimer();
            return true;
        }
        if (this.loading) {
            await this.loading;
            return this.pipeline !== null;
        }

        this.loading = (async () => {
            const { pipeline } = await import('@huggingface/transformers');

            const webGpuAvailable = await isWebGpuAvailable();

            if (webGpuAvailable) {
                try {
                    console.log('[STTEngine] Loading Whisper with WebGPU...');
                    this.pipeline = await pipeline('automatic-speech-recognition', HF_MODEL_ID, {
                        dtype: 'fp32',
                        device: 'webgpu',
                    }) as AutomaticSpeechRecognitionPipeline;
                    this.usingWebGpu = true;
                    console.log('[STTEngine] Ready (WebGPU).');
                    return;
                } catch (e) {
                    console.warn('[STTEngine] WebGPU failed, falling back to CPU:', e instanceof Error ? e.message : String(e));
                    this.pipeline = null;
                }
            }

            try {
                console.log('[STTEngine] Loading Whisper with CPU/WASM...');
                this.pipeline = await pipeline('automatic-speech-recognition', HF_MODEL_ID, {
                    dtype: 'fp32',
                    device: 'cpu',
                }) as AutomaticSpeechRecognitionPipeline;
                this.usingWebGpu = false;
                console.log('[STTEngine] Ready (CPU).');
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error('[STTEngine] Initialization failed:', msg);
                this.loadError = msg;
                this.pipeline = null;
            } finally {
                this.loading = null;
            }
        })();

        await this.loading;
        return this.pipeline !== null;
    }

    /**
     * Reset the idle unload timer. Called on every meaningful interaction.
     */
    private resetIdleTimer(): void {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => {
            if (!this.isRecording) {
                console.log('[STTEngine] Idle for 3 minutes, unloading.');
                this.unload();
            }
        }, IDLE_UNLOAD_MS);
    }

    /**
     * Clear the idle timer without triggering unload.
     */
    private clearIdleTimer(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    /**
     * Unload the model and stop any active recording.
     */
    async unload(): Promise<void> {
        this.clearIdleTimer();
        this.stopRecordingSync();

        if (this.loading) {
            try { await this.loading; } catch { /* ignore */ }
        }

        this.pipeline = null;
        this.loading = null;
        this.loadError = null;
        this.usingWebGpu = false;
        console.log('[STTEngine] Unloaded.');
    }

    /**
     * Start recording. Loads the model on first call if not already loaded.
     * @param onPartialTranscription Callback invoked periodically with partial results
     * @param transcriptionIntervalMs How often to transcribe accumulated audio (default 2000ms)
     * @returns true if recording started successfully, false otherwise
     */
    async startRecording(
        onPartialTranscription: (text: string) => void,
        transcriptionIntervalMs = 2000,
    ): Promise<boolean> {
        // Load model on demand
        const loaded = await this.ensureLoaded();
        if (!loaded) {
            console.warn('[STTEngine] Model failed to load.');
            return false;
        }

        if (this.isRecording) return true;

        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                },
            });

            this.audioContext = new AudioContext({ sampleRate: 16000 });
            this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);

            this.processorNode.onaudioprocess = (event) => {
                if (!this.isRecording) return;
                const inputData = event.inputBuffer.getChannelData(0);
                this.audioChunks.push(new Float32Array(inputData));
            };

            this.sourceNode.connect(this.processorNode);
            this.processorNode.connect(this.audioContext.destination);

            this.isRecording = true;
            this.onPartialTranscription = onPartialTranscription;
            this.audioChunks = [];

            // Pause idle timer while recording
            this.clearIdleTimer();

            this.transcriptionInterval = setInterval(() => {
                this.transcribeAccumulated();
            }, transcriptionIntervalMs);

            console.log('[STTEngine] Recording started.');
            return true;
        } catch (e) {
            console.error('[STTEngine] Failed to start recording:', e);
            this.cleanupAudio();
            return false;
        }
    }

    /**
     * Stop recording asynchronously. Transcribes remaining audio before cleaning up.
     * Restarts the idle timer so the model unloads after 3 minutes of inactivity.
     */
    async stopRecording(): Promise<string | null> {
        if (!this.isRecording) return null;

        this.isRecording = false;

        if (this.transcriptionInterval) {
            clearInterval(this.transcriptionInterval);
            this.transcriptionInterval = null;
        }

        const finalText = await this.transcribeAccumulated();
        this.cleanupAudio();
        this.onPartialTranscription = null;

        // Restart idle timer — model stays loaded for 3 minutes in case user records again
        this.resetIdleTimer();

        console.log('[STTEngine] Recording stopped.');
        return finalText;
    }

    /**
     * Synchronous stop for unload() — skips final transcription.
     */
    private stopRecordingSync(): void {
        if (!this.isRecording) return;

        this.isRecording = false;

        if (this.transcriptionInterval) {
            clearInterval(this.transcriptionInterval);
            this.transcriptionInterval = null;
        }

        this.cleanupAudio();
        this.onPartialTranscription = null;
        this.audioChunks = [];
    }

    private async transcribeAccumulated(): Promise<string | null> {
        if (this.audioChunks.length === 0 || !this.pipeline) return null;

        try {
            const totalLength = this.audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
            if (totalLength < 1600) return null;

            const combined = new Float32Array(totalLength);
            let offset = 0;
            for (const chunk of this.audioChunks) {
                combined.set(chunk, offset);
                offset += chunk.length;
            }

            this.audioChunks = [];

            const result = await this.pipeline(combined);
            const text = result.text?.trim();

            if (text && text.length > 0 && this.onPartialTranscription) {
                this.onPartialTranscription(text);
            }

            return text || null;
        } catch (e) {
            console.warn('[STTEngine] Transcription failed:', e);
            return null;
        }
    }

    private cleanupAudio(): void {
        if (this.processorNode) {
            this.processorNode.disconnect();
            this.processorNode = null;
        }
        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
        if (this.audioContext) {
            this.audioContext.close().catch(() => {});
            this.audioContext = null;
        }
        this.audioChunks = [];
    }

    isReady(): boolean {
        return this.pipeline !== null;
    }

    getIsRecording(): boolean {
        return this.isRecording;
    }

    isUsingWebGpu(): boolean {
        return this.usingWebGpu;
    }

    getError(): string | null {
        return this.loadError;
    }
}

export const speechToTextEngine = new SpeechToTextEngine();