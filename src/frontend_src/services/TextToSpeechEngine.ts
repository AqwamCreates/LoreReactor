// frontend_src/services/TextToSpeechEngine.ts
import { KokoroTTS } from "kokoro-js";
import type { deviceType } from '../types';
import { getCharacterVoice } from '../storages/serverStorage';

export interface TextToSpeechContext {
  devicePreference?: deviceType;
}

class TextToSpeechEngine {
    private tts: any = null;
    private loadingPromise: Promise<any> | null = null;
    private currentDevicePreference: deviceType = 'auto';

    setDevicePreference(preference: deviceType): void {
        this.currentDevicePreference = preference;
        // kokoro-js handles device selection internally or via pipeline options
    }

    async load(): Promise<boolean> {
        if (this.tts) return true;
        if (this.loadingPromise) {
            this.tts = await this.loadingPromise;
            return !!this.tts;
        }

        this.loadingPromise = (async () => {
            try {
                console.log('[TTSEngine] Loading Kokoro-82M via kokoro-js...');
                // dtype "q8" is optimal for browser performance/quality balance
                // device "wasm" is stable; "webgpu" can be tried if supported
                const tts = await KokoroTTS.from_pretrained(
                    "onnx-community/Kokoro-82M-v1.0-ONNX", 
                    { 
                        dtype: "q8",
                        device: "wasm" 
                    }
                );
                console.log('[TTSEngine] Ready.');
                return tts;
            } catch (e) {
                console.error('[TTSEngine] Initialization failed:', e);
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
        if (context?.devicePreference) {
            this.setDevicePreference(context.devicePreference);
        }

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
            
            // kokoro-js expects the voice to be a Float32Array (style tensor)
            voicepack = new Float32Array(arrayBuffer);
        } catch (e) {
            console.warn('[TTSEngine] Failed to fetch voicepack:', e);
            return null;
        }

        if (!voicepack || voicepack.length === 0) return null;

        try {
            // kokoro-js handles phonemization internally.
            // We pass the custom voicepack tensor directly to the 'voice' option.
            // Note: If kokoro-js strictly requires a string ID, this might fail.
            // In that case, we would need to use the pipeline directly.
            const audio = await this.tts.generate(text, { 
                voice: voicepack, // Injecting the cloned [510, 256] tensor
                speed: 1.0 
            });
            
            // kokoro-js returns an Audio object with a toBlob() method
            return audio.toBlob();
        } catch (e) {
            console.error('[TTSEngine] Synthesis failed:', e);
            // Fallback: If custom tensor injection fails, try with a default voice
            // to ensure TTS still works, albeit with a generic voice.
            try {
                const audio = await this.tts.generate(text, { voice: "af_heart", speed: 1.0 });
                return audio.toBlob();
            } catch (fallbackErr) {
                console.error('[TTSEngine] Fallback synthesis also failed:', fallbackErr);
                return null;
            }
        }
    }

    isReady(): boolean { return this.tts !== null; }
    isUsingWebGpu(): boolean { return false; } // kokoro-js abstracts this
    getError(): string | null { return null; }
}

export const textToSpeechEngine = new TextToSpeechEngine();