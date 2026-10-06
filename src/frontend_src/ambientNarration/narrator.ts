// frontend_src/ambientNarration/narrator.ts
import type { Character } from '../types';

const now = Date.now();

export const AMBIENT_NARRATOR: Character = {
    id: '___ambient_narrator___', name: '', description: 'Ambient environment narration',
    systemPrompt: '', initiativeWeight: 0, chatProbability: 1, maximumChatStamina: 1,
    memories: {},
    numberOfMessagesToDisableThinkPrompt: 0,
    numberOfMessagesToDisableMetaThinkInstructions: 0,
    numberOfMessagesToDisableDialoguePrompt: 0,
    firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
} as Character;