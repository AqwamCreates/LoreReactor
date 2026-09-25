// src/hooks/useCharacterVoice.ts
import { useCallback, useRef } from 'react';
import type { Character, textType } from '../types';
import { getCharacterVoiceUrl, getMultiplayerCharacterVoiceUrl } from '../storage/serverStorage';
import { TextToSpeechModelEngine, type TextToSpeedLanguageModelContext } from '../services/TextToSpeechModelEngine';
import { localAddress } from '../configurations';
import { useSessionStore } from './useSessionStore';

const textToSpeechModelEngine = new TextToSpeechModelEngine();

const TEXT_EXTRACTORS: Record<textType, (text: string) => string[]> = {
    normal: (text) => {
        const stripped = text
            .replace(/"[^"]*"|'[^']*'/g, '')
            .replace(/\*\*[^*]+\*\*/g, '')
            .replace(/(?<!\*)\*(?!\*)[^*]+\*(?!\*)/g, '')
            .replace(/\([^)]+\)/g, '')
            .replace(/\[[^\]]+\]/g, '')
            .replace(/\{[^}]+\}/g, '')
            .trim();
        return stripped ? [stripped] : [];
    },
    quoted: (text) => {
        const m = text.match(/"[^"]*"|'[^']*'/g);
        return m ? m.map(x => x.replace(/^["']|["']$/g, '')) : [];
    },
    bolded: (text) => {
        const m = text.match(/\*\*[^*]+\*\*/g);
        return m ? m.map(x => x.replace(/\*\*/g, '')) : [];
    },
    italicized: (text) => {
        const m = text.match(/(?<!\*)\*(?!\*)[^*]+\*(?!\*)/g);
        return m ? m.map(x => x.replace(/\*/g, '')) : [];
    },
    parenthesized: (text) => {
        const m = text.match(/\(([^)]+)\)/g);
        return m ? m.map(x => x.replace(/^\(|\)$/g, '')) : [];
    },
    bracketed: (text) => {
        const m = text.match(/\[([^\]]+)\]/g);
        return m ? m.map(x => x.replace(/^\[|\]$/g, '')) : [];
    },
    braced: (text) => {
        const m = text.match(/\{([^}]+)\}/g);
        return m ? m.map(x => x.replace(/^\{|\}$/g, '')) : [];
    },
};

export function useCharacterVoice() {
    const uploadedTtsVoicesRef = useRef<Set<string>>(new Set());
    const ttsServerUrl = `${localAddress}:7860`;

    // Derive the multiplayer context variable directly from the store and localStorage
    const isMultiplayerClient = !!localStorage.getItem('loreReactor_joinSessionId');
    const multiplayerData = useSessionStore(s => s.multiplayerData);
    const interactionDataId = useSessionStore(s => s.interactionData?.id ?? null);
    const isMultiplayerChat = isMultiplayerClient || !!(multiplayerData && interactionDataId && multiplayerData.interactionDataIds.includes(interactionDataId));

    const speakMessage = useCallback((text: string, character: Character) => {
        if (!character.voice) return;
        const profile = useSessionStore.getState().interactionData?.Profile;
        if (profile) {
            const narrateTexts = profile.narrateTexts;
            const parts: string[] = [];
            for (const [type, enabled] of Object.entries(narrateTexts)) {
                if (!enabled) continue;
                const extractor = TEXT_EXTRACTORS[type as textType];
                if (extractor) {
                    parts.push(...extractor(text));
                }
            }
            const filtered = parts.join(' ').trim();
            if (!filtered) return;
            text = filtered;
        }

        (async () => {
            try {
                const context: TextToSpeedLanguageModelContext = { serverUrl: ttsServerUrl || undefined, backend: 'Qwen3-TTS' };
                const label = character.id;
                if (!uploadedTtsVoicesRef.current.has(label)) {
                    // YOUR EXACT LOGIC: Try main folder, fallback to multiplayer folder if session is multiplayer
                    const url = getCharacterVoiceUrl(label, character.voice) || (isMultiplayerChat ? getMultiplayerCharacterVoiceUrl(label, character.voice) : null);
                    if (!url) return;
                    const response = await fetch(url);
                    if (!response.ok) return;
                    const blob = await response.blob();
                    const file = new File([blob], `${label}.wav`, { type: blob.type || 'audio/wav' });
                    if (!await textToSpeechModelEngine.uploadVoice(label, file, context)) return;
                    uploadedTtsVoicesRef.current.add(label);
                }
                await new Promise(r => setTimeout(r, 500));
                const blob = await textToSpeechModelEngine.synthesize(text, context, { voice: label });
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
    }, [ttsServerUrl, isMultiplayerChat]);

    return { speakMessage };
}