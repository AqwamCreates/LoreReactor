// frontend_src/services/VoiceCloningEngine.ts
import * as ort from 'onnxruntime-web';
import type { deviceType } from '../types';
import { uploadCharacterVoice } from '../storages/serverStorage';

// Speaker verification model for extracting voice embeddings (e.g., WavLM)
const SPEAKER_ENCODER_MODEL_URL = 'https://huggingface.co/onnx-community/wavlm-base-plus-sv/resolve/main/onnx/model_quantized.onnx';

interface QueueTask {
    characterId: string;
    file: File;
    resolve: (success: boolean) => void;
    reject: (error: any) => void;
}

class VoiceCloningEngine {
    private session: ort.InferenceSession | null = null;
    private loading: Promise<void> | null = null;
    private loadError: string | null = null;
    private usingWebGpu = false;
    private currentDevicePreference: deviceType = 'auto';
    
    private queue: QueueTask[] = [];
    private isProcessing = false;

    constructor() {
        ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.simd = true;
    }

    setDevicePreference(preference: deviceType): void {
        if (this.currentDevicePreference !== preference) {
            this.currentDevicePreference = preference;
            if (this.session) {
                console.log(`[VoiceCloningEngine] Device preference changed to ${preference}. Unloading to lazy-reload.`);
                this.unload();
            }
        }
    }

    private async ensureLoaded(): Promise<boolean> {
        if (this.session) return true;
        if (this.loading) {
            await this.loading;
            return this.session !== null;
        }

        this.loading = (async () => {
            try {
                const devicePreference = this.currentDevicePreference;
                const eps: string[] = [];
                
                if (devicePreference !== 'cpu') {
                    const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
                    if (hasWebGpu) eps.push('webgpu');
                }
                eps.push('wasm');

                console.log(`[VoiceCloningEngine] Loading Speaker Encoder with EPs: ${eps.join(', ')}`);
                
                this.session = await ort.InferenceSession.create(SPEAKER_ENCODER_MODEL_URL, {
                    executionProviders: eps,
                });

                this.usingWebGpu = eps[0] === 'webgpu';
                console.log(`[VoiceCloningEngine] Ready (${this.usingWebGpu ? 'WebGPU' : 'WASM'}).`);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error('[VoiceCloningEngine] Initialization failed:', msg);
                this.loadError = msg;
                this.session = null;
            } finally {
                this.loading = null;
            }
        })();

        await this.loading;
        return this.session !== null;
    }

    async unload(): Promise<void> {
        if (this.loading) {
            try { await this.loading; } catch {}
        }
        if (this.session) {
            try { await this.session.release(); } catch {}
        }
        this.session = null;
        this.loading = null;
        this.loadError = null;
        this.usingWebGpu = false;
        console.log('[VoiceCloningEngine] Unloaded.');
    }

    async enqueueUpload(characterId: string, file: File): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.queue.push({ characterId, file, resolve, reject });
            this.processQueue();
        });
    }

    private async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const task = this.queue.shift()!;
            try {
                const arrayBuffer = await task.file.arrayBuffer();
                const audioContext = new AudioContext({ sampleRate: 16000 });
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                const float32Data = audioBuffer.getChannelData(0);
                
                const tensor = await this.extractVoicepack(float32Data, audioBuffer.sampleRate);
                
                if (tensor) {
                    // FIX: Wrap tensor.buffer in Uint8Array to prevent SharedArrayBuffer type collision
                    // Cast to ArrayBuffer to satisfy strict TS 5.2+ BlobPart typing
                    // Uploads strictly as 'voicepack.bin' via serverStorage
                    await uploadCharacterVoice(task.characterId, tensor);
                    task.resolve(true);
                } else {
                    task.resolve(false);
                }
            } catch (err) {
                task.reject(err);
            }
        }
        
        this.isProcessing = false;
        this.unload(); // Auto-unload to free VRAM/RAM
    }

    private async extractVoicepack(audioBuffer: Float32Array, sampleRate: number): Promise<Float32Array | null> {
        const loaded = await this.ensureLoaded();
        if (!loaded || !this.session) return null;

        try {
            let inputBuffer = audioBuffer;
            if (sampleRate !== 16000) {
                const ratio = 16000 / sampleRate;
                const newLength = Math.round(audioBuffer.length * ratio);
                const resampled = new Float32Array(newLength);
                for (let i = 0; i < newLength; i++) {
                    const srcIdx = i / ratio;
                    const floor = Math.floor(srcIdx);
                    const ceil = Math.min(floor + 1, audioBuffer.length - 1);
                    const weight = srcIdx - floor;
                    resampled[i] = audioBuffer[floor] * (1 - weight) + audioBuffer[ceil] * weight;
                }
                inputBuffer = resampled;
            }

            const inputTensor = new ort.Tensor('float32', inputBuffer, [1, inputBuffer.length]);
            const attentionMask = new ort.Tensor('int64', new BigInt64Array(inputBuffer.length).fill(1n), [1, inputBuffer.length]);

            const results = await this.session.run({
                input_values: inputTensor,
                attention_mask: attentionMask
            });
            
            const outputKey = Object.keys(results)[0];
            const outputTensor = results[outputKey];
            const data = outputTensor.data as Float32Array;
            const dims = outputTensor.dims;
            
            if (dims.length === 3) {
                const seqLen = dims[1] as number;
                const hiddenDim = dims[2] as number;
                const pooled = new Float32Array(hiddenDim);
                
                for (let t = 0; t < seqLen; t++) {
                    for (let d = 0; d < hiddenDim; d++) {
                        pooled[d] += data[t * hiddenDim + d];
                    }
                }
                for (let d = 0; d < hiddenDim; d++) pooled[d] /= seqLen;
                
                let norm = 0;
                for (let d = 0; d < hiddenDim; d++) norm += pooled[d] * pooled[d];
                norm = Math.sqrt(norm);
                if (norm > 0) {
                    for (let d = 0; d < hiddenDim; d++) pooled[d] /= norm;
                }
                
                return pooled;
            }
            
            return data as Float32Array;
        } catch (e) {
            console.warn('[VoiceCloningEngine] Extraction failed:', e);
            return null;
        }
    }

    isReady(): boolean { return this.session !== null; }
    isUsingWebGpu(): boolean { return this.usingWebGpu; }
    getError(): string | null { return this.loadError; }
}

export const voiceCloningEngine = new VoiceCloningEngine();