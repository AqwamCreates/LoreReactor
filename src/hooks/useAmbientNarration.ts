// src/hooks/useAmbientNarration.ts
import { useCallback } from 'react';
import type { Character, InteractionData, ChatMessage } from '../types';
import { createChatMessage, addMessageToInteractionData } from './chatLogic';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { useSessionStore } from '../store/useSessionStore';
import { detectContext, composeFallbackSentence } from '../ambientNarration/composer';
import { AMBIENT_NARRATOR } from '../ambientNarration/narrator';

const languageModelEngine = getLanguageModelEngine();

const AMBIENT_SYSTEM_PROMPT = "You are an ambient narration engine for a roleplay chat. Your ONLY job is to write a single short sentence (1-2 sentences max) describing the environment, atmosphere, or sensory details of the current moment. You must NOT write dialogue, character actions, thoughts, or advance the plot. You describe only the physical space, sounds, light, temperature, weather, and mood of the setting. Write in third person, present tense. Output ONLY the narration text with no preamble, no quotes, no markdown.";

export function useAmbientNarration(
    setStreamingCharacter: (c: Character | null) => void,
    setStreamingText: (t: string) => void,
    streamingTextRef: React.MutableRefObject<string>,
) {
    const generateAmbientNarration = useCallback(async (data: InteractionData, signal: AbortSignal): Promise<InteractionData | null> => {
        const recentMessages = data.interactionHistory
            .filter(m => m.character.id !== '__ambient_narrator__')
            .filter((m): m is ChatMessage => m.kind === 'chat')
            .slice(-8);

        const recentText = recentMessages.map(m => m.textContent).join('\n');
        const { tags, dominantMood } = detectContext(recentText);

        const recentAmbient = data.interactionHistory
            .filter(m => m.character.id === '__ambient_narrator__')
            .filter((m): m is ChatMessage => m.kind === 'chat')
            .slice(-5)
            .map(m => m.textContent);

        // Build context summary for the LLM
        const tagList = [...tags].slice(0, 10).join(', ');
        const userPrompt = `Recent conversation context:\n${recentText.slice(-2000)}\n\nDetected environmental cues: ${tagList || 'none'}\nDominant mood: ${dominantMood}\n\nWrite one ambient narration sentence for this moment. Do NOT repeat any of these previous narrations: ${recentAmbient.join(' | ')}`;

        let selected: string | null = null;

        // Try LLM generation
        try {
            const model = useSessionStore.getState().selectedModel;
            const runningModels = useSessionStore.getState().runningModels;

            if (model) {
                const port = model.id ? runningModels[model.id]?.port : undefined;
                const runtimePort = port || (model.parameters as Record<string, unknown>)?._runtimePort;

                if (model.apiKey || runtimePort) {
                    const lmCtx: Record<string, unknown> = {
                        apiKey: model.apiKey,
                        backend: model.backend,
                        modelPath: model.model,
                        runtimePort,
                    };

                    const result = await languageModelEngine.generateCompletion(
                        {
                            prompt: `${AMBIENT_SYSTEM_PROMPT}\n\n${userPrompt}`,
                            n_predict: 128,
                            temperature: 0.9,
                            stop: ['\n\n', '\nUser:', '\nCharacter'],
                        },
                        lmCtx,
                    );

                    if (result.text && result.text.trim().length > 0) {
                        // Clean up: take first 1-2 sentences only
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
        if (!selected || selected.length < 5) {
            selected = composeFallbackSentence(tags, dominantMood, recentAmbient);
        }

        // Stream the result character by character
        setStreamingCharacter(AMBIENT_NARRATOR);
        setStreamingText('');
        streamingTextRef.current = '';

        for (let i = 0; i < selected.length; i++) {
            if (signal.aborted) break;
            const p = selected.substring(0, i + 1);
            streamingTextRef.current = p;
            setStreamingText(p);
            await new Promise(r => setTimeout(r, 20));
        }

        return addMessageToInteractionData(data, createChatMessage(data, AMBIENT_NARRATOR, selected));
    }, [setStreamingCharacter, setStreamingText, streamingTextRef]);

    return { generateAmbientNarration, AMBIENT_NARRATOR };
}