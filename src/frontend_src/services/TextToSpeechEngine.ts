// frontend_src/services/TextToSpeechEngine.ts
import { localURL } from '../../configurations';
import type { deviceType } from '../types';

export interface TextToSpeechContext {
  devicePreference?: deviceType;
}

class TextToSpeechEngine {
    async synthesize(
        text: string,
        audioBase64: string,
        transcript: string,
        context?: TextToSpeechContext
    ): Promise<Blob | null> {
        try {
            const response = await fetch(`${localURL}/api/text-to-speech`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    audioBase64,
                    transcript,
                    device: context?.devicePreference ?? 'auto'
                })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(err.error || `HTTP ${response.status}`);
            }

            return await response.blob();
        } catch (e) {
            console.error('[TTSEngine] Backend synthesis failed:', e);
            return null;
        }
    }
}

export const textToSpeechEngine = new TextToSpeechEngine();