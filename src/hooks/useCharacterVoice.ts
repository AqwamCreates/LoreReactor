// src/hooks/useCharacterVoice.ts
import { useCallback, useRef } from 'react';
import type { Character, InteractionData } from '../types';
import { getCharacterVoiceUrl } from './storage';
import { TextToSpeechModelEngine, type TextToSpeedLanguageModelContext } from '../services/TextToSpeechModelEngine';
import { localAddress } from '../configurations';

const textToSpeechModelEngine = new TextToSpeechModelEngine();

export function useCharacterVoice(
    interactionDataRef: React.MutableRefObject<InteractionData | null>,
) {
    const uploadedTtsVoicesRef = useRef<Set<string>>(new Set());
    const ttsServerUrl = `${localAddress}:7860`;

    const speakMessage = useCallback((text: string, character: Character) => {
        if (!character.voice) return;
        const profile = interactionDataRef.current?.Profile;
        if (profile) {
            const parts: string[] = [];
            if (profile.narrateNormalText !== false) {
                let n = text.replace(/"[^"]*"|'[^']*'/g, '').replace(/\*\*[^*]+\*\*/g, '').replace(/\*[^*]+\*/g, '').trim();
                if (n) parts.push(n);
            }
            if (profile.narrateQuotedText) {
                const m = text.match(/"[^"]*"|'[^']*'/g);
                if (m) parts.push(m.map(x => x.replace(/^["']|["']$/g, '')).join(' '));
            }
            if (profile.narrateBoldedText) {
                const m = text.match(/\*\*[^*]+\*\*/g);
                if (m) parts.push(m.map(x => x.replace(/\*\*/g, '')).join(' '));
            }
            if (profile.narrateItalicizedText) {
                const m = text.match(/(?<!\*)\*(?!\*)[^*]+\*(?!\*)/g);
                if (m) parts.push(m.map(x => x.replace(/\*/g, '')).join(' '));
            }
            const filtered = parts.join(' ').trim();
            if (!filtered) return;
            text = filtered;
        }

        (async () => {
            try {
                const ctx: TextToSpeedLanguageModelContext = { serverUrl: ttsServerUrl || undefined, backend: 'Qwen3-TTS' };
                const label = character.id;
                if (!uploadedTtsVoicesRef.current.has(label)) {
                    const url = getCharacterVoiceUrl(character.voice);
                    if (!url) return;
                    const res = await fetch(url);
                    if (!res.ok) return;
                    const blob = await res.blob();
                    const file = new File([blob], `${label}.wav`, { type: blob.type || 'audio/wav' });
                    if (!await textToSpeechModelEngine.uploadVoice(label, file, ctx)) return;
                    uploadedTtsVoicesRef.current.add(label);
                }
                await new Promise(r => setTimeout(r, 500));
                const blob = await textToSpeechModelEngine.synthesize(text, ctx, { voice: label });
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
    }, [interactionDataRef, ttsServerUrl]);

    return { speakMessage };
}