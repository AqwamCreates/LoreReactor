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
    const hasScrolledToBottomRef = useRef(false);
    const previousChatIdRef = useRef<string | null>(null);

    const { speakMessage } = useCharacterVoice();

    // Primitive so effect deps match exactly what is read inside
    const interactionDataId = interactionData?.id ?? null;

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

    // --- Reset scroll tracking whenever the active chat changes ---
    // Declared BEFORE the scroll effect so the reset lands first
    // in the same commit (effects run in declaration order).
    useEffect(() => {
        if (interactionDataId !== previousChatIdRef.current) {
            previousChatIdRef.current = interactionDataId;
            hasScrolledToBottomRef.current = false;
        }
    }, [interactionDataId]);

    // --- Auto-scroll to bottom on initial chat load ---
    useEffect(() => {
        if (!interactionData || hasScrolledToBottomRef.current) return;
        if ((interactionData.interactionHistory?.length ?? 0) === 0) return;

        const frameId = requestAnimationFrame(() => {
            if (messageEndRef.current) {
                messageEndRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
                hasScrolledToBottomRef.current = true;
                isAtBottomRef.current = true;
            }
        });
        return () => cancelAnimationFrame(frameId);
    }, [interactionData, isAtBottomRef]);

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
        speakMessage(text, character)
    }, [speakMessage]);

    return {
        chatHistoryRef,
        messageEndRef,
        playVoice,
    };
}