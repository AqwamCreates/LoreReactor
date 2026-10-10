// frontend_src/services/TextToSpeechEngine.ts
import * as ort from 'onnxruntime-web';
import type { deviceType } from '../types';
import { getCharacterVoice } from '../storages/serverStorage';

// Kokoro-82M ONNX model (Apache 2.0 / MIT licensed)
const KOKORO_MODEL_URL = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_q8f16.onnx';

export interface TextToSpeechContext {
  devicePreference?: deviceType;
}

class TextToSpeechEngine {
    private session: ort.InferenceSession | null = null;
    private loading: Promise<void> | null = null;
    private loadError: string | null = null;
    private usingWebGpu = false;
    private currentDevicePreference: deviceType = 'auto';

    constructor() {
        ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
        
        // WebAssembly multi-threading requires SharedArrayBuffer (enabled via COOP/COEP headers in Tauri/Vite).
        // We check crossOriginIsolated to prevent console warnings if headers are missing.
        const canUseThreads = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
        ort.env.wasm.numThreads = canUseThreads 
            ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)) 
            : 1;
            
        ort.env.wasm.simd = true;
    }

    setDevicePreference(preference: deviceType): void {
        if (this.currentDevicePreference !== preference) {
            this.currentDevicePreference = preference;
            if (this.session) {
                console.log(`[TTSEngine] Device preference changed to ${preference}. Unloading to lazy-reload.`);
                this.unload();
            }
        }
    }

    async load(): Promise<boolean> {
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

                console.log(`[TTSEngine] Loading Kokoro-82M with EPs: ${eps.join(', ')}`);
                
                this.session = await ort.InferenceSession.create(KOKORO_MODEL_URL, {
                    executionProviders: eps,
                });

                this.usingWebGpu = eps[0] === 'webgpu';
                console.log(`[TTSEngine] Ready (${this.usingWebGpu ? 'WebGPU' : 'WASM'}).`);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error('[TTSEngine] Initialization failed:', msg);
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
        console.log('[TTSEngine] Unloaded.');
    }

    async synthesize(
        text: string,
        characterId: string,
        context?: TextToSpeechContext,
    ): Promise<Blob | null> {
        if (context?.devicePreference) {
            this.setDevicePreference(context.devicePreference);
        }

        const loaded = await this.load();
        if (!loaded || !this.session) return null;

        const voiceUrl = getCharacterVoice(characterId);
        if (!voiceUrl) {
            console.warn('[TTSEngine] No voice file found for character:', characterId);
            return null;
        }

        let voicepack: Float32Array | null;
        try {
            const response = await fetch(voiceUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const arrayBuffer = await response.arrayBuffer();
            const uint8View = new Uint8Array(arrayBuffer);
            
            // Check if the payload is actually JSON (starts with '{' which is 0x7B)
            if (uint8View.length > 0 && uint8View[0] === 0x7B) {
                const text = new TextDecoder().decode(uint8View);
                const json = JSON.parse(text);
                if (!json.base64) throw new Error('Missing base64 data in JSON');
                const binaryString = atob(json.base64.replace(/^data:[^;]+;base64,/, ''));
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                voicepack = new Float32Array(bytes.buffer);
            } else {
                // Standard raw binary response (application/octet-stream)
                voicepack = new Float32Array(arrayBuffer);
            }
        } catch (e) {
            console.warn('[TTSEngine] Failed to fetch and parse voicepack tensor:', e);
            return null;
        }

        if (!voicepack || voicepack.length === 0) {
            console.warn('[TTSEngine] Voicepack tensor is empty.');
            return null;
        }

        const SAMPLE_RATE = 24000; // Kokoro natively outputs 24kHz audio
        const chunks = this.chunkText(text, 280);
        const audioChunks: Float32Array[] = [];

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            if (chunk.length === 0) continue;

            // Fallback tokenization: Map characters to integer IDs.
            const inputIds = new BigInt64Array(chunk.length + 2);
            inputIds[0] = 0n; // BOS
            for (let j = 0; j < chunk.length; j++) {
                inputIds[j + 1] = BigInt(chunk.charCodeAt(j) % 158);
            }
            inputIds[chunk.length + 1] = 0n; // EOS

            const inputIdsTensor = new ort.Tensor('int64', inputIds, [1, inputIds.length]);

            // Kokoro strictly expects a 256-dim style vector.
            let styleData = voicepack;
            if (voicepack.length > 256) {
                styleData = voicepack.slice(0, 256);
            } else if (voicepack.length < 256) {
                styleData = new Float32Array(256);
                styleData.set(voicepack);
            }
            
            const styleTensor = new ort.Tensor('float32', styleData, [1, 256]);
            const speedTensor = new ort.Tensor('float32', new Float32Array([1.0]), [1]);

            try {
                const feeds: Record<string, ort.Tensor> = {
                    input_ids: inputIdsTensor,
                    style: styleTensor,
                    speed: speedTensor
                };

                const results = await this.session.run(feeds);
                
                const outputKey = Object.keys(results).find(k => k.toLowerCase().includes('audio')) || Object.keys(results)[0];
                const audioTensor = results[outputKey];
                
                if (audioTensor && audioTensor.data) {
                    audioChunks.push(audioTensor.data as Float32Array);
                }
                
                // Yield to the main thread between chunks to prevent UI stuttering
                if (i < chunks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            } catch (e) {
                console.error(`[TTSEngine] Inference failed for chunk ${i}:`, e);
            }
        }

        if (audioChunks.length === 0) {
            console.warn('[TTSEngine] No audio chunks were generated.');
            return null;
        }

        // Crossfade and stitch chunks (100ms at 24kHz = 2400 samples)
        const finalAudio = this.stitchAudioChunks(audioChunks, 2400); 
        
        return this.float32ToWavBlob(finalAudio, SAMPLE_RATE);
    }

    private chunkText(text: string, maxLength: number): string[] {
        const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
        const chunks: string[] = [];
        let currentChunk = '';

        for (const sentence of sentences) {
            if ((currentChunk + sentence).length > maxLength && currentChunk.length > 0) {
                chunks.push(currentChunk.trim());
                currentChunk = sentence;
            } else {
                currentChunk += sentence;
            }
        }
        if (currentChunk.trim()) chunks.push(currentChunk.trim());
        return chunks;
    }

    private stitchAudioChunks(chunks: Float32Array[], crossfadeSamples: number): Float32Array {
        if (chunks.length === 0) return new Float32Array(0);
        if (chunks.length === 1) return chunks[0];

        const totalLength = chunks.reduce((sum, c) => sum + c.length, 0) - (crossfadeSamples * (chunks.length - 1));
        const result = new Float32Array(totalLength);
        let offset = 0;

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            if (i === 0) {
                result.set(chunk, offset);
                offset += chunk.length;
            } else {
                const prevChunk = chunks[i - 1];
                const fadeOutStart = prevChunk.length - crossfadeSamples;
                const fadeInStart = offset - crossfadeSamples;

                for (let j = 0; j < crossfadeSamples; j++) {
                    const fadeOut = prevChunk[fadeOutStart + j] * (1 - j / crossfadeSamples);
                    const fadeIn = chunk[j] * (j / crossfadeSamples);
                    result[fadeInStart + j] = fadeOut + fadeIn;
                }
                result.set(chunk.subarray(crossfadeSamples), offset);
                offset += chunk.length - crossfadeSamples;
            }
        }
        return result;
    }

    private float32ToWavBlob(samples: Float32Array, sampleRate: number): Blob {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);

        const writeString = (offset: number, str: string) => {
            for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
        };

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, samples.length * 2, true);

        // Use Int16Array for massively faster conversion
        const int16 = new Int16Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // Memcpy the Int16 buffer directly into the WAV buffer
        new Uint8Array(buffer, 44).set(new Uint8Array(int16.buffer));

        return new Blob([buffer], { type: 'audio/wav' });
    }

    isReady(): boolean { return this.session !== null; }
    isUsingWebGpu(): boolean { return this.usingWebGpu; }
    getError(): string | null { return this.loadError; }
}

export const textToSpeechEngine = new TextToSpeechEngine();