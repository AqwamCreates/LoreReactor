// frontend_src/services/SpeechToTextEngine.ts

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

/**
 * Converts a 1–100 sensitivity slider value to a linear RMS energy threshold.
 * Uses logarithmic dBFS mapping (-60 dBFS quiet floor to -10 dBFS loud speech)
 * matching human auditory perception and digital mic response curves.
 */
function sliderToRms(sliderValue: number): number {
    const clamped = Math.max(1, Math.min(100, sliderValue));
    const minDb = -60; // Quiet room noise floor
    const maxDb = -10; // Loud vocal ceiling
    const db = minDb + (clamped / 100) * (maxDb - minDb);
    return Math.pow(10, db / 20);
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

    // ─── Dual-Threshold Hysteresis & VAD State ──────────────────────
    private isAutoListening = false;
    private silenceTimer: ReturnType<typeof setTimeout> | null = null;
    private hasDetectedSpeech = false;
    private onAutoSend: ((text: string) => void) | null = null;
    private silenceThresholdMs = 1400;
    private activationRmsThreshold = sliderToRms(18); // ~ -51 dBFS (Conversational entry)
    private silenceRmsThreshold = sliderToRms(8);     // ~ -56 dBFS (Silence floor cutoff)

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

    private resetIdleTimer(): void {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => {
            if (!this.isRecording && !this.isAutoListening) {
                console.log('[STTEngine] Idle for 3 minutes, unloading.');
                this.unload();
            }
        }, IDLE_UNLOAD_MS);
    }

    private clearIdleTimer(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

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
     * Shared transcription entry point so other engines (like AudioPerceptionEngine)
     * can transcribe buffers directly using the single shared Whisper pipeline in memory.
     */
    async transcribeBuffer(buffer: Float32Array): Promise<string | null> {
        const loaded = await this.ensureLoaded();
        if (!loaded || !this.pipeline) return null;

        try {
            this.resetIdleTimer();
            const result = await this.pipeline(buffer);
            return result.text?.trim() || null;
        } catch (e) {
            console.warn('[STTEngine] Buffer transcription failed:', e);
            return null;
        }
    }

    /**
     * Start continuous auto-listening mode with Logarithmic Hysteresis Noise Gate.
     * @param onPartial Callback receiving real-time transcription fragments
     * @param onAutoSend Callback invoked when speech finishes and is ready to send
     * @param options Configuration for activation, silence cutoffs, and pause duration
     */
    async startAutoListening(
        onPartial: (text: string) => void,
        onAutoSend: (text: string) => void,
        options?: { 
            volumeActivationThresholdPercent?: number; 
            silenceVolumeActivationThresholdPercent?: number;
            silenceThresholdMs?: number;
        }
    ): Promise<boolean> {
        const loaded = await this.ensureLoaded();
        if (!loaded) return false;

        if (this.isRecording) {
            this.stopRecordingSync();
        }

        // Acoustic defaults: 18% activation gate, 8% silence cutoff, 1400ms duration
        const actPct = options?.volumeActivationThresholdPercent ?? 18;
        const silPct = options?.silenceVolumeActivationThresholdPercent ?? 8;

        this.activationRmsThreshold = sliderToRms(actPct);
        const targetSilRms = sliderToRms(silPct);

        // Enforce acoustic hysteresis: silence threshold is guaranteed below activation
        this.silenceRmsThreshold = Math.min(targetSilRms, this.activationRmsThreshold * 0.7);
        this.silenceThresholdMs = options?.silenceThresholdMs ?? 1400;

        this.isAutoListening = true;
        this.hasDetectedSpeech = false;
        this.onAutoSend = onAutoSend;

        return this.initAudioStream(onPartial);
    }

    async startRecording(
        onPartialTranscription: (text: string) => void,
        transcriptionIntervalMs = 2000,
    ): Promise<boolean> {
        const loaded = await this.ensureLoaded();
        if (!loaded) return false;

        if (this.isRecording) return true;

        this.isAutoListening = false;
        this.onAutoSend = null;
        return this.initAudioStream(onPartialTranscription, transcriptionIntervalMs);
    }

    private async initAudioStream(
        onPartial: (text: string) => void,
        transcriptionIntervalMs = 2000
    ): Promise<boolean> {
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

                // ─── Dual-Threshold Hysteresis (Schmitt Trigger) ─────────
                if (this.isAutoListening) {
                    let sumSquares = 0;
                    for (let i = 0; i < inputData.length; i++) {
                        sumSquares += inputData[i] * inputData[i];
                    }
                    const rms = Math.sqrt(sumSquares / inputData.length);

                    // 1. High Gate: Crossed activation volume -> Speaking started
                    if (rms >= this.activationRmsThreshold) {
                        this.hasDetectedSpeech = true;
                        if (this.silenceTimer) {
                            clearTimeout(this.silenceTimer);
                            this.silenceTimer = null;
                        }
                    } else if (this.hasDetectedSpeech) {
                        // 2. Low Gate: Sound dropped below silence cutoff -> Start countdown
                        if (rms < this.silenceRmsThreshold) {
                            if (!this.silenceTimer) {
                                this.silenceTimer = setTimeout(() => {
                                    this.triggerAutoSend();
                                }, this.silenceThresholdMs);
                            }
                        } else {
                            // 3. Deadband / Hysteresis: Between Low and High gates
                            // Keeps the turn active and cancels timer to prevent cutting off trailing consonants
                            if (this.silenceTimer) {
                                clearTimeout(this.silenceTimer);
                                this.silenceTimer = null;
                            }
                        }
                    }
                }
            };

            this.sourceNode.connect(this.processorNode);
            this.processorNode.connect(this.audioContext.destination);

            this.isRecording = true;
            this.onPartialTranscription = onPartial;
            this.audioChunks = [];
            this.clearIdleTimer();

            if (!this.isAutoListening) {
                this.transcriptionInterval = setInterval(() => {
                    this.transcribeAccumulated();
                }, transcriptionIntervalMs);
            }

            console.log(`[STTEngine] Audio capture started (AutoVAD=${this.isAutoListening}).`);
            return true;
        } catch (e) {
            console.error('[STTEngine] Failed to start audio:', e);
            this.cleanupAudio();
            return false;
        }
    }

    private async triggerAutoSend(): Promise<void> {
        if (!this.isAutoListening) return;

        // User paused below silence threshold for silenceThresholdMs -> Finalize and send
        const text = await this.stopRecording();
        if (text && text.trim().length > 0 && this.onAutoSend) {
            console.log('[STTEngine] Turn completed. Auto-sending:', text);
            this.onAutoSend(text.trim());
        }
    }

    async stopRecording(): Promise<string | null> {
        if (!this.isRecording) return null;

        this.isRecording = false;
        this.isAutoListening = false;
        this.hasDetectedSpeech = false;

        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }

        if (this.transcriptionInterval) {
            clearInterval(this.transcriptionInterval);
            this.transcriptionInterval = null;
        }

        const finalText = await this.transcribeAccumulated();
        this.cleanupAudio();
        this.onPartialTranscription = null;
        this.resetIdleTimer();

        console.log('[STTEngine] Recording stopped.');
        return finalText;
    }

    private stopRecordingSync(): void {
        if (!this.isRecording) return;

        this.isRecording = false;
        this.isAutoListening = false;
        this.hasDetectedSpeech = false;

        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }

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
            for (const track of this.mediaStream.getTracks()) {
                track.stop();
            }
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

    getIsAutoListening(): boolean {
        return this.isAutoListening;
    }

    isUsingWebGpu(): boolean {
        return this.usingWebGpu;
    }

    getError(): string | null {
        return this.loadError;
    }
}

export const speechToTextEngine = new SpeechToTextEngine();