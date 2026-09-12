// src/hooks/useCharacterVoice.ts
import { useCallback, useRef } from 'react';
import type { Character } from '../types';
import { getCharacterVoiceUrl } from './storage';
import { TextToSpeechModelEngine, type TextToSpeedLanguageModelContext } from '../services/TextToSpeechModelEngine';
import { localAddress } from '../configurations';
import { useSessionStore } from '../store/useSessionStore';

const textToSpeechModelEngine = new TextToSpeechModelEngine();

export function useCharacterVoice() {
    const uploadedTtsVoicesRef = useRef<Set<string>>(new Set());
    const ttsServerUrl = `${localAddress}:7860`;

    const speakMessage = useCallback((text: string, character: Character) => {
        if (!character.voice) return;
        const profile = useSessionStore.getState().interactionData?.Profile;
        if (profile) {
            const narrateTexts = profile.narrateTexts
            const parts: string[] = [];
            if (narrateTexts.normal) {
                const n = text.replace(/"[^"]*"|'[^']*'/g, '').replace(/\*\*[^*]+\*\*/g, '').replace(/\*[^*]+\*/g, '').trim();
                if (n) parts.push(n);
            }
            if (narrateTexts.quoted) {
                const m = text.match(/"[^"]*"|'[^']*'/g);
                if (m) parts.push(m.map(x => x.replace(/^["']|["']$/g, '')).join(' '));
            }
            if (narrateTexts.bolded) {
                const m = text.match(/\*\*[^*]+\*\*/g);
                if (m) parts.push(m.map(x => x.replace(/\*\*/g, '')).join(' '));
            }
            if (narrateTexts.italicized) {
                const m = text.match(/(?<!\*)\*(?!\*)[^*]+\*(?!\*)/g);
                if (m) parts.push(m.map(x => x.replace(/\*/g, '')).join(' '));
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
                    const url = getCharacterVoiceUrl(character.voice);
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
    }, [ttsServerUrl]);

    return { speakMessage };
}