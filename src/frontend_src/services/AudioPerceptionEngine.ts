// src/frontend_src/services/AudioPerceptionEngine.ts
import * as ort from 'onnxruntime-web';
import type { deviceType } from '../types';

// YAMNet AudioSet 521-class classifier converted to ONNX (Apache-2.0 Licensed)
const YAMNET_MODEL_URL = 'https://huggingface.co/audiomagic/yamnet-onnx/resolve/main/yamnet.onnx';

const SAMPLE_RATE = 16000;
const BUFFER_LENGTH_SAMPLES = 15600; // ~0.975 seconds of audio required by YAMNet
const DEFAULT_INTERVAL_MS = 1000;
const SILENCE_RMS_THRESHOLD = 0.012; // Skips neural net during silence to save 100% CPU
const CONFIDENCE_THRESHOLD = 0.35; // Calibrated acoustic threshold
const IDLE_UNLOAD_MS = 3 * 60 * 1000; // 3 minutes

export type AudioPerceptionStatus = 'idle' | 'loading' | 'monitoring';

// AudioSet class indices for real-world non-verbal triggers
export const TARGET_ACOUSTIC_CLASSES: Record<string, number[]> = {
    sigh: [23, 33],                       // Sigh, Groan (audible yawn / physical exhaustion)
    laughter: [13, 14, 15, 16, 17, 18],   // Laughter, Giggle, Snicker, Belly laugh, Chuckle
    gasp: [39, 40],                       // Gasp, Pant (shock, surprise)
    crying: [19, 21, 22],                 // Crying/sobbing, Whimper, Wail/moan
    cough: [42, 43],                      // Cough, Throat clearing
    sneeze: [44],                         // Sneeze
    snore: [38],                          // Snoring (asleep at desk)
    shout: [6, 9, 11],                    // Shout, Yell, Screaming
};

export interface AudioPerceptionMonitorOptions {
    onAudioEvent: (eventType: string, confidence: number) => void;
    intervalMs?: number;
    devicePreference?: deviceType;
}

async function isWebGpuAvailable(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false;
    try {
        const adapter = await navigator.gpu.requestAdapter();
        return adapter !== null;
    } catch {
        return false;
    }
}

class AudioPerceptionEngine {
    private session: ort.InferenceSession | null = null;
    private loading: Promise<void> | null = null;
    private loadError: string | null = null;
    private usingWebGpu = false;
    private sessionEpoch = 0;
    private inferPromise: Promise<boolean> | null = null;

    private currentDevicePreference: deviceType = 'auto';

    // Web Audio Pipeline
    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private processorNode: ScriptProcessorNode | null = null;
    
    // Circular waveform buffer at 16kHz
    private circularBuffer = new Float32Array(SAMPLE_RATE * 2);
    private writeIndex = 0;
    private totalSamplesReceived = 0;

    // Acoustic Excitation Accumulator (0.0 to 5.0)
    private accumulatedAudio = 0;

    // State
    private status: AudioPerceptionStatus = 'idle';
    private statusListeners = new Set<(status: AudioPerceptionStatus) => void>();
    private monitoringActive = false;
    private isPaused = false;
    private monitorEpoch = 0;
    private tickTimer: ReturnType<typeof setTimeout> | null = null;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;

    private onAudioEvent: ((eventType: string, confidence: number) => void) | null = null;
    private intervalMs = DEFAULT_INTERVAL_MS;

    constructor() {
        if (!ort.env.wasm.wasmPaths) {
            ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
        }
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.simd = true;
    }

    private setStatus(status: AudioPerceptionStatus): void {
        if (this.status !== status) {
            this.status = status;
            for (const listener of this.statusListeners) {
                try { listener(status); } catch {}
            }
        }
    }

    onStatusChange(listener: (status: AudioPerceptionStatus) => void): () => void {
        this.statusListeners.add(listener);
        listener(this.status);
        return () => { this.statusListeners.delete(listener); };
    }

    getStatus(): AudioPerceptionStatus {
        return this.status;
    }

    /** Returns current accumulated acoustic excitation (0.0 to 5.0) */
    getAccumulatedAudio(): number {
        return this.accumulatedAudio;
    }

    /** Clears acoustic energy once an AI has responded */
    resetAccumulatedAudio(): void {
        this.accumulatedAudio = 0;
    }

    /** Prevents the AI's own TTS speaker playback from triggering YAMNet */
    setPaused(paused: boolean): void {
        if (this.isPaused === paused) return;
        this.isPaused = paused;
        if (paused) {
            this.accumulatedAudio = 0;
        } else {
            this.circularBuffer.fill(0);
            this.writeIndex = 0;
            this.totalSamplesReceived = 0;
            this.accumulatedAudio = 0;
        }
    }

