// src/frontend_src/services/SpeechToTextEngine.ts
import type { deviceType } from '../types';
import { voiceActivityDetectionEngine } from './VoiceActivityDetectionEngine';

const HF_MODEL_ID = 'Xenova/whisper-tiny';
const IDLE_UNLOAD_MS = 3 * 60 * 1000; // 3 minutes
const PRE_ROLL_DURATION_SECONDS = 1.5; // 1.5s pre-roll to preserve soft sentence starters
const MAX_VAD_QUEUE_SAMPLES = 16000 * PRE_ROLL_DURATION_SECONDS; // 24,000 samples / 1.5s at 16kHz

export type SttStatus = 'idle' | 'loading' | 'listening' | 'recording' | 'transcribing';

type AutomaticSpeechRecognitionPipeline = (audio: Float32Array | Float32Array[], options?: any) => Promise<{ text: string }>;

const WORKLET_PROCESSOR_NAME = 'stt-capture-processor';
const WORKLET_PROCESSOR_CODE = `
class SttCaptureProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 2048;
        this.buffer = new Float32Array(this.bufferSize);
        this.offset = 0;
    }
    process(inputs) {
        const input = inputs[0];
        if (input && input[0] && input[0].length > 0) {
            const channel = input[0];
            let readOffset = 0;
            while (readOffset < channel.length) {
                const space = this.bufferSize - this.offset;
                const toCopy = Math.min(space, channel.length - readOffset);
                this.buffer.set(channel.subarray(readOffset, readOffset + toCopy), this.offset);
                this.offset += toCopy;
                readOffset += toCopy;
                if (this.offset >= this.bufferSize) {
                    const out = this.buffer;
                    this.port.postMessage(out, [out.buffer]);
                    this.buffer = new Float32Array(this.bufferSize);
                    this.offset = 0;
                }
            }
        }
        return true;
    }
}
registerProcessor('${WORKLET_PROCESSOR_NAME}', SttCaptureProcessor);
`;

async function isWebGpuAvailable(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false;
    try {
        const adapter = await navigator.gpu.requestAdapter();
        return adapter !== null;
    } catch {
        return false;
    }
}

function yieldToPaint(): Promise<void> {
    return new Promise((resolve) => {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => setTimeout(resolve, 16));
        } else {
            setTimeout(resolve, 16);
        }
    });
}

function sliderToRms(sliderValue: number): number {
    const clamped = Math.max(1, Math.min(100, sliderValue));
    const minDb = -60;
    const maxDb = -10;
    const db = minDb + (clamped / 100) * (maxDb - minDb);
    return 10 ** (db / 20);
}

function resampleLinear(buffer: Float32Array, fromSampleRate: number, toSampleRate = 16000): Float32Array {
    if (fromSampleRate === toSampleRate) return buffer;
    const ratio = fromSampleRate / toSampleRate;
    const newLength = Math.max(1, Math.round(buffer.length / ratio));
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
        const pos = i * ratio;
        const idx = Math.floor(pos);
        const frac = pos - idx;
        const next = idx + 1 < buffer.length ? idx + 1 : idx;
        result[i] = buffer[idx] * (1 - frac) + buffer[next] * frac;
    }
    return result;
}

async function resampleOfflineTo16k(audioData: Float32Array, sourceRate: number): Promise<Float32Array> {
    if (sourceRate === 16000) return audioData;
    try {
        const targetLength = Math.max(1, Math.round((audioData.length * 16000) / sourceRate));
        const offlineCtx = new OfflineAudioContext(1, targetLength, 16000);
        const audioBuffer = offlineCtx.createBuffer(1, audioData.length, sourceRate);
        audioBuffer.getChannelData(0).set(audioData);
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineCtx.destination);
        source.start(0);
        const rendered = await offlineCtx.startRendering();
        return rendered.getChannelData(0);
    } catch {
        return resampleLinear(audioData, sourceRate, 16000);
    }
}

