// frontend_src/services/TextToSpeechEngine.ts
import { localURL } from '../../configurations';
import { getCharacterVoiceURL } from '../storages/serverStorage';
import type { Character, deviceType, Sampler } from '../types';

/**
 * Fetches a character's voice reference sample from storage and converts it to Base64.
 */
export async function fetchVoiceReference(character: Character): Promise<string | null> {
    const voice = character.voice;
    if (!voice?.voiceFilename) return null;

    const voiceUrl = getCharacterVoiceURL(character.id, voice.voiceFilename);
    if (!voiceUrl) return null;

    try {
        const response = await fetch(voiceUrl);
        if (!response.ok) return null;

        const blob = await response.blob();
        return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
}

class TextToSpeechEngine {
    private isLoaded: boolean = false;

    /**
     * Warms up the backend TTS server (spawns Python process if not running).
     * Optional - backend already lazy loads on first request.
     */
    async load() {
        if (this.isLoaded) return;
        
        try {
            const response = await fetch(`${localURL}/api/text-to-speech/load`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            
            if (response.ok) {
                this.isLoaded = true;
            }
        } catch (e) {
            console.warn('[TextToSpeechEngine] Load failed:', e);
        }
    }

    /**
     * Shuts down the backend TTS server to free GPU/RAM resources.
     */
    async unload() {
        if (!this.isLoaded) return;
        
        try {
            const response = await fetch(`${localURL}/api/text-to-speech/unload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            
            if (response.ok) {
                this.isLoaded = false;
            }
        } catch (e) {
            console.warn('[TextToSpeechEngine] Unload failed:', e);
        }
    }

    async synthesize(
        text: string,
        sampler: Sampler | undefined,
        audioBase64: string,
        transcript: string,
        language?: string,
        devicePreference?: deviceType,
    ): Promise<Blob | null> {
        console.log(`[TextToSpeechEngine] Synthesizing text: "${text}" with sampler: ${sampler?.name ?? 'default'}, language: ${language ?? 'default'}, device: ${devicePreference ?? 'auto'}`);
        try {
            const response = await fetch(`${localURL}/api/text-to-speech/synthesize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    sampler,
                    audioBase64,
                    transcript,
                    language,
                    device: devicePreference ?? 'auto'
                })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(err.error || `HTTP ${response.status}`);
            }

            this.isLoaded = true; // Mark as loaded after successful synthesis
            return await response.blob();
        } catch (e) {
            console.error('[TextToSpeechEngine] Backend synthesis failed:', e);
            return null;
        }
    }
}

export const textToSpeechEngine = new TextToSpeechEngine();