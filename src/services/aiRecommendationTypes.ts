// src/services/aiRecommendationTypes.ts
import type { Character, Context, Location, AudioTrack, Profile, PromptBlockType, SummarizationStrategyType } from '../types';

export type EntityType = 'Character' | 'Context' | 'Location' | 'Profile' | 'World';
export type ViewTab = 'raw' | 'Character' | 'Context' | 'Location' | 'Profile' | 'World';

export const IMAGE_PRIORITY_ITEMS = ['reference', 'character', 'context', 'location'] as const;
export type ImagePriorityItem = typeof IMAGE_PRIORITY_ITEMS[number];

export const IMAGE_LABELS: Record<ImagePriorityItem, string> = {
    reference: '📷 Reference Images',
    character: '🎭 Character Images',
    context: '📜 Context Images',
    location: '📍 Location Images',
};

export const IMAGE_SHORT_LABELS: Record<ImagePriorityItem, string> = {
    reference: '📷 Reference',
    character: '🎭 Character',
    context: '📜 Context',
    location: '📍 Location',
};

export const IMAGE_PROMPT_DESCRIPTIONS: Record<ImagePriorityItem, string> = {
    reference: 'Reference images (user-uploaded visual references)',
    character: 'Character portrait/appearance details',
    context: 'Context visual descriptions',
    location: 'Location scenery/atmosphere visuals',
};

export const ENTITY_OPTIONS: { type: EntityType; label: string; icon: string }[] = [
    { type: 'Character', label: 'Character', icon: '🎭' },
    { type: 'Context', label: 'Context', icon: '📜' },
    { type: 'Location', label: 'Location', icon: '📍' },
    { type: 'Profile', label: 'Profile', icon: '👤' },
    { type: 'World', label: 'World', icon: '🌍' },
];

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parsed AI output. Uses real entity types directly.
 * When World is selected alongside other entity types, those types
 * appear both at top level AND inside world.characters/contexts/etc.
 */
export interface GeneratedOutput {
    characters?: Character[];
    contexts?: Context[];
    locations?: Location[];
    audioTracks?: AudioTrack[];
    profile?: Profile;
    world?: {
        name: string;
        description?: string;
        characters: Character[];
        contexts: Context[];
        locations: Location[];
        audioTracks?: AudioTrack[];
        profile?: Profile;
    };
}

export interface JsonHistoryEntry {
    id: string;
    timestamp: number;
    jsonText: string;
    parsedOutput: GeneratedOutput;
    label: string;
    isEdited: boolean;
}