function getMaxWindowRms(buffer: Float32Array, windowSize = 512): number {
    if (buffer.length === 0) return 0;
    if (buffer.length <= windowSize) {
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
        return Math.sqrt(sum / buffer.length);
    }
    let maxRms = 0;
    let i = 0;
    for (; i + windowSize <= buffer.length; i += windowSize) {
        let sum = 0;
        for (let j = i; j < i + windowSize; j++) {
            sum += buffer[j] * buffer[j];
        }
        const rms = Math.sqrt(sum / windowSize);
        if (rms > maxRms) maxRms = rms;
    }
    if (i < buffer.length) {
        let sum = 0;
        const remaining = buffer.length - i;
        for (let j = i; j < buffer.length; j++) {
            sum += buffer[j] * buffer[j];
        }
        const rms = Math.sqrt(sum / remaining);
        if (rms > maxRms) maxRms = rms;
    }
    return maxRms;
}

export interface AutoListenOptions {
    volumeActivationThresholdPercent?: number;
    silenceVolumeActivationThresholdPercent?: number;
    silenceThresholdMs?: number;
    voiceActivityProbabilityThreshold?: number;
    vadDevicePreference?: deviceType;
}

class SpeechToTextEngine {
    private pipeline: AutomaticSpeechRecognitionPipeline | null = null;
    private loading: Promise<void> | null = null;
    private loadError: string | null = null;
    private usingWebGpu = false;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    
    private currentDevicePreference: deviceType = 'auto';

    // Status subscription
    private status: SttStatus = 'idle';
    private statusListeners = new Set<(status: SttStatus) => void>();

    // Audio capture state
    private audioContext: AudioContext | null = null;
    private sourceSampleRate = 16000;
    private mediaStream: MediaStream | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private processorNode: ScriptProcessorNode | null = null;
    private muteGainNode: GainNode | null = null;
    private resumeGestureHandler: (() => void) | null = null;

    private preRollChunks: Float32Array[] = [];
    private preRollSampleCount = 0;
    private audioChunks: Float32Array[] = [];
    private vadRemainder = new Float32Array(0);
    private isStreamActive = false;
    private isTranscribingNow = false;
    private isPaused = false;
    private onPartialTranscription: ((text: string) => void) | null = null;

    // Dual-Threshold Hysteresis & VAD State
    private isAutoListening = false;
    private silenceTimer: ReturnType<typeof setTimeout> | null = null;
    private hasDetectedSpeech = false;
    private onAutoSend: ((text: string) => void) | null = null;
    private silenceThresholdMs = 1400;
    private activationRmsThreshold = sliderToRms(18);
    private silenceRmsThreshold = sliderToRms(8);
    private lastVadResetTime = 0;
    
    // Layer 2: ML VAD State
    private useVad = false;
    private vadProbabilityThreshold = 0.5;
    private isVadBusy = false;
    private isVadInitializing = false;

    private setStatus(status: SttStatus): void {
        if (this.status !== status) {
            this.status = status;
            for (const listener of this.statusListeners) {
                try {
                    listener(status);
                } catch {
                    // ignore subscriber errors
                }
            }
        }
    }

    onStatusChange(listener: (status: SttStatus) => void): () => void {
        this.statusListeners.add(listener);
        listener(this.status);
        return () => {
            this.statusListeners.delete(listener);
        };
    }

    getStatus(): SttStatus {
        return this.status;
    }

    private ensureVadInitialized(): void {
        if (!this.useVad || voiceActivityDetectionEngine.isReady() || this.isVadInitializing || voiceActivityDetectionEngine.getError()) {
            return;
        }
        this.isVadInitializing = true;
        voiceActivityDetectionEngine.initialize()
            .then((ok) => {
                if (!ok && voiceActivityDetectionEngine.getError()) {
                    this.useVad = false;
                }
            })
            .catch(() => {
                this.useVad = false;
            })
            .finally(() => {
                this.isVadInitializing = false;
            });
    }

