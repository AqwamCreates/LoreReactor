// frontend_src/hooks/useCharacterVoice.ts
import { useCallback } from 'react';
import type { Character, Sampler, deviceType } from '../types';
import { textToSpeechEngine, fetchVoiceReference } from '../services/TextToSpeechEngine';
import { useSessionStore } from './useSessionStore';
import { extractNarratableText } from '../utilities/voiceTextExtractor';

export function useCharacterVoice() {
    const speakMessage = useCallback((text: string, character: Character) => {
        const profile = useSessionStore.getState().interactionData?.profile;
        const narrateTexts = profile?.narrateTexts;
        
        if (!narrateTexts) return;

        const finalText = extractNarratableText(text, narrateTexts);
        if (!finalText) return;

        (async () => {
            try {
                const base64 = await fetchVoiceReference(character);
                if (!base64 || !character.voice?.textContent) return;

                // ✅ PRECEDENCE: Profile -> Character -> Default (undefined)
                const sampler: Sampler | undefined = profile?.characterTextToSpeechModelSampler ?? character.textToSpeechModelSampler;
                const devicePreference: deviceType = profile?.textToSpeechDeviceType ?? 'auto';

                const blob = await textToSpeechEngine.synthesize(
                    finalText,
                    sampler,
                    base64,
                    character.voice.textContent,
                    character.voice.language,
                    devicePreference
                );

                if (blob) {
                    const url = URL.createObjectURL(blob);
                    const audio = new Audio(url);
                    audio.onended = () => URL.revokeObjectURL(url);
                    audio.play().catch(e => console.warn('Text To Speech playback failed:', e));
                }
            } catch (e) {
                console.warn('Text To Speech speak failed:', e);
            }
        })();
    }, []);

    return { speakMessage };
}