    setDevicePreference(preference: deviceType): void {
        if (this.currentDevicePreference !== preference) {
            this.currentDevicePreference = preference;

            if (this.session || this.loading) {
                const isGpu = this.usingWebGpu;
                const wantsCpu = preference === 'cpu';
                const wantsGpu = preference === 'gpu';

                if ((wantsCpu && isGpu) || (wantsGpu && !isGpu) || preference === 'auto') {
                    console.log(`[AudioPerceptionEngine] Device preference changed to ${preference}. Unloading to lazy-reload.`);
                    void this.unloadSession();
                }
            }
        }
    }

    private clearIdleTimer(): void {
        if (this.idleTimer !== null) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    private resetIdleTimer(): void {
        this.clearIdleTimer();
        this.idleTimer = setTimeout(() => {
            if (!this.monitoringActive && this.status === 'idle') {
                console.log('[AudioPerceptionEngine] Idle for 3 minutes, unloading.');
                void this.unload();
            }
        }, IDLE_UNLOAD_MS);
    }

    private async createSessionWithFallback(): Promise<{ session: ort.InferenceSession; usingWebGpu: boolean } | null> {
        const devicePreference = this.currentDevicePreference;
        const webGpuAvailable = devicePreference !== 'cpu' ? await isWebGpuAvailable() : false;

        if (webGpuAvailable && devicePreference !== 'cpu') {
            try {
                console.log('[AudioPerceptionEngine] Loading YAMNet ONNX with WebGPU...');
                const session = await ort.InferenceSession.create(YAMNET_MODEL_URL, {
                    executionProviders: ['webgpu'],
                });
                return { session, usingWebGpu: true };
            } catch (e) {
                console.warn('[AudioPerceptionEngine] WebGPU failed, falling back to WASM:', e instanceof Error ? e.message : String(e));
                if (devicePreference === 'gpu') {
                    this.loadError = 'WebGPU forced but failed. Falling back to CPU/WASM.';
                }
            }
        }

        console.log('[AudioPerceptionEngine] Loading YAMNet ONNX with WASM...');
        const session = await ort.InferenceSession.create(YAMNET_MODEL_URL, {
            executionProviders: ['wasm'],
        });
        return { session, usingWebGpu: false };
    }

    async initialize(): Promise<boolean> {
        if (this.session) {
            if (!this.monitoringActive) this.resetIdleTimer();
            return true;
        }
        if (this.loading) {
            await this.loading;
            return this.session !== null;
        }

        const epoch = ++this.sessionEpoch;
        this.loadError = null;

        this.loading = (async () => {
            try {
                const created = await this.createSessionWithFallback();
                if (!created) return;

                if (epoch !== this.sessionEpoch) {
                    try { await created.session.release(); } catch {}
                    return;
                }

                this.session = created.session;
                this.usingWebGpu = created.usingWebGpu;
                console.log(`[AudioPerceptionEngine] Ready (${this.usingWebGpu ? 'WebGPU' : 'WASM'}).`);
            } catch (e) {
                if (epoch === this.sessionEpoch) {
                    const msg = e instanceof Error ? e.message : String(e);
                    console.error('[AudioPerceptionEngine] Initialization failed:', msg);
                    this.loadError = msg;
                    this.session = null;
                    this.usingWebGpu = false;
                }
            } finally {
                if (epoch === this.sessionEpoch) {
                    this.loading = null;
                }
            }
        })();

        await this.loading;
        return this.session !== null;
    }

    private async setupAudioStream(): Promise<boolean> {
        try {
            if (this.audioContext && this.audioContext.state === 'running' && this.mediaStream) {
                return true;
            }

            this.teardownAudioStream();

            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            this.audioContext = new AudioCtx({ sampleRate: SAMPLE_RATE });

            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: SAMPLE_RATE,
                    echoCancellation: true,
                    noiseSuppression: false,
                    autoGainControl: true,
                },
                video: false,
            });

            this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
            this.processorNode.onaudioprocess = (e) => {
                if (this.isPaused) return;
                const inputData = e.inputBuffer.getChannelData(0);
                const bufLen = this.circularBuffer.length;

                for (let i = 0; i < inputData.length; i++) {
                    this.circularBuffer[this.writeIndex] = inputData[i];
                    this.writeIndex = (this.writeIndex + 1) % bufLen;
                }
                this.totalSamplesReceived += inputData.length;
            };

            this.sourceNode.connect(this.processorNode);
            this.processorNode.connect(this.audioContext.destination);

