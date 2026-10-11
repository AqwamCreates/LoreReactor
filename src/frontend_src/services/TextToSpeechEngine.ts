// frontend_src/services/TextToSpeechEngine.ts
import { KokoroTTS } from "kokoro-js";
import type { deviceType } from '../types';
import { getCharacterVoice } from '../storages/serverStorage';

// ─── RUNTIME MONKEY PATCH FOR KOKORO-JS ─────────────────────────────────
const originalGenerate = KokoroTTS.prototype.generate;
const originalGenerateFromIds = KokoroTTS.prototype.generate_from_ids;

KokoroTTS.prototype.generate = async function(text: string, options: any = {}) {
    let { voice = "af_heart", speed = 1 } = options;
    
    if (voice && typeof voice === 'object' && voice.customVoice) {
        let capturedIds: any = null;
        const patchedGenFromIds = this.generate_from_ids;
        
        // Spy on generate_from_ids to capture tokenized IDs without running the model
        this.generate_from_ids = async function(input_ids: any) {
            capturedIds = input_ids;
            return { dummy: true } as any;
        };
        
        // Trigger original generate with a valid default voice to handle phonemization
        await originalGenerate.call(this, text, { voice: "af_heart", speed });
        
        // Restore the patched method
        this.generate_from_ids = patchedGenFromIds;
        
        if (capturedIds) {
            return await this.generate_from_ids(capturedIds, { voice, speed });
        }
    }
    
    return originalGenerate.call(this, text, options);
};

KokoroTTS.prototype.generate_from_ids = async function(input_ids: any, options: any = {}) {
    let { voice = "af_heart", speed = 1 } = options;
    
    if (voice && typeof voice === 'object' && voice.customVoice) {
        const customVoiceArray = voice.customVoice as Float32Array;
        
        // Replicate kokoro-js internal style vector slicing logic exactly
        const l = 256 * Math.min(Math.max(input_ids.dims.at(-1) - 2, 0), 509);
        const s = customVoiceArray.slice(l, l + 256);
        
        // 🟢 CRITICAL FIX: Use the exact Tensor class from the tokenizer to avoid 
        // module duplication issues (instanceof Tensor failing silently)
        const TensorClass = input_ids.constructor;
        
        const modelInputs = {
            input_ids: input_ids,
            style: new TensorClass("float32", s, [1, 256]),
            speed: new TensorClass("float32", [speed], [1])
        };
        
        const result = await this.model(modelInputs);
        
        // Attempt to get RawAudio. If module duplication breaks it, use a duck-typed fallback.
        let RawAudioClass: any = null;
        try {
            const transformers = await import('@huggingface/transformers');
            RawAudioClass = transformers.RawAudio;
        } catch (e) {}

        if (RawAudioClass) {
            return new RawAudioClass(result.waveform.data, 24000);
        } else {
            // Fallback: Create a duck-typed object that satisfies the toBlob() requirement
            return {
                data: result.waveform.data,
                sampling_rate: 24000,
                toBlob: function() {
                    const floatData = this.data;
                    const intData = new Int16Array(floatData.length);
                    for (let i = 0; i < floatData.length; i++) {
                        let val = Math.max(-1, Math.min(1, floatData[i]));
                        intData[i] = val < 0 ? val * 0x8000 : val * 0x7FFF;
                    }
                    const buffer = new ArrayBuffer(44 + intData.length * 2);
                    const view = new DataView(buffer);
                    const writeString = (offset: number, str: string) => {
                        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
                    };
                    writeString(0, 'RIFF');
                    view.setUint32(4, 36 + intData.length * 2, true);
                    writeString(8, 'WAVE');
                    writeString(12, 'fmt ');
                    view.setUint32(16, 16, true);
                    view.setUint16(20, 1, true);
                    view.setUint16(22, 1, true);
                    view.setUint32(24, 24000, true);
                    view.setUint32(28, 24000 * 2, true);
                    view.setUint16(32, 2, true);
                    view.setUint16(34, 16, true);
                    writeString(36, 'data');
                    view.setUint32(40, intData.length * 2, true);
                    new Int16Array(buffer, 44).set(intData);
                    return new Blob([buffer], { type: 'audio/wav' });
                }
            };
        }
    }
    
    return originalGenerateFromIds.call(this, input_ids, options);
};
// ─────────────────────────────────────────────────────────────────────────

export interface TextToSpeechContext {
  devicePreference?: deviceType;
}

