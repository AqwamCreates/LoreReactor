// src/hooks/useMemoryTrigger.ts
import { useCallback } from 'react';
import type { Character, InteractionData, Memory } from '../types';
import { saveRawCharacter } from '../storage/serverStorage';
import { getEffectiveEnableMemoryWriting } from './characterLogic';
import { generateCharacterMemory } from '../services/ChatMessageSummarizationEngine';
import { memoryWriteTrigger } from '../stringList';
import { v4 as uuidv4 } from 'uuid';
import { useSessionStore } from './useSessionStore';

export function useMemoryTrigger() {
    const processMemoryTrigger = useCallback(async (
        rawText: string,
        character: Character,
        data: InteractionData,
    ): Promise<void> => {
        const profile = data.Profile;

        const enableMemoryWriting = getEffectiveEnableMemoryWriting(character, profile);
        if (!enableMemoryWriting) return;

        const triggerIndex = rawText.indexOf(memoryWriteTrigger);
        if (triggerIndex === -1) return;

        const otherParticipants = data.participants.filter(p => p.id !== character.id);
        if (otherParticipants.length === 0) return;

        const model = useSessionStore.getState().selectedModel;
        if (!model) return;
        const modelId = model.id || '';
        const models = useSessionStore.getState().runningModels;
        const port = model?.id ? models[model.id]?.port : undefined;
        const ep = port || (model?.parameters as Record<string, string>)?._runtimePort;
        if (!ep && !model?.apiKey) return;

        const effectiveRetentionWeight = (() => {
            const profileValue = profile?.memoryRetentionWeight;
            if (profileValue === undefined || profileValue === -1) return character.memoryRetentionWeight ?? 1;
            return profileValue;
        })();

        const ts = Date.now();

        for (const other of otherParticipants) {
            const allRelevant = data.interactionHistory.filter(
                m => m.character.id === character.id || m.character.id === other.id
            );

            let relevantMessages: typeof allRelevant;
            if (effectiveRetentionWeight <= 0) {
                relevantMessages = allRelevant.slice(-2);
            } else if (effectiveRetentionWeight < 1) {
                const count = Math.max(2, Math.round(allRelevant.length * effectiveRetentionWeight));
                relevantMessages = allRelevant.slice(-count);
            } else {
                relevantMessages = allRelevant;
            }

            if (relevantMessages.length === 0) continue;

            const summaryContext = await generateCharacterMemory(data, character, modelId, 512);
            if (!summaryContext || !summaryContext.text) continue;

            const newMemory: Memory = {
                id: uuidv4(),
                name: `Memory with ${other.name}`,
                content: summaryContext.text,
                interactionData: data,
                firstCreatedTimestamp: ts,
                lastUpdatedTimestamp: ts,
            };

            if (!character.memories) character.memories = {};
            character.memories[other.id] = [newMemory];
        }

        const globalSummaryContext = await generateCharacterMemory(data, character, modelId, 512);
        if (globalSummaryContext?.text) {
            const globalMemory: Memory = {
                id: uuidv4(),
                name: 'Global Memory',
                content: globalSummaryContext.text,
                interactionData: data,
                firstCreatedTimestamp: ts,
                lastUpdatedTimestamp: ts,
            };
            if (!character.memories) character.memories = {};
            character.memories.global = [globalMemory];
        }

        try { await saveRawCharacter(character); } catch (e) { console.warn('Failed to save character memories:', e); }
    }, []);

    return { processMemoryTrigger };
}