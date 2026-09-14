// src/hooks/useChatUI.ts
import { useRef, useEffect, useCallback } from 'react';
import { getAudioEngine } from '../services/AudioEngine';
import { useCharacterVoice } from './useCharacterVoice';
import type { Character, InteractionData } from '../types';

// Accept isAtBottomRef as an argument to avoid "modify local variable" errors in parent
export function useChatUI(
    interactionData: InteractionData | null, 
    isLoading: boolean, 
    streamingText: string,
    isAtBottomRef: React.MutableRefObject<boolean>
) {
    const chatHistoryRef = useRef<HTMLDivElement>(null);
    const messageEndRef = useRef<HTMLDivElement>(null);
    
    const { speakMessage } = useCharacterVoice();

    // --- Audio Engine Lifecycle ---
    useEffect(() => {
        const audioEngine = getAudioEngine();
        audioEngine.startVolumeTicker();
        return () => { audioEngine.stopAll(); };
    }, []);

    useEffect(() => {
        if (!interactionData) return;
        const audioEngine = getAudioEngine();
        const profileVolume = interactionData.Profile?.volume ?? -1;
        audioEngine.setGlobalVolume(profileVolume);
        audioEngine.evaluate(interactionData);
    }, [interactionData]);

    // --- Scroll Tracking ---
    useEffect(() => {
        const el = chatHistoryRef.current; 
        if (!el) return;
        const fn = () => { isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
        el.addEventListener('scroll', fn, { passive: true });
        return () => el.removeEventListener('scroll', fn);
    }, [isAtBottomRef]);

    // FIX: Only auto-scroll during active streaming.
    // When isLoading transitions to false (stop/completion), do NOT auto-scroll
    // to messageEndRef — the relevant message may not be at the bottom
    // (e.g., stopped mid-resume). Fresh sends handle their own scrolling
    // via isAtBottomRef being set to true before generation starts.
    useEffect(() => {
        if (!isAtBottomRef.current) return;
        
        if (isLoading && streamingText && messageEndRef.current) {
            messageEndRef.current.scrollIntoView({ behavior: 'auto' });
        }
    }, [streamingText, isLoading, isAtBottomRef]);

    const playVoice = useCallback((text: string, character: Character) => {
        // FIX: Added optional chaining (?.) to prevent crash when interactionData is null
        if (character.id !== interactionData?.protagonist?.id) {
            speakMessage(text, character);
        }
    }, [interactionData?.protagonist?.id, speakMessage]);

    return {
        chatHistoryRef,
        messageEndRef,
        playVoice,
    };
}