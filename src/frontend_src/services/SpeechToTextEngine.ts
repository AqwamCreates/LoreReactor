// src/frontend_src/services/SpeechToTextEngine.ts
import type { deviceType } from '../types';
import { voiceActivityDetectionEngine } from './VoiceActivityDetectionEngine';

const HF_MODEL_ID = 'Xenova/whisper-tiny'; 
const IDLE_UNLOAD_MS = 3 * 60 * 1000; // 3 minutes
const PRE_ROLL_CHUNK_COUNT = 2; // ~512ms pre-roll at 16kHz / 4096 samples per buffer

export type SttStatus = 'idle' | 'loading' | 'listening' | 'recording' | 'transcribing';

type AutomaticSpeechRecognitionPipeline = (audio: Float32Array | Float32Array[], options?: any) => Promise<{ text: string }>;

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
 * Yields back to the browser so React can commit DOM updates and paint
 * loading/transcribing icons before synchronous WASM/ONNX inference locks the thread.
 */
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

function resampleBuffer(buffer: Float32Array, fromSampleRate: number, toSampleRate = 16000): Float32Array {
    if (fromSampleRate === toSampleRate) return buffer;
    const ratio = fromSampleRate / toSampleRate;
    const newLength = Math.round(buffer.length / ratio);
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

/**
 * Extracts the loudest 512-sample window in the buffer so Silero VAD inspects
 * actual speech energy rather than leading silence.
 */
function getLoudest512Slice(buffer: Float32Array): Float32Array {
    if (buffer.length <= 512) return buffer;
    let bestOffset = 0;
    let bestEnergy = -1;
    for (let i = 0; i + 512 <= buffer.length; i += 512) {
        let energy = 0;
        for (let j = i; j < i + 512; j++) {
            energy += buffer[j] * buffer[j];
        }
        if (energy > bestEnergy) {
            bestEnergy = energy;
            bestOffset = i;
        }
    }
    return buffer.slice(bestOffset, bestOffset + 512);
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
    private mediaStream: MediaStream | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private processorNode: ScriptProcessorNode | null = null;
    private muteGainNode: GainNode | null = null;
    private resumeGestureHandler: (() => void) | null = null;

    private preRollChunks: Float32Array[] = [];
    private audioChunks: Float32Array[] = [];
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
    private activationRmsThreshold = sliderToRms(12);
    private silenceRmsThreshold = sliderToRms(6);
    
    // Layer 2: ML VAD State
    private useVad = false;
    private vadProbabilityThreshold = 0.4;
    private isVadBusy = false;

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

    setPaused(paused: boolean): void {
        if (this.isPaused !== paused) {
            this.isPaused = paused;
            if (paused) {
                this.preRollChunks = [];
            } else {
                voiceActivityDetectionEngine.resetState?.();
            }
        }
    }

    updateAutoOptions(options: AutoListenOptions): void {
        const actPct = options.volumeActivationThresholdPercent ?? 12;
        const silPct = options.silenceVolumeActivationThresholdPercent ?? 6;
        this.activationRmsThreshold = sliderToRms(actPct);
        const targetSilRms = sliderToRms(silPct);
        this.silenceRmsThreshold = Math.min(targetSilRms, this.activationRmsThreshold * 0.75);
        this.silenceThresholdMs = options.silenceThresholdMs ?? 1400;
        this.vadProbabilityThreshold = options.voiceActivityProbabilityThreshold ?? 0.4;
        if (options.vadDevicePreference) {
            voiceActivityDetectionEngine.setDevicePreference(options.vadDevicePreference);
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
            this.resetIdleTimer();
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
            this.resetIdleTimer();
            const result = await this.pipeline(buffer);
            return result.text || null;
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
            
            const options: any = {};
            if (language) options.language = language;
            
            const result = await this.pipeline(float32Array, options);
            await audioContext.close();
            
            return result.text || null;
        } catch (e) {
            console.error('[STTEngine] File transcription failed:', e);
            return null;
        }
    }

    /**
     * Enters continuous hands-free 'listening' mode.
     * Waits silently until voice activation triggers 'recording', then transcribes,
     * calls onAutoSend, and returns to 'listening'.
     */
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
            
            try {
                const vadInit = voiceActivityDetectionEngine.initialize();
                const timeout = new Promise<boolean>(res => setTimeout(() => res(false), 2500));
                this.useVad = (await Promise.race([vadInit, timeout])) === true;
            } catch {
                this.useVad = false;
            }

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

    private beginSpeechCapture(initialChunk: Float32Array): void {
        if (this.hasDetectedSpeech) return;
        this.hasDetectedSpeech = true;
        this.audioChunks = [...this.preRollChunks, initialChunk];
        this.preRollChunks = [];
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
        this.setStatus('recording');
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

    private async initAudioStream(
        onPartial: (text: string) => void,
        initialStatus: 'listening' | 'recording'
    ): Promise<boolean> {
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
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
                    // May require a direct user interaction if auto-started on page load
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

            this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);

            this.muteGainNode = this.audioContext.createGain();
            this.muteGainNode.gain.value = 0;

            const sourceRate = this.audioContext.sampleRate;

            this.processorNode.onaudioprocess = (event) => {
                if (!this.isStreamActive || this.isTranscribingNow) return;
                const rawInput = event.inputBuffer.getChannelData(0);

                const inputData = sourceRate !== 16000 
                    ? resampleBuffer(rawInput, sourceRate, 16000)
                    : new Float32Array(rawInput);

                // Manual recording mode: capture everything directly
                if (!this.isAutoListening) {
                    this.audioChunks.push(inputData);
                    return;
                }

                // Auto-listening paused (e.g., AI is generating or speaking TTS)
                if (this.isPaused && !this.hasDetectedSpeech) {
                    this.preRollChunks = [];
                    return;
                }

                // Compute RMS energy
                let sumSquares = 0;
                for (let i = 0; i < inputData.length; i++) {
                    sumSquares += inputData[i] * inputData[i];
                }
                const rms = Math.sqrt(sumSquares / inputData.length);

                // Maintain rolling pre-roll buffer while waiting in standby
                if (!this.hasDetectedSpeech) {
                    this.preRollChunks.push(inputData);
                    if (this.preRollChunks.length > PRE_ROLL_CHUNK_COUNT) {
                        this.preRollChunks.shift();
                    }

                    // Gate 1: Below activation threshold -> stay in standby
                    if (rms < this.activationRmsThreshold) {
                        return;
                    }

                    // Gate 2: Energy crossed activation threshold -> verify with Silero VAD (or accept immediately if loud / no VAD)
                    if (this.useVad && voiceActivityDetectionEngine.isReady()) {
                        if (!this.isVadBusy) {
                            this.isVadBusy = true;
                            const slice512 = getLoudest512Slice(inputData);
                            voiceActivityDetectionEngine.processChunk(slice512).then((prob) => {
                                if (!this.isStreamActive || !this.isAutoListening || this.isPaused) return;
                                if (prob >= this.vadProbabilityThreshold || prob < 0 || rms >= this.activationRmsThreshold * 2.5) {
                                    this.beginSpeechCapture(inputData);
                                }
                            }).catch(() => {
                                if (this.isStreamActive && this.isAutoListening && !this.isPaused) {
                                    this.beginSpeechCapture(inputData);
                                }
                            }).finally(() => {
                                this.isVadBusy = false;
                            });
                        }
                    } else {
                        this.beginSpeechCapture(inputData);
                    }
                    return;
                }

                // Actively recording speech after voice activation triggered
                this.audioChunks.push(inputData);

                if (rms < this.silenceRmsThreshold) {
                    this.scheduleSilenceCountdown();
                    return;
                }

                if (rms >= this.activationRmsThreshold) {
                    if (this.useVad && voiceActivityDetectionEngine.isReady()) {
                        if (!this.isVadBusy) {
                            this.isVadBusy = true;
                            const slice512 = getLoudest512Slice(inputData);
                            voiceActivityDetectionEngine.processChunk(slice512).then((prob) => {
                                if (!this.isStreamActive || !this.hasDetectedSpeech) return;
                                if (prob >= this.vadProbabilityThreshold || prob < 0 || rms >= this.activationRmsThreshold * 2) {
                                    this.clearSilenceCountdown();
                                } else {
                                    // Loud non-speech noise (keyboard/door slam) -> allow silence timer
                                    this.scheduleSilenceCountdown();
                                }
                            }).catch(() => {
                                this.clearSilenceCountdown();
                            }).finally(() => {
                                this.isVadBusy = false;
                            });
                        }
                    } else {
                        this.clearSilenceCountdown();
                    }
                } else {
                    // Between silence threshold and activation threshold:
                    // If VAD is active, check whether soft voice continues or user stopped speaking.
                    if (this.useVad && voiceActivityDetectionEngine.isReady()) {
                        if (!this.isVadBusy) {
                            this.isVadBusy = true;
                            const slice512 = getLoudest512Slice(inputData);
                            voiceActivityDetectionEngine.processChunk(slice512).then((prob) => {
                                if (!this.isStreamActive || !this.hasDetectedSpeech) return;
                                if (prob >= this.vadProbabilityThreshold) {
                                    this.clearSilenceCountdown();
                                } else {
                                    this.scheduleSilenceCountdown();
                                }
                            }).catch(() => {
                                this.scheduleSilenceCountdown();
                            }).finally(() => {
                                this.isVadBusy = false;
                            });
                        }
                    } else {
                        this.scheduleSilenceCountdown();
                    }
                }
            };

            this.sourceNode.connect(this.processorNode);
            this.processorNode.connect(this.muteGainNode);
            this.muteGainNode.connect(this.audioContext.destination);

            this.isStreamActive = true;
            this.isTranscribingNow = false;
            this.onPartialTranscription = onPartial;
            this.audioChunks = [];
            this.preRollChunks = [];
            this.clearIdleTimer();
            this.setStatus(initialStatus);

            console.log(`[STTEngine] Audio capture active (ContextState=${this.audioContext.state}, Rate=${sourceRate}Hz, AutoVAD=${this.isAutoListening}).`);
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

        const chunksToProcess = this.audioChunks;
        this.audioChunks = [];
        this.preRollChunks = [];
        voiceActivityDetectionEngine.resetState?.();

        const totalLength = chunksToProcess.reduce((sum, chunk) => sum + chunk.length, 0);
        if (chunksToProcess.length === 0 || totalLength < 1600) {
            this.isTranscribingNow = false;
            if (this.isAutoListening && this.isStreamActive) {
                this.setStatus('listening');
            }
            return;
        }

        this.setStatus('transcribing');
        await yieldToPaint();

        try {
            const text = await this.transcribeChunks(chunksToProcess, totalLength, null);
            if (text && text.trim().length > 0 && this.onAutoSend) {
                console.log('[STTEngine] Turn completed. Auto-sending:', text);
                this.onAutoSend(text.trim());
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

        const chunksToProcess = this.audioChunks;
        const partialCallback = this.onPartialTranscription;

        this.onPartialTranscription = null;
        this.onAutoSend = null;
        this.cleanupAudio();

        const totalLength = chunksToProcess.reduce((sum, chunk) => sum + chunk.length, 0);
        if (chunksToProcess.length === 0 || totalLength < 1600) {
            this.setStatus('idle');
            this.resetIdleTimer();
            return null;
        }

        this.isTranscribingNow = true;
        this.setStatus('transcribing');
        await yieldToPaint();

        try {
            const finalText = await this.transcribeChunks(chunksToProcess, totalLength, partialCallback);
            console.log('[STTEngine] Recording stopped.');
            return finalText;
        } finally {
            this.isTranscribingNow = false;
            this.setStatus('idle');
            this.resetIdleTimer();
        }
    }

    /**
     * Immediately stops listening/recording and discards buffered audio without transcribing.
     */
    cancelRecording(): void {
        this.isStreamActive = false;
        this.isAutoListening = false;
        this.hasDetectedSpeech = false;
        this.isTranscribingNow = false;
        this.useVad = false;
        this.isVadBusy = false;
        this.clearSilenceCountdown();

        voiceActivityDetectionEngine.resetState?.();

        this.cleanupAudio();
        this.onPartialTranscription = null;
        this.onAutoSend = null;
        this.setStatus('idle');
        this.resetIdleTimer();
    }

    private async transcribeChunks(
        chunks: Float32Array[],
        totalLength: number,
        onText: ((text: string) => void) | null
    ): Promise<string | null> {
        if (this.loading) await this.loading;
        if (!this.pipeline) return null;

        try {
            const combined = new Float32Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                combined.set(chunk, offset);
                offset += chunk.length;
            }

            const result = await this.pipeline(combined);
            const text = result.text;

            if (text && text.length > 0 && onText) {
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
        if (this.processorNode) {
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