    setPaused(paused: boolean): void {
        if (this.isPaused !== paused) {
            this.isPaused = paused;
            if (paused) {
                this.preRollChunks = [];
                this.preRollSampleCount = 0;
                this.vadRemainder = new Float32Array(0);
            } else {
                voiceActivityDetectionEngine.resetState?.();
                this.lastVadResetTime = Date.now();
                if (this.isStreamActive) {
                    if (this.audioContext?.state === 'suspended') {
                        this.audioContext.resume().catch(() => {});
                    }
                    if (!this.pipeline && !this.loading) {
                        this.load().catch(() => {});
                    }
                    this.ensureVadInitialized();
                }
            }
        }
    }

    updateAutoOptions(options: AutoListenOptions): void {
        const actPct = options.volumeActivationThresholdPercent ?? 18;
        const silPct = options.silenceVolumeActivationThresholdPercent ?? 8;
        this.activationRmsThreshold = sliderToRms(actPct);
        const targetSilRms = sliderToRms(silPct);
        this.silenceRmsThreshold = Math.min(targetSilRms, this.activationRmsThreshold * 0.75);
        this.silenceThresholdMs = options.silenceThresholdMs ?? 1400;
        this.vadProbabilityThreshold = options.voiceActivityProbabilityThreshold ?? 0.5;
        if (options.vadDevicePreference) {
            voiceActivityDetectionEngine.setDevicePreference(options.vadDevicePreference);
            if (this.isStreamActive && this.isAutoListening) {
                this.ensureVadInitialized();
            }
        }
    }

    setDevicePreference(preference: deviceType): void {
        if (this.currentDevicePreference !== preference) {
            this.currentDevicePreference = preference;
            
            if (this.pipeline || this.loading) {
                const isGpu = this.usingWebGpu;
                const wantsCpu = preference === 'cpu';
                const wantsGpu = preference === 'gpu';
                
                const needsReload = (wantsCpu && isGpu) || (wantsGpu && !isGpu);
                
                if (needsReload) {
                    this.pipeline = null;
                    this.loading = null;
                    this.usingWebGpu = false;
                    
                    this.load().catch(err => {
                        console.error('[STTEngine] Hot-swap reload failed:', err);
                    });
                }
            }
        }
    }