class TextToSpeechEngine {
    private tts: any = null;
    private loadingPromise: Promise<any> | null = null;
    private currentDevicePreference: deviceType = 'auto';
    private activeBackend: 'webgpu' | 'wasm' = 'wasm';
    private synthesisQueue: Promise<any> = Promise.resolve(); 

    setDevicePreference(preference: deviceType): void {
        if (this.currentDevicePreference !== preference) {
            this.currentDevicePreference = preference;
            if (this.tts) this.unload();
        }
    }

    private async resolveExecutionDevice(): Promise<{ device: 'webgpu' | 'wasm'; dtype: string }> {
        const pref = this.currentDevicePreference;
        if (pref === 'cpu') return { device: 'wasm', dtype: 'q8' };

        const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator && (await navigator.gpu?.requestAdapter().catch(() => null));
        if (hasWebGPU && (pref === 'gpu' || pref === 'auto')) {
            console.log('[TTSEngine] ⚡ WebGPU available. Offloading synthesis to GPU.');
            return { device: 'webgpu', dtype: 'fp32' };
        }

        console.log('[TTSEngine] 🐢 Falling back to multi-threaded WASM CPU.');
        return { device: 'wasm', dtype: 'q8' };
    }

    async load(): Promise<boolean> {
        if (this.tts) return true;
        if (this.loadingPromise) {
            this.tts = await this.loadingPromise;
            return !!this.tts;
        }

        this.loadingPromise = (async () => {
            try {
                const { device, dtype } = await this.resolveExecutionDevice();
                this.activeBackend = device;
                console.log(`[TTSEngine] Initializing Kokoro-82M on [Device: ${device.toUpperCase()}, Dtype: ${dtype}]...`);

                const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { 
                    dtype: dtype as any, device: device as any 
                });
                console.log(`[TTSEngine] Kokoro engine initialized on ${device}.`);
                return tts;
            } catch (e: any) {
                console.error('[TTSEngine] Primary device initialization failed:', e);
                if (this.activeBackend === 'webgpu') {
                    console.warn('[TTSEngine] WebGPU failed. Attempting WASM fallback...');
                    try {
                        const fallbackTts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "wasm" });
                        this.activeBackend = 'wasm';
                        return fallbackTts;
                    } catch (fallbackErr) {
                        console.error('[TTSEngine] Fallback WASM initialization also failed:', fallbackErr);
                    }
                }
                return null;
            } finally {
                this.loadingPromise = null;
            }
        })();

        this.tts = await this.loadingPromise;
        return !!this.tts;
    }

    async unload(): Promise<void> {
        if (this.tts && typeof this.tts.dispose === 'function') {
            try { await this.tts.dispose(); } catch {}
        }
        this.tts = null;
        this.loadingPromise = null;
    }

    async synthesize(
        text: string,
        characterId: string,
        context?: TextToSpeechContext,
    ): Promise<Blob | null> {
        if (context?.devicePreference) this.setDevicePreference(context.devicePreference);

        const task = this.synthesisQueue.then(async () => {
            const loaded = await this.load();
            if (!loaded || !this.tts) return null;

            const voiceUrl = getCharacterVoice(characterId);
            if (!voiceUrl) {
                console.warn('[TTSEngine] No voice file found for character:', characterId);
                return null;
            }

            let voicepack: Float32Array | null = null;
            try {
                const response = await fetch(voiceUrl);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const arrayBuffer = await response.arrayBuffer();
                voicepack = new Float32Array(arrayBuffer);
            } catch (e) {
                console.warn('[TTSEngine] Failed to fetch voicepack:', e);
                return null;
            }

            if (!voicepack || voicepack.length === 0) return null;

            try {
                // 🟢 Pass the custom voice array directly into the patched generate method
                const audio = await this.tts.generate(text, { 
                    voice: { customVoice: voicepack },
                    speed: 1.0 
                });
                
                return audio.toBlob();
            } catch (e) {
                console.error('[TTSEngine] Synthesis with custom voicepack failed:', e);
                try {
                    const audio = await this.tts.generate(text, { voice: "af_heart", speed: 1.0 });
                    return audio.toBlob();
                } catch (fallbackErr) {
                    console.error('[TTSEngine] Fallback voice generation also failed:', fallbackErr);
                    return null;
                }
            }
        }).catch(e => {
            console.error('[TTSEngine] Unhandled error in synthesis queue:', e);
            return null;
        });

        this.synthesisQueue = task.catch(() => null);
        return task;
    }

    isReady(): boolean { return this.tts !== null; }
    isUsingWebGpu(): boolean { return this.activeBackend === 'webgpu'; }
    getError(): string | null { return null; }
}

export const textToSpeechEngine = new TextToSpeechEngine();