// src/hooks/useChatUI.ts
import { useRef, useEffect, useCallback } from 'react';
import { getAudioEngine } from '../services/AudioEngine';
import { useCharacterVoice } from './useCharacterVoice';
import type { InteractionData } from '../types';

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

    useEffect(() => {
        if (!isAtBottomRef.current) return;
        if (isLoading && streamingText && messageEndRef.current) {
            messageEndRef.current.scrollIntoView({ behavior: 'auto' });
        } else if (!isLoading && messageEndRef.current && interactionData?.interactionHistory.length) {
            messageEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [streamingText, isLoading, interactionData?.interactionHistory.length, isAtBottomRef]);

    const playVoice = useCallback((text: string, character: any) => {
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