    private async load(): Promise<boolean> {
        if (this.pipeline) {
            if (!this.isStreamActive && !this.isAutoListening) {
                this.resetIdleTimer();
            }
            return true;
        }
        if (this.loading) {
            await this.loading;
            return this.pipeline !== null;
        }

        this.loading = (async () => {
            const { pipeline } = await import('@huggingface/transformers');
            const devicePreference = this.currentDevicePreference;
            const webGpuAvailable = devicePreference !== 'cpu' ? await isWebGpuAvailable() : false;

            if (webGpuAvailable && devicePreference !== 'cpu') {
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
                    if (devicePreference === 'gpu') {
                        this.loadError = 'WebGPU forced but failed. Falling back to CPU.';
                    }
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
            if (!this.isStreamActive && !this.isAutoListening && this.status === 'idle') {
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
        this.cancelRecording();

        if (this.loading) {
            try { await this.loading; } catch {}
        }

        this.pipeline = null;
        this.loading = null;
        this.loadError = null;
        this.usingWebGpu = false;
        
        await voiceActivityDetectionEngine.unload();
        this.setStatus('idle');
        console.log('[STTEngine] Unloaded.');
    }

    async unloadIfInactive(): Promise<void> {
        if (this.isStreamActive || this.isAutoListening || this.status !== 'idle') return;
        await this.unload();
    }

    async transcribeBuffer(buffer: Float32Array): Promise<string | null> {
        const loaded = await this.load();
        if (!loaded || !this.pipeline) return null;

        try {
            if (!this.isStreamActive && !this.isAutoListening) {
                this.resetIdleTimer();
            }
            const result = await this.pipeline(buffer, { chunk_length_s: 30, stride_length_s: 5 });
            const text = result.text?.trim() ?? '';
            return text || null;
        } catch (e) {
            console.warn('[STTEngine] Buffer transcription failed:', e);
            return null;
        }
    }

    async transcribeFile(file: File, language?: string): Promise<string | null> {
        const loaded = await this.load();
        if (!loaded || !this.pipeline) return null;

        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioContext = new AudioContext({ sampleRate: 16000 });
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            
            let float32Array = audioBuffer.getChannelData(0);
            if (audioBuffer.numberOfChannels > 1) {
                const ch1 = audioBuffer.getChannelData(1);
                const mixed = new Float32Array(float32Array.length);
                for (let i = 0; i < mixed.length; i++) {
                    mixed[i] = (float32Array[i] + ch1[i]) / 2;
                }
                float32Array = mixed;
            }
            
            const options: any = { chunk_length_s: 30, stride_length_s: 5 };
            if (language) options.language = language;
            
            const result = await this.pipeline(float32Array, options);
            await audioContext.close();
            
            const text = result.text?.trim() ?? '';
            return text || null;
        } catch (e) {
            console.error('[STTEngine] File transcription failed:', e);
            return null;
        }
    }

    async startAutoListening(
        onPartial: (text: string) => void,
        onAutoSend: (text: string) => void,
        options?: AutoListenOptions
    ): Promise<boolean> {
        if (this.status === 'loading' || this.status === 'transcribing') return false;

        this.setStatus('loading');
        await yieldToPaint();

        try {
            const loaded = await this.load();
            if (!loaded) {
                this.setStatus('idle');
                return false;
            }

            if (this.isStreamActive) {
                this.cleanupAudio();
            }

            this.updateAutoOptions(options ?? {});
            this.useVad = true;
            this.isVadBusy = false;

            this.isVadInitializing = true;
            const vadInit = voiceActivityDetectionEngine.initialize().then((ok) => {
                if (!ok && voiceActivityDetectionEngine.getError()) {
                    this.useVad = false;
                }
                return ok;
            }).catch(() => {
                this.useVad = false;
                return false;
            }).finally(() => {
                this.isVadInitializing = false;
            });
            await Promise.race([vadInit, new Promise<boolean>(res => setTimeout(() => res(false), 2500))]);

            this.isAutoListening = true;
            this.hasDetectedSpeech = false;
            this.onAutoSend = onAutoSend;

            const ok = await this.initAudioStream(onPartial, 'listening');
            if (!ok) {
                this.isAutoListening = false;
                this.setStatus('idle');
            }
            return ok;
        } catch (e) {
            console.error('[STTEngine] Failed to start auto listening:', e);
            this.isAutoListening = false;
            this.setStatus('idle');
            return false;
        }
    }

    async startRecording(
        onPartialTranscription: (text: string) => void
    ): Promise<boolean> {
        if (this.status === 'loading' || this.status === 'transcribing') return false;
        if (this.isStreamActive && !this.isAutoListening) return true;

        this.setStatus('loading');
        await yieldToPaint();

        try {
            const loaded = await this.load();
            if (!loaded) {
                this.setStatus('idle');
                return false;
            }

            if (this.isStreamActive) {
                this.cleanupAudio();
            }

            this.isAutoListening = false;
            this.hasDetectedSpeech = true;
            this.useVad = false;
            this.onAutoSend = null;

            const ok = await this.initAudioStream(onPartialTranscription, 'recording');
            if (!ok) this.setStatus('idle');
            return ok;
        } catch (e) {
            console.error('[STTEngine] Failed to start recording:', e);
            this.setStatus('idle');
            return false;
        }
    }

    private pushPreRoll(chunk: Float32Array): void {
        const targetSamples = Math.round(this.sourceSampleRate * PRE_ROLL_DURATION_SECONDS);
        this.preRollChunks.push(chunk);
        this.preRollSampleCount += chunk.length;
        while (this.preRollChunks.length > 1 && this.preRollSampleCount - this.preRollChunks[0].length >= targetSamples) {
            const removed = this.preRollChunks.shift()!;
            this.preRollSampleCount -= removed.length;
        }
    }

    private appendVadSamples(chunk: Float32Array): void {
        const combined = new Float32Array(this.vadRemainder.length + chunk.length);
        combined.set(this.vadRemainder, 0);
        combined.set(chunk, this.vadRemainder.length);
        if (combined.length > MAX_VAD_QUEUE_SAMPLES) {
            this.vadRemainder = combined.slice(combined.length - MAX_VAD_QUEUE_SAMPLES);
        } else {
            this.vadRemainder = combined;
        }
    }

    private beginSpeechCapture(peakRms: number, vadProb: number): void {
        if (this.hasDetectedSpeech) return;
        this.hasDetectedSpeech = true;
        this.audioChunks = [...this.preRollChunks];
        this.preRollChunks = [];
        this.preRollSampleCount = 0;
        this.clearSilenceCountdown();
        this.setStatus('recording');
        console.log(`[STTEngine] Voice activated (peakRms=${peakRms.toFixed(5)}, threshold=${this.activationRmsThreshold.toFixed(5)}, vadProb=${vadProb.toFixed(2)})`);
    }

    private scheduleSilenceCountdown(): void {
        if (this.hasDetectedSpeech && !this.silenceTimer) {
            this.silenceTimer = setTimeout(() => {
                this.triggerAutoSend();
            }, this.silenceThresholdMs);
        }
    }

    private clearSilenceCountdown(): void {
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
    }

    private handleDetectionResult(peakRms: number, vadProb: number): void {
        if (!this.isStreamActive || !this.isAutoListening || this.isTranscribingNow) return;

        const vadValid = vadProb >= 0;

        // ─── STATE 1: WAITING FOR SPEECH TO START ───
        if (!this.hasDetectedSpeech) {
            if (this.isPaused) return;

            if (vadValid) {
                // Must be verified speech AND above the activation volume threshold.
                // Background noise at the lower silence floor CANNOT trigger false captures.
                if (peakRms >= this.activationRmsThreshold && vadProb >= this.vadProbabilityThreshold) {
                    this.beginSpeechCapture(peakRms, vadProb);
                }
            } else if (peakRms >= this.activationRmsThreshold) {
                this.beginSpeechCapture(peakRms, -1);
            }
            return;
        }

        // ─── STATE 2: ALREADY CAPTURING SPEECH (DUAL-THRESHOLD SUSTAIN) ───
        if (vadValid) {
            // Keep speech active if either VAD confirms speech OR volume is above silence threshold
            if (vadProb >= this.vadProbabilityThreshold || peakRms >= this.silenceRmsThreshold) {
                this.clearSilenceCountdown();
            } else {
                this.scheduleSilenceCountdown();
            }
        } else {
            if (peakRms >= this.silenceRmsThreshold) {
                this.clearSilenceCountdown();
            } else {
                this.scheduleSilenceCountdown();
            }
        }
    }

    private async processVadQueue(): Promise<void> {
        this.isVadBusy = true;
        try {
            while (this.vadRemainder.length >= 512 && this.isStreamActive && this.isAutoListening && !this.isTranscribingNow) {
                const frame = this.vadRemainder.slice(0, 512);
                this.vadRemainder = this.vadRemainder.slice(512);

                let sum = 0;
                for (let i = 0; i < 512; i++) {
                    sum += frame[i] * frame[i];
                }
                const frameRms = Math.sqrt(sum / 512);

                const prob = await voiceActivityDetectionEngine.processChunk(frame);

                // Periodic VAD state reset: if this frame is confirmed non-speech, flush the RNN
                // context after silenceThresholdMs so background noise can NEVER bloat the model
                if (!this.hasDetectedSpeech) {
                    if (prob < this.vadProbabilityThreshold) {
                        if (Date.now() - this.lastVadResetTime >= this.silenceThresholdMs) {
                            voiceActivityDetectionEngine.resetState?.();
                            this.lastVadResetTime = Date.now();
                        }
                    } else {
                        this.lastVadResetTime = Date.now();
                    }
                }

                this.handleDetectionResult(frameRms, prob);

                if (this.hasDetectedSpeech) {
                    break;
                }
            }
        } catch {
            this.handleDetectionResult(0, -1);
        } finally {
            this.isVadBusy = false;
            if (!this.hasDetectedSpeech && this.vadRemainder.length >= 512 && this.isStreamActive && this.isAutoListening && !this.isTranscribingNow) {
                void this.processVadQueue();
            }
        }
    }

    private handleIncomingAudio(nativeChunk: Float32Array): void {
        if (!this.isStreamActive || this.isTranscribingNow) return;

        if (!this.isAutoListening) {
            this.audioChunks.push(nativeChunk);
            return;
        }

        if (this.isPaused && !this.hasDetectedSpeech) {
            this.preRollChunks = [];
            this.preRollSampleCount = 0;
            this.vadRemainder = new Float32Array(0);
            return;
        }

        if (!this.hasDetectedSpeech) {
            this.pushPreRoll(nativeChunk);
        } else {
            this.audioChunks.push(nativeChunk);
        }

        const vadInput = this.sourceSampleRate !== 16000
            ? resampleLinear(nativeChunk, this.sourceSampleRate, 16000)
            : nativeChunk;

        if (this.useVad && !voiceActivityDetectionEngine.isReady()) {
            this.ensureVadInitialized();
        }

        const vadReady = this.useVad && voiceActivityDetectionEngine.isReady();

        if (vadReady) {
            this.appendVadSamples(vadInput);
            if (!this.isVadBusy && this.vadRemainder.length >= 512) {
                void this.processVadQueue();
            }
        } else {
            const peakRms = getMaxWindowRms(vadInput, 512);
            this.handleDetectionResult(peakRms, -1);
        }
    }

    private async initAudioStream(
        onPartial: (text: string) => void,
        initialStatus: 'listening' | 'recording'
    ): Promise<boolean> {
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: true,
                },
            });

            try {
                this.audioContext = new AudioContext({ sampleRate: 16000 });
            } catch {
                this.audioContext = new AudioContext();
            }

            if (this.audioContext.state === 'suspended') {
                try {
                    await this.audioContext.resume();
                } catch {
                    // Gesture handler fallback
                }
                if (this.audioContext.state === 'suspended') {
                    this.resumeGestureHandler = () => {
                        if (this.audioContext && this.audioContext.state === 'suspended') {
                            this.audioContext.resume().catch(() => {});
                        }
                        if (this.resumeGestureHandler) {
                            window.removeEventListener('pointerdown', this.resumeGestureHandler);
                            window.removeEventListener('keydown', this.resumeGestureHandler);
                            this.resumeGestureHandler = null;
                        }
                    };
                    window.addEventListener('pointerdown', this.resumeGestureHandler, { once: true });
                    window.addEventListener('keydown', this.resumeGestureHandler, { once: true });
                }
            }

            this.sourceSampleRate = this.audioContext.sampleRate;
            this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.muteGainNode = this.audioContext.createGain();
            this.muteGainNode.gain.value = 0;

            let usingWorklet = false;
            if (typeof AudioWorkletNode !== 'undefined' && this.audioContext.audioWorklet) {
                let blobUrl: string | null = null;
                try {
                    const blob = new Blob([WORKLET_PROCESSOR_CODE], { type: 'application/javascript' });
                    blobUrl = URL.createObjectURL(blob);
                    await this.audioContext.audioWorklet.addModule(blobUrl);
                    this.workletNode = new AudioWorkletNode(this.audioContext, WORKLET_PROCESSOR_NAME);
                    this.workletNode.port.onmessage = (event) => {
                        const chunk = event.data as Float32Array;
                        if (chunk && chunk.length > 0) {
                            this.handleIncomingAudio(chunk);
                        }
                    };
                    this.sourceNode.connect(this.workletNode);
                    this.workletNode.connect(this.muteGainNode);
                    this.muteGainNode.connect(this.audioContext.destination);
                    usingWorklet = true;
                } catch (workletErr) {
                    console.warn('[STTEngine] AudioWorklet unavailable, falling back to ScriptProcessor:', workletErr);
                    if (this.workletNode) {
                        this.workletNode.port.onmessage = null;
                        this.workletNode.disconnect();
                        this.workletNode = null;
                    }
                } finally {
                    if (blobUrl) URL.revokeObjectURL(blobUrl);
                }
            }

            if (!usingWorklet) {
                this.processorNode = this.audioContext.createScriptProcessor(2048, 1, 1);
                this.processorNode.onaudioprocess = (event) => {
                    const rawInput = event.inputBuffer.getChannelData(0);
                    this.handleIncomingAudio(new Float32Array(rawInput));
                };
                this.sourceNode.connect(this.processorNode);
                this.processorNode.connect(this.muteGainNode);
                this.muteGainNode.connect(this.audioContext.destination);
            }

            this.isStreamActive = true;
            this.isTranscribingNow = false;
            this.onPartialTranscription = onPartial;
            this.audioChunks = [];
            this.preRollChunks = [];
            this.preRollSampleCount = 0;
            this.vadRemainder = new Float32Array(0);
            this.lastVadResetTime = Date.now();
            this.clearIdleTimer();
            this.setStatus(initialStatus);

            console.log(`[STTEngine] Audio capture active (Thread=${usingWorklet ? 'AudioWorklet' : 'ScriptProcessor'}, ContextState=${this.audioContext.state}, Rate=${this.sourceSampleRate}Hz, AutoVAD=${this.isAutoListening}, VadReady=${voiceActivityDetectionEngine.isReady()}).`);
            return true;
        } catch (e) {
            console.error('[STTEngine] Failed to start audio capture:', e);
            this.cleanupAudio();
            this.setStatus('idle');
            return false;
        }
    }

    private async triggerAutoSend(): Promise<void> {
        if (!this.isAutoListening || !this.hasDetectedSpeech || this.isTranscribingNow) return;

        this.clearSilenceCountdown();
        this.hasDetectedSpeech = false;
        this.isTranscribingNow = true;

        const captureRate = this.sourceSampleRate;
        const chunksToProcess = this.audioChunks;
        this.audioChunks = [];
        this.preRollChunks = [];
        this.preRollSampleCount = 0;
        this.vadRemainder = new Float32Array(0);
        voiceActivityDetectionEngine.resetState?.();
        this.lastVadResetTime = Date.now();

        const totalSamples = chunksToProcess.reduce((sum, chunk) => sum + chunk.length, 0);
        if (chunksToProcess.length === 0 || totalSamples < captureRate * 0.1) {
            this.isTranscribingNow = false;
            if (this.isAutoListening && this.isStreamActive) {
                this.setStatus('listening');
            }
            return;
        }

        try {
            const text = await this.transcribeChunks(chunksToProcess, totalSamples, captureRate, null);
            if (text && text.length > 0 && this.onAutoSend) {
                console.log('[STTEngine] Turn completed. Auto-sending:', text);
                this.onAutoSend(text);
            }
        } finally {
            this.isTranscribingNow = false;
            if (this.isAutoListening && this.isStreamActive) {
                this.setStatus('listening');
            } else {
                this.setStatus('idle');
            }
        }
    }

    async stopRecording(): Promise<string | null> {
        if (!this.isStreamActive) return null;

        this.isStreamActive = false;
        this.isAutoListening = false;
        this.hasDetectedSpeech = false;
        this.useVad = false;
        this.isVadBusy = false;
        this.clearSilenceCountdown();
        
        voiceActivityDetectionEngine.resetState?.();
        this.lastVadResetTime = Date.now();

        const captureRate = this.sourceSampleRate;
        const chunksToProcess = this.audioChunks;
        const partialCallback = this.onPartialTranscription;

        this.onPartialTranscription = null;
        this.onAutoSend = null;
        this.cleanupAudio();

        const totalSamples = chunksToProcess.reduce((sum, chunk) => sum + chunk.length, 0);
        if (chunksToProcess.length === 0 || totalSamples < captureRate * 0.1) {
            this.setStatus('idle');
            this.resetIdleTimer();
            return null;
        }

        this.isTranscribingNow = true;

        try {
            const finalText = await this.transcribeChunks(chunksToProcess, totalSamples, captureRate, partialCallback);
            console.log('[STTEngine] Recording stopped.');
            return finalText;
        } finally {
            this.isTranscribingNow = false;
            this.setStatus('idle');
            this.resetIdleTimer();
        }
    }

    cancelRecording(): void {
        this.isStreamActive = false;
        this.isAutoListening = false;
        this.hasDetectedSpeech = false;
        this.isTranscribingNow = false;
        this.useVad = false;
        this.isVadBusy = false;
        this.clearSilenceCountdown();

        voiceActivityDetectionEngine.resetState?.();
        this.lastVadResetTime = Date.now();

        this.cleanupAudio();
        this.onPartialTranscription = null;
        this.onAutoSend = null;
        this.setStatus('idle');
        this.resetIdleTimer();
    }

    private async transcribeChunks(
        chunks: Float32Array[],
        totalNativeSamples: number,
        captureSampleRate: number,
        onText: ((text: string) => void) | null
    ): Promise<string | null> {
        if (!this.pipeline || this.loading) {
            this.setStatus('loading');
            await yieldToPaint();
            if (!this.pipeline && !this.loading) {
                await this.load();
            } else if (this.loading) {
                await this.loading;
            }
            if (this.isStreamActive) {
                this.clearIdleTimer();
            }
        }
        if (!this.pipeline) return null;

        this.setStatus('transcribing');
        await yieldToPaint();

        try {
            const combinedNative = new Float32Array(totalNativeSamples);
            let offset = 0;
            for (const chunk of chunks) {
                combinedNative.set(chunk, offset);
                offset += chunk.length;
            }

            const combined16k = captureSampleRate !== 16000
                ? await resampleOfflineTo16k(combinedNative, captureSampleRate)
                : combinedNative;

            const result = await this.pipeline(combined16k, {
                chunk_length_s: 30,
                stride_length_s: 5,
            });
            const text = result.text?.trim() ?? '';

            if (text.length > 0 && onText) {
                onText(text);
            }

            return text || null;
        } catch (e) {
            console.warn('[STTEngine] Transcription failed:', e);
            return null;
        }
    }

    private cleanupAudio(): void {
        if (this.resumeGestureHandler) {
            window.removeEventListener('pointerdown', this.resumeGestureHandler);
            window.removeEventListener('keydown', this.resumeGestureHandler);
            this.resumeGestureHandler = null;
        }
        if (this.workletNode) {
            this.workletNode.port.onmessage = null;
            this.workletNode.disconnect();
            this.workletNode = null;
        }
        if (this.processorNode) {
            this.processorNode.onaudioprocess = null;
            this.processorNode.disconnect();
            this.processorNode = null;
        }
        if (this.muteGainNode) {
            this.muteGainNode.disconnect();
            this.muteGainNode = null;
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
        this.preRollChunks = [];
        this.preRollSampleCount = 0;
        this.vadRemainder = new Float32Array(0);
    }

    isReady(): boolean {
        return this.pipeline !== null;
    }

    getIsRecording(): boolean {
        return this.status === 'recording';
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