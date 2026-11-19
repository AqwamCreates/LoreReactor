// src/frontend_src/services/SpeechToTextEngine.ts
import type { deviceType } from '../types';
import { voiceActivityDetectionEngine } from './VoiceActivityDetectionEngine';

const HF_MODEL_ID = 'Xenova/whisper-tiny'; 
const IDLE_UNLOAD_MS = 3 * 60 * 1000; // 3 minutes

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

class SpeechToTextEngine {
    private pipeline: AutomaticSpeechRecognitionPipeline | null = null;
    private loading: Promise<void> | null = null;
    private loadError: string | null = null;
    private usingWebGpu = false;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    
    private currentDevicePreference: deviceType = 'auto';

    // Audio capture state
    private audioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private processorNode: ScriptProcessorNode | null = null;
    private muteGainNode: GainNode | null = null;
    private audioChunks: Float32Array[] = [];
    private isRecording = false;
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
    private isVadBusy = false; // Lock to prevent event-loop starvation

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
            try { await this.loading; } catch {}
        }

        this.pipeline = null;
        this.loading = null;
        this.loadError = null;
        this.usingWebGpu = false;
        
        await voiceActivityDetectionEngine.unload();
        console.log('[STTEngine] Unloaded.');
    }

    async unloadIfInactive(): Promise<void> {
        if (this.isRecording || this.isAutoListening) return;
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

    async startAutoListening(
        onPartial: (text: string) => void,
        onAutoSend: (text: string) => void,
        options?: { 
            volumeActivationThresholdPercent?: number; 
            silenceVolumeActivationThresholdPercent?: number;
            silenceThresholdMs?: number;
            voiceActivityProbabilityThreshold?: number;
            vadDevicePreference?: deviceType;
        }
    ): Promise<boolean> {
        const loaded = await this.load();
        if (!loaded) return false;

        if (this.isRecording) {
            this.stopRecordingSync();
        }

        const actPct = options?.volumeActivationThresholdPercent ?? 12;
        const silPct = options?.silenceVolumeActivationThresholdPercent ?? 6;

        this.activationRmsThreshold = sliderToRms(actPct);
        const targetSilRms = sliderToRms(silPct);
        this.silenceRmsThreshold = Math.min(targetSilRms, this.activationRmsThreshold * 0.75);
        this.silenceThresholdMs = options?.silenceThresholdMs ?? 1400;
        
        this.vadProbabilityThreshold = options?.voiceActivityProbabilityThreshold ?? 0.4;
        this.useVad = true;
        this.isVadBusy = false;
        
        if (options?.vadDevicePreference) {
            voiceActivityDetectionEngine.setDevicePreference(options.vadDevicePreference);
        }
        
        // Timeout safeguard: If VAD fails to initialize, gracefully fall back to pure RMS
        try {
            const vadInit = voiceActivityDetectionEngine.initialize();
            const timeout = new Promise<boolean>(res => setTimeout(() => res(false), 2000));
            this.useVad = (await Promise.race([vadInit, timeout])) === true;
        } catch {
            this.useVad = false;
        }

        this.isAutoListening = true;
        this.hasDetectedSpeech = false;
        this.onAutoSend = onAutoSend;

        return this.initAudioStream(onPartial);
    }

    async startRecording(
        onPartialTranscription: (text: string) => void
    ): Promise<boolean> {
        const loaded = await this.load();
        if (!loaded) return false;

        if (this.isRecording) return true;

        this.isAutoListening = false;
        this.useVad = false;
        this.onAutoSend = null;
        return this.initAudioStream(onPartialTranscription);
    }

    private async initAudioStream(onPartial: (text: string) => void): Promise<boolean> {
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
                await this.audioContext.resume();
            }

            this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);

            // MUTE NODE: Prevents microphone from looping back into laptop speakers
            this.muteGainNode = this.audioContext.createGain();
            this.muteGainNode.gain.value = 0;

            const sourceRate = this.audioContext.sampleRate;

            this.processorNode.onaudioprocess = (event) => {
                if (!this.isRecording) return;
                const rawInput = event.inputBuffer.getChannelData(0);

                const inputData = sourceRate !== 16000 
                    ? resampleBuffer(rawInput, sourceRate, 16000)
                    : new Float32Array(rawInput);

                this.audioChunks.push(inputData);

                if (this.isAutoListening) {
                    // Instant RMS calculation (0% CPU, completely non-blocking)
                    let sumSquares = 0;
                    for (let i = 0; i < inputData.length; i++) {
                        sumSquares += inputData[i] * inputData[i];
                    }
                    const rms = Math.sqrt(sumSquares / inputData.length);

                    if (rms < this.silenceRmsThreshold) {
                        if (this.hasDetectedSpeech && !this.silenceTimer) {
                            this.silenceTimer = setTimeout(() => {
                                this.triggerAutoSend();
                            }, this.silenceThresholdMs);
                        }
                        return;
                    }

                    if (rms >= this.activationRmsThreshold) {
                        // Confirmed speech immediately via energy gate
                        this.hasDetectedSpeech = true;
                        if (this.silenceTimer) {
                            clearTimeout(this.silenceTimer);
                            this.silenceTimer = null;
                        }

                        // Asynchronous non-blocking VAD verification
                        if (this.useVad && !this.isVadBusy && voiceActivityDetectionEngine.isReady()) {
                            this.isVadBusy = true;
                            // Check only the first 512-sample chunk to prevent loop stalls
                            const chunk = inputData.slice(0, 512);
                            voiceActivityDetectionEngine.processChunk(chunk).then((prob) => {
                                if (prob >= 0 && prob < this.vadProbabilityThreshold && rms < this.activationRmsThreshold * 2) {
                                    // Non-speech background noise: start silence countdown
                                    if (this.hasDetectedSpeech && !this.silenceTimer) {
                                        this.silenceTimer = setTimeout(() => {
                                            this.triggerAutoSend();
                                        }, this.silenceThresholdMs);
                                    }
                                }
                            }).catch(() => {}).finally(() => {
                                this.isVadBusy = false;
                            });
                        }
                    } else {
                        // Deadband: keep turn active if already speaking
                        if (this.hasDetectedSpeech && this.silenceTimer) {
                            clearTimeout(this.silenceTimer);
                            this.silenceTimer = null;
                        }
                    }
                }
            };

            // Connect nodes through the mute gain node to prevent speaker feedback
            this.sourceNode.connect(this.processorNode);
            this.processorNode.connect(this.muteGainNode);
            this.muteGainNode.connect(this.audioContext.destination);

            this.isRecording = true;
            this.onPartialTranscription = onPartial;
            this.audioChunks = [];
            this.clearIdleTimer();

            console.log(`[STTEngine] Audio capture active (ContextState=${this.audioContext.state}, Rate=${sourceRate}Hz, AutoVAD=${this.isAutoListening}).`);
            return true;
        } catch (e) {
            console.error('[STTEngine] Failed to start audio capture:', e);
            this.cleanupAudio();
            return false;
        }
    }

    private async triggerAutoSend(): Promise<void> {
        if (!this.isAutoListening) return;

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
        this.useVad = false;
        this.isVadBusy = false;

        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
        
        voiceActivityDetectionEngine.resetState?.();

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
        this.useVad = false;
        this.isVadBusy = false;

        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }

        voiceActivityDetectionEngine.resetState?.();

        this.cleanupAudio();
        this.onPartialTranscription = null;
        this.audioChunks = [];
    }

    private async transcribeAccumulated(): Promise<string | null> {
        if (this.audioChunks.length === 0) return null;

        if (this.loading) await this.loading;
        if (!this.pipeline) return null;

        try {
            const totalLength = this.audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
            if (totalLength < 1600) return null; // Ignore clicks under 100ms

            const combined = new Float32Array(totalLength);
            let offset = 0;
            for (const chunk of this.audioChunks) {
                combined.set(chunk, offset);
                offset += chunk.length;
            }

            this.audioChunks = [];

            const result = await this.pipeline(combined);
            const text = result.text;

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