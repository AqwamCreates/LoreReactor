// frontend_src/hooks/useCharacterVoice.ts
import { useCallback } from 'react';
import type { Character, textType } from '../types';
import { textToSpeechEngine, type TextToSpeechContext } from '../services/TextToSpeechEngine';
import { useSessionStore } from './useSessionStore';
import { getCharacterVoiceURL } from '../storages/serverStorage';

const TEXT_EXTRACTORS: Record<textType, (text: string) => string[]> = {
    normal: (text) => { const s = text.replace(/"[^"]*"|'[^']*'/g, '').replace(/\*\*[^*]+\*\*/g, '').replace(/(?<!\*)\*(?!\*)[^*]+\*(?!\*)/g, '').replace(/\([^)]+\)/g, '').replace(/\[[^\]]+\]/g, '').replace(/\{[^}]+\}/g, '').trim(); return s ? [s] : []; },
    quoted: (text) => { const m = text.match(/"[^"]*"|'[^']*'/g); return m ? m.map(x => x.replace(/^["']|["']$/g, '')) : []; },
    bolded: (text) => { const m = text.match(/\*\*[^*]+\*\*/g); return m ? m.map(x => x.replace(/\*\*/g, '')) : []; },
    italicized: (text) => { const m = text.match(/(?<!\*)\*(?!\*)[^*]+\*(?!\*)/g); return m ? m.map(x => x.replace(/\*/g, '')) : []; },
    parenthesized: (text) => { const m = text.match(/\(([^)]+)\)/g); return m ? m.map(x => x.replace(/^\(|\)$/g, '')) : []; },
    bracketed: (text) => { const m = text.match(/\[([^\]]+)\]/g); return m ? m.map(x => x.replace(/^\[|\]$/g, '')) : []; },
    braced: (text) => { const m = text.match(/\{([^}]+)\}/g); return m ? m.map(x => x.replace(/^\{|\}$/g, '')) : []; },
};

export function useCharacterVoice() {
    const speakMessage = useCallback((text: string, character: Character) => {
        // 1. Extract and validate voice data upfront to satisfy TypeScript narrowing inside closures
        const voiceFilename = character.voice?.voiceFilename;
        const transcript = character.voice?.textContent;

        if (!voiceFilename || !transcript) {
            return; 
        }

        // 2. Filter text based on profile settings (Avoid reassigning the 'text' parameter directly)
        let finalText = text;
        const profile = useSessionStore.getState().interactionData?.profile;
        
        if (profile) {
            const parts: string[] = [];
            for (const [type, enabled] of Object.entries(profile.narrateTexts)) {
                if (!enabled) continue;
                const extractor = TEXT_EXTRACTORS[type as textType];
                if (extractor) parts.push(...extractor(text));
            }
            const filtered = parts.join(' ').trim();
            if (!filtered) return;
            finalText = filtered;
        }

        (async () => {
            try {
                // 3. Fetch the reference audio as Base64
                const voiceUrl = getCharacterVoiceURL(character.id, voiceFilename);
                if (!voiceUrl) return;

                const audioResponse = await fetch(voiceUrl);
                if (!audioResponse.ok) return;
                
                const audioBlob = await audioResponse.blob();
                const base64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(audioBlob);
                });

                const context: TextToSpeechContext = { 
                    devicePreference: profile?.textToSpeechDeviceType ?? 'auto' 
                };

                // 4. Hit the backend
                const blob = await textToSpeechEngine.synthesize(
                    finalText, 
                    base64, 
                    transcript, 
                    context
                );

                if (blob) {
                    const u = URL.createObjectURL(blob);
                    const a = new Audio(u);
                    a.onended = () => URL.revokeObjectURL(u);
                    a.play().catch(e => console.warn('TTS playback failed:', e));
                }
            } catch (e) {
                console.warn('TTS speak failed:', e);
            }
        })();
    }, []);

    return { speakMessage };
}