            return true;
        } catch (e) {
            console.warn('[AudioPerceptionEngine] Audio stream setup failed:', e);
            this.teardownAudioStream();
            return false;
        }
    }

    private teardownAudioStream(): void {
        if (this.processorNode) {
            this.processorNode.disconnect();
            this.processorNode.onaudioprocess = null;
            this.processorNode = null;
        }
        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }
        if (this.mediaStream) {
            for (const track of this.mediaStream.getTracks()) track.stop();
            this.mediaStream = null;
        }
        if (this.audioContext) {
            try { void this.audioContext.close(); } catch {}
            this.audioContext = null;
        }
        this.writeIndex = 0;
        this.totalSamplesReceived = 0;
    }

    private getLatestSampleWindow(): Float32Array | null {
        if (this.totalSamplesReceived < BUFFER_LENGTH_SAMPLES) return null;

        const window = new Float32Array(BUFFER_LENGTH_SAMPLES);
        const bufLen = this.circularBuffer.length;
        let readIdx = (this.writeIndex - BUFFER_LENGTH_SAMPLES + bufLen) % bufLen;

        for (let i = 0; i < BUFFER_LENGTH_SAMPLES; i++) {
            window[i] = this.circularBuffer[readIdx];
            readIdx = (readIdx + 1) % bufLen;
        }

        return window;
    }

    private computeRms(samples: Float32Array): number {
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
            sum += samples[i] * samples[i];
        }
        return Math.sqrt(sum / samples.length);
    }

    async detectFromBuffer(): Promise<boolean> {
        if (this.isPaused || !this.session) return false;
        if (this.inferPromise) return this.inferPromise;

        const samples = this.getLatestSampleWindow();
        if (!samples) return false;

        // ─── NOISE GATE: 0% CPU WASTE ON SILENCE ───
        const rms = this.computeRms(samples);
        if (rms < SILENCE_RMS_THRESHOLD) return false;

        const runEpoch = this.sessionEpoch;

        const task = (async (): Promise<boolean> => {
            let inputTensor: ort.Tensor | null = null;
            let results: ort.InferenceSession.OnnxValueMapType | null = null;

            try {
                const inputName = this.session!.inputNames[0] || 'waveform';
                inputTensor = new ort.Tensor('float32', samples, [samples.length]);
                results = await this.session!.run({ [inputName]: inputTensor });

                if (runEpoch !== this.sessionEpoch || this.isPaused) return false;

                const outputName = this.session!.outputNames[0] || 'output_0';
                const outputTensor = results[outputName];
                if (!outputTensor) return false;

                const scoresData = outputTensor.data as Float32Array;
                const numClasses = 521;
                const numFrames = Math.floor(scoresData.length / numClasses);

                const meanScores = new Float32Array(numClasses);
                for (let f = 0; f < numFrames; f++) {
                    const offset = f * numClasses;
                    for (let c = 0; c < numClasses; c++) {
                        meanScores[c] += scoresData[offset + c];
                    }
                }
                for (let c = 0; c < numClasses; c++) {
                    meanScores[c] /= Math.max(1, numFrames);
                }

                let bestClass: string | null = null;
                let maxConfidence = 0;

                for (const [eventName, classIndices] of Object.entries(TARGET_ACOUSTIC_CLASSES)) {
                    for (const idx of classIndices) {
                        const conf = meanScores[idx];
                        if (conf > CONFIDENCE_THRESHOLD && conf > maxConfidence) {
                            maxConfidence = conf;
                            bestClass = eventName;
                        }
                    }
                }

                if (bestClass && maxConfidence > 0) {
                    this.accumulatedAudio = Math.min(5.0, (this.accumulatedAudio * 0.80) + (maxConfidence * 2.5));
                    console.log(`[AudioPerceptionEngine] Detected acoustic cue: ${bestClass} (${(maxConfidence * 100).toFixed(1)}%)`);
                    this.onAudioEvent?.(bestClass, maxConfidence);
                    return true;
                }

                return false;
            } catch (e) {
                console.warn('[AudioPerceptionEngine] Inference failed:', e);
                if (this.usingWebGpu && runEpoch === this.sessionEpoch) {
                    console.warn('[AudioPerceptionEngine] Falling back to WASM after WebGPU runtime failure.');
                    this.currentDevicePreference = 'cpu';
                    if (results) {
                        for (const tensor of Object.values(results)) {
                            try { tensor?.dispose(); } catch {}
                        }
                        results = null;
                    }
                    if (inputTensor) {
                        try { inputTensor.dispose(); } catch {}
                        inputTensor = null;
                    }
                    try { await this.session?.release(); } catch {}
                    if (runEpoch === this.sessionEpoch) {
                        this.session = null;
                        this.usingWebGpu = false;
                    }
                }
                return false;
            } finally {
                if (results) {
                    for (const tensor of Object.values(results)) {
                        try { tensor?.dispose(); } catch {}
                    }
                }
                if (inputTensor) {
                    try { inputTensor.dispose(); } catch {}
                }
            }
        })();

        this.inferPromise = task;
        try {
            return await task;
        } finally {
            if (this.inferPromise === task) {
                this.inferPromise = null;
            }
        }
    }

    async startMonitoring(options: AudioPerceptionMonitorOptions): Promise<boolean> {
        const epoch = ++this.monitorEpoch;
        this.clearIdleTimer();

        if (this.tickTimer !== null) {
            clearTimeout(this.tickTimer);
            this.tickTimer = null;
        }

        this.onAudioEvent = options.onAudioEvent;
        this.intervalMs = Math.max(250, options.intervalMs || DEFAULT_INTERVAL_MS);
        this.accumulatedAudio = 0;

        if (options.devicePreference) {
            this.setDevicePreference(options.devicePreference);
        }

        this.monitoringActive = true;
        this.setStatus('loading');

        const [loaded, streamReady] = await Promise.all([
            this.initialize(),
            this.setupAudioStream(),
        ]);

        if (epoch !== this.monitorEpoch || !this.monitoringActive) {
            return false;
        }

        if (!loaded || !streamReady) {
            this.monitoringActive = false;
            this.setStatus('idle');
            return false;
        }

        this.setStatus('monitoring');
        this.scheduleNextTick(epoch, 0);
        return true;
    }

    updateMonitoringOptions(
        options: Partial<Pick<AudioPerceptionMonitorOptions, 'intervalMs' | 'devicePreference' | 'onAudioEvent'>>
    ): void {
        if (options.onAudioEvent) this.onAudioEvent = options.onAudioEvent;
        if (options.devicePreference !== undefined) this.setDevicePreference(options.devicePreference);
        if (options.intervalMs !== undefined) {
            const next = Math.max(250, options.intervalMs);
            if (next !== this.intervalMs) {
                this.intervalMs = next;
                if (this.monitoringActive && this.tickTimer !== null) {
                    clearTimeout(this.tickTimer);
                    this.tickTimer = null;
                    this.scheduleNextTick(this.monitorEpoch, this.intervalMs);
                }
            }
        }
    }

    stopMonitoring(scheduleIdleUnload = true): void {
        this.monitorEpoch++;
        this.monitoringActive = false;

        if (this.tickTimer !== null) {
            clearTimeout(this.tickTimer);
            this.tickTimer = null;
        }

        this.onAudioEvent = null;
        this.accumulatedAudio = 0;
        this.teardownAudioStream();
        this.setStatus('idle');

        if (scheduleIdleUnload && this.session) {
            this.resetIdleTimer();
        }
    }

    private async unloadSession(): Promise<void> {
        this.sessionEpoch++;
        if (this.loading) {
            try { await this.loading; } catch {}
        }
        if (this.inferPromise) {
            try { await this.inferPromise; } catch {}
        }
        const active = this.session;
        this.session = null;
        this.loading = null;
        this.usingWebGpu = false;
        if (active) {
            try { await active.release(); } catch {}
        }
    }

    async unload(): Promise<void> {
        this.clearIdleTimer();
        this.stopMonitoring(false);
        await this.unloadSession();
        this.loadError = null;
        this.accumulatedAudio = 0;
        this.setStatus('idle');
        console.log('[AudioPerceptionEngine] Unloaded.');
    }

    private scheduleNextTick(epoch: number, delayMs: number): void {
        if (!this.monitoringActive || epoch !== this.monitorEpoch) return;

        if (this.tickTimer !== null) {
            clearTimeout(this.tickTimer);
            this.tickTimer = null;
        }

        this.tickTimer = setTimeout(() => {
            this.tickTimer = null;
            void this.runTick(epoch);
        }, delayMs);
    }

    private async runTick(epoch: number): Promise<void> {
        if (!this.monitoringActive || epoch !== this.monitorEpoch) return;
        const start = performance.now();

        try {
            const detectedThisTick = await this.detectFromBuffer();
            if (!detectedThisTick) {
                this.accumulatedAudio = this.accumulatedAudio < 0.01 ? 0 : this.accumulatedAudio * 0.80;
            }
        } catch (e) {
            console.warn('[AudioPerceptionEngine] Tick error:', e);
        } finally {
            if (this.monitoringActive && epoch === this.monitorEpoch) {
                const elapsed = performance.now() - start;
                const nextDelay = Math.max(100, this.intervalMs - elapsed);
                this.scheduleNextTick(epoch, nextDelay);
            }
        }
    }

    isReady(): boolean {
        return this.session !== null;
    }

    isMonitoring(): boolean {
        return this.monitoringActive;
    }

    isUsingWebGpu(): boolean {
        return this.usingWebGpu;
    }

    getError(): string | null {
        return this.loadError;
    }
}

export const audioPerceptionEngine = new AudioPerceptionEngine();