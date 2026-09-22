// src/utilities/multiplayerSync.ts
import type { Character } from '../types';

/** Strip a Character down to only fields needed for multiplayer participation */
export function stripCharacterForSync(char: Character): Character {
    return {
        id: char.id,
        name: char.name,
        description: char.description,
        firstCreatedTimestamp: char.firstCreatedTimestamp,
        lastUpdatedTimestamp: char.lastUpdatedTimestamp,
        images: char.images,
        voice: char.voice,
        systemPrompt: char.systemPrompt,
        thinkPrompt: char.thinkPrompt,
        appearancePrompt: char.appearancePrompt,
        initiativeWeight: char.initiativeWeight,
        chatProbability: char.chatProbability,
        maximumChatStamina: char.maximumChatStamina,
        nameSensitivity: char.nameSensitivity,
        chatImpatienceSensitivity: char.chatImpatienceSensitivity,
        skipProbability: char.skipProbability,
        memoryRetentionWeight: char.memoryRetentionWeight,
        contextSensitivity: char.contextSensitivity,
        maximumActionStamina: char.maximumActionStamina,
        tools: char.tools,
        clothings: char.clothings,
        numberOfMessagesToDisableThinkPrompt: char.numberOfMessagesToDisableThinkPrompt,
        numberOfMessagesToDisableMetaThinkInstructions: char.numberOfMessagesToDisableMetaThinkInstructions,
        numberOfMessagesToDisableDialoguePrompt: char.numberOfMessagesToDisableDialoguePrompt,
        numberOfMessagesToDisableStarterPrompt: char.numberOfMessagesToDisableStarterPrompt,
        doNotInjectCharacterImage: char.doNotInjectCharacterImage,
        memories: {},
        dialoguePrompts: [],
        knowledgePrompts: [],
        starterPrompts: {},
        textCharacterInjections: [],
        sampler: undefined,
        stopPatterns: [],
    };
}