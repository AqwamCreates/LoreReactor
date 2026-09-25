// src/hooks/useAmbientNarration.ts
import { useCallback } from 'react';
import type { Character, InteractionData, ChatMessage } from '../types';
import { createChatMessage, addMessageToInteractionData } from './chatLogic';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { getBudgetStrategyEngine } from '../services/BudgetStrategyEngine';
import { useSessionStore } from './useSessionStore';
import { getCoLocatedParticipants } from './locationLogic';
import { getUniversalMessageFilterFlags } from './promptLogic';
import { detectContext, composeFallbackSentence } from '../ambientNarration/composer';
import { AMBIENT_NARRATOR } from '../ambientNarration/narrator';

const engine = getLanguageModelEngine();

const AMBIENT_SYSTEM_PROMPT = "You are an ambient narration engine for a roleplay chat. Your ONLY job is to write a single short sentence (1-2 sentences max) describing the environment, atmosphere, or sensory details of the current moment. You must NOT write dialogue, character actions, thoughts, or advance the plot. You describe only the physical space, sounds, light, temperature, weather, and mood of the setting. Write in third person, present tense. Output ONLY the narration text with no preamble, no quotes, no markdown.";

export function useAmbientNarration(
    setStreamingState: (c: Character | null, text: string) => void,
    setStreamingText: (t: string) => void,
    streamingTextRef: React.MutableRefObject<string>,
) {
    const generateAmbientNarration = useCallback(async (data: InteractionData, signal: AbortSignal): Promise<InteractionData | null> => {
        // Determine message window size based on co-located participants.
        // Use the protagonist's current location as the reference point.
        const protagonist = data.protagonists?.[0];
        const coLocatedCount = protagonist ? getCoLocatedParticipants(data, protagonist).length : 0;
        const messageWindow = coLocatedCount + 1;

        // Get all chat messages
        const allChatMessages = data.interactionHistory.filter((m): m is ChatMessage => m.messageType === 'chat');

        // Apply universal message filter flags to exclude filtered messages
        const filterFlags = getUniversalMessageFilterFlags(
            allChatMessages,
            data.contexts || [],
            data.locations || [],
            [],
        );
        const visibleChatMessages = allChatMessages.filter((_, i) => !filterFlags[i]);

        // Filter out ambient narrator messages and slice to message window
        const recentMessages = visibleChatMessages
            .filter(m => m.character.id !== '__ambient_narrator__')
            .slice(-messageWindow);

        const recentText = recentMessages.map(m => m.textContent).join('\n');
        const { tags, dominantMood } = detectContext(recentText);

        const recentAmbient = visibleChatMessages
            .filter(m => m.character.id === '__ambient_narrator__')
            .slice(-5)
            .map(m => m.textContent);

        // Build context summary for the LLM
        const tagList = [...tags].slice(0, 10).join(', ');
        const userPrompt = `Recent conversation context:\n${recentText}\n\nDetected environmental cues: ${tagList || 'none'}\nDominant mood: ${dominantMood}\n\nWrite one ambient narration sentence for this moment. Do NOT repeat any of these previous narrations: ${recentAmbient.join(' | ')}`;

        let selected: string | null = null;

        const requestBody = {
            prompt: `${AMBIENT_SYSTEM_PROMPT}\n\n${userPrompt}`,
            n_predict: 128,
            temperature: 1,
            stop: ['\n\n', '\nUser:', '\nCharacter'],
        };

        // Try LLM generation — use budget strategy engine if active, otherwise direct
        try {
            const activeStrategy = useSessionStore.getState().activeStrategy;

            if (activeStrategy) {
                const bse = getBudgetStrategyEngine();
                const result = await bse.generateCompletion(requestBody, signal);
                if (result.text && result.text.trim().length > 0) {
                    const cleaned = result.text.trim().replace(/^["']|["']$/g, '');
                    const sentences = cleaned.match(/[^.!?]+[.!?]+/g);
                    selected = sentences ? sentences.slice(0, 2).join(' ').trim() : cleaned;
                }
            } else {
                const model = useSessionStore.getState().selectedModel;
                const runningModels = useSessionStore.getState().runningModels;

                if (model) {
                    engine.setRunningModels(runningModels);
                    engine.setContext(model);

                    const result = await engine.generateCompletion(requestBody);
                    if (result.text && result.text.trim().length > 0) {
                        const cleaned = result.text.trim().replace(/^["']|["']$/g, '');
                        const sentences = cleaned.match(/[^.!?]+[.!?]+/g);
                        selected = sentences ? sentences.slice(0, 2).join(' ').trim() : cleaned;
                    }
                }
            }
        } catch (e) {
            console.warn('LLM ambient narration failed, falling back to atomic composition:', e);
        }

        // Fallback to atomic composition if LLM failed or produced nothing
        if (!selected) selected = composeFallbackSentence(tags, dominantMood, recentAmbient);

        // Stream the result character by character
        setStreamingState(AMBIENT_NARRATOR, '');
        streamingTextRef.current = '';

        for (let i = 0; i < selected.length; i++) {
            if (signal.aborted) break;
            const p = selected.substring(0, i + 1);
            streamingTextRef.current = p;
            setStreamingText(p);
            await new Promise(r => setTimeout(r, 20));
        }

        const chatMessage = createChatMessage(data, AMBIENT_NARRATOR, selected)

        return addMessageToInteractionData(data, chatMessage);
    }, [setStreamingState, setStreamingText, streamingTextRef]);

    return { generateAmbientNarration, AMBIENT_NARRATOR };
}