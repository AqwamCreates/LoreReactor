// src/hooks/useChatUI.ts
import { useRef, useEffect, useCallback } from 'react';
import { getAudioEngine } from '../services/AudioEngine';
import { useCharacterVoice } from './useCharacterVoice';
import type { Character, InteractionData } from '../types';

export function useChatUI(
    interactionData: InteractionData | null, 
    isAtBottomRef: React.MutableRefObject<boolean>
) {
    const chatHistoryRef = useRef<HTMLDivElement>(null);
    const messageEndRef = useRef<HTMLDivElement>(null);
    const hasScrolledToBottomRef = useRef(false);
    const previousChatIdRef = useRef<string | null>(null);

    const { speakMessage } = useCharacterVoice();

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
        const profileVolume = interactionData.profile?.volume ?? -1;
        audioEngine.setGlobalVolume(profileVolume);
        audioEngine.evaluate(interactionData);
    }, [interactionData]);

    // --- Reset scroll tracking whenever the active chat changes ---
    useEffect(() => {
        if (interactionDataId !== previousChatIdRef.current) {
            previousChatIdRef.current = interactionDataId;
            hasScrolledToBottomRef.current = false;
        }
    }, [interactionDataId]);

    // --- Auto-scroll to bottom on initial chat load ---
    useEffect(() => {
        if (!interactionData || hasScrolledToBottomRef.current) return;
        
        // FIX: Replaced non-existent flat interactionHistory array with a reduction 
        // over the spatial interactionHistories Record to accurately count total messages.
        const messageCount = Object.values(interactionData.interactionHistories || {}).reduce((sum, msgs) => sum + msgs.length, 0);
        if (messageCount === 0) return;

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

    const playVoice = useCallback((text: string, character: Character) => {
        speakMessage(text, character);
    }, [speakMessage]);

    return {
        chatHistoryRef,
        messageEndRef,
        playVoice,
    };
}