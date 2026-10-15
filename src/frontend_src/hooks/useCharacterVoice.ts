// src/frontend_src/hooks/useCharacterVoice.ts
import { useCallback } from 'react';
import type { Character, Sampler, deviceType } from '../types';
import { textToSpeechEngine, fetchVoiceReference } from '../services/TextToSpeechEngine';
import { useSessionStore } from './useSessionStore';
import { extractNarratableText } from '../utilities/voiceTextExtractor';

export function useCharacterVoice(allCharacters: Character[] = []) {
    const speakMessage = useCallback((text: string, character: Character) => {
        const state = useSessionStore.getState();
        const profile = state.interactionData?.profile;
        const narrateTexts = profile?.narrateTexts;
        const narrateTextCharacterIds = profile?.narrateTextCharacterIds;
        
        if (!narrateTexts) return;

        const segments = extractNarratableText(text, narrateTexts);
        if (segments.length === 0) return;

        (async () => {
            let currentIndex = 0;
            const playNext = async () => {
                if (currentIndex >= segments.length) return;
                const segment = segments[currentIndex];
                currentIndex++;

                let targetChar = character;
                if (narrateTextCharacterIds?.[segment.textType]) {
                    const overrideId = narrateTextCharacterIds[segment.textType];
                    const overrideChar = allCharacters.find(c => c.id === overrideId);
                    if (overrideChar?.voice?.voiceFilename && overrideChar.voice?.textContent) {
                        targetChar = overrideChar;
                    }
                }

                try {
                    const base64 = await fetchVoiceReference(targetChar);
                    if (!base64 || !targetChar.voice?.textContent) {
                        playNext();
                        return;
                    }

                    const sampler: Sampler | undefined = profile?.characterTextToSpeechModelSampler ?? targetChar.textToSpeechModelSampler;
                    const devicePreference: deviceType = profile?.textToSpeechDeviceType ?? 'auto';

                    const blob = await textToSpeechEngine.synthesize(
                        segment.text,
                        sampler,
                        base64,
                        targetChar.voice.textContent,
                        targetChar.voice.language,
                        devicePreference
                    );

                    if (blob) {
                        const url = URL.createObjectURL(blob);
                        const audio = new Audio(url);
                        audio.onended = () => {
                            URL.revokeObjectURL(url);
                            playNext();
                        };
                        audio.onerror = () => {
                            URL.revokeObjectURL(url);
                            playNext();
                        };
                        audio.play().catch(e => {
                            console.warn('Text To Speech playback failed:', e);
                            playNext();
                        });
                    } else {
                        playNext();
                    }
                } catch (e) {
                    console.warn('Text To Speech speak failed:', e);
                    playNext();
                }
            };
            playNext();
        })();
    }, [allCharacters]);

    return { speakMessage };
}