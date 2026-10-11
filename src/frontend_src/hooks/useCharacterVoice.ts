// frontend_src/hooks/useCharacterVoice.ts
import { useCallback } from 'react';
import type { Character } from '../types';
import { textToSpeechEngine, fetchVoiceReference, type TextToSpeechContext } from '../services/TextToSpeechEngine';
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

                const context: TextToSpeechContext = { 
                    devicePreference: profile?.textToSpeechDeviceType ?? 'auto' 
                };

                const blob = await textToSpeechEngine.synthesize(
                    finalText, 
                    base64, 
                    character.voice.textContent, 
                    character.voice.language,
                    context
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