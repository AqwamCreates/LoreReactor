// src/frontend_src/hooks/useChatUI.ts

import { useRef, useEffect, useCallback } from 'react';
import { getAudioEngine } from '../services/AudioEngine';
import { useCharacterVoice } from './useCharacterVoice';
import { useGenerationStore } from './useGenerationStore';
import type { Character, InteractionData } from '../types';

export function useChatUI(
    interactionData: InteractionData | null,
    isAtBottomRef: React.RefObject<boolean>,
    allCharacters: Character[]
) {
    const chatHistoryRef = useRef<HTMLDivElement>(null);
    const messageEndRef = useRef<HTMLDivElement>(null);
    const previousChatIdRef = useRef<string | null>(null);
    const previousMessageCountRef = useRef<number>(0);

    const streamingText = useGenerationStore(s => s.streamingText);
    const { speakMessage } = useCharacterVoice(allCharacters);

    const scrollToBottom = useCallback(() => {
        const el = chatHistoryRef.current;
        if (el) {
            el.scrollTop = el.scrollHeight;
        } else if (messageEndRef.current) {
            messageEndRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
        }
        isAtBottomRef.current = true;
    }, [isAtBottomRef]);

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

    // --- Chat Switch, New Message Auto-Scroll & Scroll Listener ---
    useEffect(() => {
        if (!interactionData) {
            previousChatIdRef.current = null;
            previousMessageCountRef.current = 0;
            return;
        }

        const el = chatHistoryRef.current;
        const handleScroll = () => {
            if (!el) return;
            isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        };

        el?.addEventListener('scroll', handleScroll, { passive: true });

        const totalMessages = Object.values(interactionData.interactionHistories || {}).reduce(
            (sum, msgs) => sum + msgs.length,
            0
        );

        const isChatSwitched = interactionData.id !== previousChatIdRef.current;
        const isMessageAdded = totalMessages > previousMessageCountRef.current;

        previousChatIdRef.current = interactionData.id;
        previousMessageCountRef.current = totalMessages;

        let frameId: number | null = null;
        if ((isChatSwitched || isMessageAdded) && totalMessages > 0) {
            frameId = requestAnimationFrame(() => {
                scrollToBottom();
            });
        }

        return () => {
            el?.removeEventListener('scroll', handleScroll);
            if (frameId !== null) cancelAnimationFrame(frameId);
        };
    }, [interactionData, isAtBottomRef, scrollToBottom]);

    // --- Keep pinned to bottom while streaming tokens ---
    useEffect(() => {
        if (!streamingText || !isAtBottomRef.current) return;
        const frameId = requestAnimationFrame(() => {
            scrollToBottom();
        });
        return () => cancelAnimationFrame(frameId);
    }, [streamingText, isAtBottomRef, scrollToBottom]);

    const playVoice = useCallback((text: string, character: Character) => {
        speakMessage(text, character);
    }, [speakMessage]);

    return {
        chatHistoryRef,
        messageEndRef,
        playVoice,
    };
}
