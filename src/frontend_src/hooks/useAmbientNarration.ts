// src/frontend_src/hooks/useAmbientNarration.ts
import { useCallback } from 'react';
import type { Character, InteractionData, ChatMessage, NarrationMessage, PromptBlock, HistoryMessage, TextMessage } from '../types';
import { addMessageToInteractionData } from '../utilities/interactionDataLogic';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { getBudgetStrategyEngine } from '../services/BudgetStrategyEngine';
import { useChatStore } from './useChatStore';
import { getCoLocatedParticipants, getCurrentLocationId } from '../utilities/locationLogic';
import { getUniversalMessageFilterFlags } from '../utilities/promptLogic';
import { getGlobalMessageHistory } from '../utilities/timelineLogic';
import { detectContext, composeFallbackSentence } from '../ambientNarration/composer';

const engine = getLanguageModelEngine();

const AMBIENT_SYSTEM_PROMPT = "You are an ambient narration engine for a roleplay chat. Your ONLY job is to write a single short sentence (1-2 sentences max) describing the environment, atmosphere, or sensory details of the current moment. You must NOT write dialogue, character actions, thoughts, or advance the plot. You describe only the physical space, sounds, light, temperature, weather, and mood of the setting. Write in third person, present tense. Output ONLY the narration text with no preamble, no quotes, no markdown.";

export function useAmbientNarration(
    setStreamingState: (c: Character | null, text: string) => void,
    setStreamingText: (t: string) => void,
    streamingTextRef: React.RefObject<string>,
) {
    const generateAmbientNarration = useCallback(async (
        data: InteractionData, 
        signal: AbortSignal,
        promptBlocks: PromptBlock[],
        localProtagonistId?: string | null
    ): Promise<InteractionData | null> => {
        const protagonistId = localProtagonistId ?? data.protagonistIds?.[0];
        const protagonistStub = protagonistId ? { id: protagonistId } as Character : null;

        const coLocatedCount = protagonistStub ? getCoLocatedParticipants(data, protagonistStub).length : 0;
        const messageWindow = coLocatedCount + 1;

        const allRelevantMessages = getGlobalMessageHistory(data, ['chat', 'narration']) as HistoryMessage[];

        const filterFlags = getUniversalMessageFilterFlags(
            allRelevantMessages as TextMessage[],
            promptBlocks,
            data.contexts || [],
            data.locations || [],
        );
        
        const visibleMessages = allRelevantMessages.filter((_, i) => !filterFlags[i]);

        const recentChatMessages = visibleMessages
            .filter(m => m.messageType === 'chat')
            .slice(-messageWindow) as ChatMessage[];

        const recentText = recentChatMessages.map(m => m.textContent).join('\n');
        const { tags, dominantMood } = detectContext(recentText);

        const recentAmbient = visibleMessages
            .filter(m => m.messageType === 'narration')
            .slice(-5)
            .map(m => m.textContent);

        const tagList = [...tags].slice(0, 10).join(', ');
        const userPrompt = `Recent conversation context:\n${recentText}\n\nDetected environmental cues: ${tagList || 'none'}\nDominant mood: ${dominantMood}\n\nWrite one ambient narration sentence for this moment. Do NOT repeat any of these previous narrations: ${recentAmbient.join(' | ')}`;

        let selected: string | null = null;

        const requestBody = {
            prompt: `${AMBIENT_SYSTEM_PROMPT}\n\n${userPrompt}`,
            n_predict: 128,
            temperature: 1,
            stop: ['\n\n', '\nUser:', '\nCharacter'],
        };

        try {
            const activeStrategy = useChatStore.getState().activeStrategy;

            if (activeStrategy) {
                const bse = getBudgetStrategyEngine();
                const result = await bse.generateCompletion(requestBody, signal);
                if (result.text && result.text.length > 0) {
                    const cleaned = result.text.replace(/^["']|["']$/g, '');
                    const sentences = cleaned.match(/[^.!?]+[.!?]+/g);
                    selected = sentences ? sentences.slice(0, 2).join(' ') : cleaned;
                }
            } else {
                const model = useChatStore.getState().selectedModel;
                const runningModels = useChatStore.getState().runningModels;

                if (model) {
                    engine.setRunningModels(runningModels);
                    engine.setContext(model);

                    const result = await engine.generateCompletion(requestBody);
                    if (result.text && result.text.length > 0) {
                        const cleaned = result.text.replace(/^["']|["']$/g, '');
                        const sentences = cleaned.match(/[^.!?]+[.!?]+/g);
                        selected = sentences ? sentences.slice(0, 2).join(' ') : cleaned;
                    }
                }
            }
        } catch (e) {
            console.warn('LLM ambient narration failed, falling back to atomic composition:', e);
        }

        if (!selected) selected = composeFallbackSentence(tags, dominantMood, recentAmbient);

        setStreamingState(null, '');
        streamingTextRef.current = '';

        for (let i = 0; i < selected.length; i++) {
            if (signal.aborted) break;
            const p = selected.substring(0, i + 1);
            streamingTextRef.current = p;
            setStreamingText(p);
            await new Promise(r => setTimeout(r, 20));
        }

        const narrationMessage: NarrationMessage = {
            id: `nar-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
            messageType: 'narration',
            textContent: selected,
            character: null as unknown as Character, 
            firstCreatedTimestamp: Date.now(),
            lastUpdatedTimestamp: Date.now(),
            characterClothingWearingStatuses: {},
            characterLockedLocations: {},
        };
        
        const currentLocId = protagonistStub ? getCurrentLocationId(data, protagonistStub) : 'global';
        
        return addMessageToInteractionData(data, narrationMessage, currentLocId || 'global');
    }, [setStreamingState, setStreamingText, streamingTextRef]);

    return { generateAmbientNarration };
}