// frontend_src/hooks/useCharacterVoice.ts
import { useCallback } from 'react';
import type { Character, textType } from '../types';
import { textToSpeechModelEngine, type TextToSpeedLanguageModelContext } from '../services/TextToSpeechEngine';
import { useSessionStore } from './useSessionStore';

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
            text = filtered;
        }

        (async () => {
            try {
                const context: TextToSpeedLanguageModelContext = { devicePreference: profile?.textToSpeechDeviceType ?? 'auto' };
                // Blindly trigger. If voicepack.bin doesn't exist, the engine returns null gracefully.
                const blob = await textToSpeechModelEngine.synthesize(text, character.id, context);
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