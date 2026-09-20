// src/services/dataSchema.ts
import { defaultInputStrategy } from '../dictionaries/defaults';
import type { EntityType } from './dataTypes';

const REGEX_TRIGGER_SCHEMA = `[{"trigger": "string (regex without delimiters)", "context": "'global' | 'local' | 'previous'", "target": "'everyone' | 'listener' | 'self' | 'protagonist' | 'narrator'"}]`;

export function buildJsonSchema(selectedEntities: EntityType[]): string {
    const parts: string[] = [];
    const hasWorld = selectedEntities.includes('World');

    const includeCharacter = selectedEntities.includes('Character');
    const includeContext = selectedEntities.includes('Context');
    const includeLocation = selectedEntities.includes('Location');
    const includeAudioTrack = selectedEntities.includes('AudioTrack');
    const includePromptBlock = selectedEntities.includes('PromptBlock');
    const includeProfile = selectedEntities.includes('Profile');

    if (includeCharacter) {
        parts.push(`  "characters": [{
    "id": "string (UUID)",
    "name": "string (required)",
    "description": "string (display only, NOT used as AI input)",
    "images": {"expression name": "image filename string"},
    "useFrontCameraImage": "boolean (default false). When true and profile allows per-character control, replace stored image with live front camera snapshot.",
    "voice": "string (optional voice ID or path)",
    "systemPrompt": "string",
    "thinkPrompt": "string",
    "appearancePrompt": "string",
    "dialoguePrompts": [{
      "id": "string (UUID)",
      "name": "string (required)",
      "description": "string (display only, describes this dialogue prompt)",
      "content": "string (the dialogue text content)",
      "dialoguePromptBindings": ["string array of DialoguePrompt UUIDs to chain to after this prompt"],
      "dialoguePromptWeight": "number (≥0, default 1). Weight for being selected as the starting dialogue prompt or as a chained next prompt. Higher = more likely to be picked.",
      "dialoguePromptBreakProbability": "number (0-1, default 0). Probability that the dialogue prompt chain breaks after this node. Higher = more likely to stop chaining.",
      "dialoguePromptSkipProbability": "number (0-1, default 0). Probability of skipping this dialogue prompt node entirely. 0 = always use. 1 = always skip.",
      "regularExpressionActivationTriggers": ${REGEX_TRIGGER_SCHEMA},
      "regularExpressionDeactivationTriggers": ${REGEX_TRIGGER_SCHEMA},
      "regularExpressionExclusionActivationTriggers": ${REGEX_TRIGGER_SCHEMA},
      "regularExpressionExclusionDeactivationTriggers": ${REGEX_TRIGGER_SCHEMA}
    }],
    "knowledgePrompts": [{
      "id": "string (UUID)",
      "name": "string (required)",
      "description": "string (display only, describes this knowledge prompt)",
      "content": "string (the knowledge/factual content)",
      "knowledgePromptBindings": ["string array of KnowledgePrompt UUIDs this links to"],
      "regularExpressionActivationTriggers": ${REGEX_TRIGGER_SCHEMA},
      "regularExpressionDeactivationTriggers": ${REGEX_TRIGGER_SCHEMA},
      "regularExpressionExclusionActivationTriggers": ${REGEX_TRIGGER_SCHEMA},
      "regularExpressionExclusionDeactivationTriggers": ${REGEX_TRIGGER_SCHEMA}
    }],
    "starterPrompts": {"starter text string": "weight number (≥0), higher = more likely to be sampled"},
    "initiativeWeight": "number (≥0, default 1.2)",
    "chatProbability": "number (0-1, default 0.5)",
    "maximumChatStamina": "number (≥0, default 4)",
    "maximumActionStamina": "number (≥0, default 5)",
    "nameSensitivity": "number (≥0, default 1)",
    "chatImpatienceSensitivity": "number (≥0, default 0)",
    "skipProbability": "number (0-1, default 0)",
    "memoryRetentionWeight": "number (≥0, default 1)",
    "contextSensitivity": "number (≥0, default 1)",
    "doNotInjectCharacterImage": "boolean (default false)",
    "numberOfMessagesToDisableThinkPrompt": "number (≥0, default 1)",
    "numberOfMessagesToDisableMetaThinkInstructions": "number (≥0, default 1)",
    "numberOfMessagesToDisableDialoguePrompt": "number (≥0, default 1)",
    "numberOfMessagesToDisableStarterPrompt": "number (≥0, default 1)",
    "tools": {
      "think": "boolean (default false)", "pick": "boolean (default true)", "date": "boolean (default false)", "coin": "boolean (default true)",
      "dice": "boolean (default true)", "random": "boolean (default true)", "rng": "boolean (default false)",
      "move": "boolean (default true)", "timer": "boolean (default false)", "stopwatch": "boolean (default false)",
      "calculator": "boolean (default false)", "web": "boolean (default false)", "dialogue": "boolean (default false)",
      "knowledge": "boolean (default false)", "memory": "boolean (default false)",
      "lookup": "boolean (default false)",
      "map": "boolean (default false)", "audio": "boolean (default false)", "note": "boolean (default false)",
      "inventory": "boolean (default false)", "invite": "boolean (default false)", "kick": "boolean (default false)",
      "teleport": "boolean (default false)", "key": "boolean (default false)", "clothing": "boolean (default false)",
      "summon": "boolean (default false)", "narrate": "boolean (default false)", "inspect": "boolean (default false)",
      "administrator": "boolean (default false)", "creator": "boolean (default false)", "destroyer": "boolean (default false)"
    },
    "clothings": [{
      "id": "string (UUID)",
      "name": "string (required)",
      "description": "string (visual description shown in appearance prompt when worn)",
      "initialWearingProbability": "number (0-1, default 1). Likelihood of being worn when character joins a session. 1 = always worn at start. 0 = never worn at start.",
      "regularExpressionActivationTriggers": ${REGEX_TRIGGER_SCHEMA},
      "regularExpressionDeactivationTriggers": ${REGEX_TRIGGER_SCHEMA},
      "clothingBindings": ["string array of clothing UUIDs this item covers/hides when worn"]
    }],
    "textCharacterInjections": [{
      "id": "string (UUID)",
      "name": "string (required)",
      "description": "string (display only, describes what this injection does)",
      "textCharacters": ["string array of text strings to randomly select from for prefix injection"],
      "textCharacterWeights": {"positional index (number)": "selection weight (number), higher = more likely to be picked"},
      "textCharacterInjectionBindings": ["string array of TextCharacterInjection UUIDs to chain to after this injection fires"],
      "textCharacterInjectionWeight": "number (≥0, default 1). Weight for being selected as the starting injection or as a chained next injection. Higher = more likely to be picked.",
      "textCharacterBreakProbability": "number (0-1, default 0). Probability that the injection chain breaks after generating this text. Higher = more likely to stop chaining.",
      "textCharacterSkipProbability": "number (0-1, default 0). Probability of skipping text generation for this injection and moving to the next binding. 0 = always generate. 1 = always skip."
    }]
  }]`);
    }

    if (includeContext) {
        parts.push(`  "contexts": [{
    "id": "string (UUID)",
    "name": "string (required)",
    "description": "string (display only, NOT used as AI input)",
    "text": "string",
    "images": ["string array (image filenames)"],
    "searchTerms": ["string array"],
    "searchEngine": "'Google' | 'Bing' | 'DuckDuckGo' | 'Yandex' | 'Baidu' (optional)",
    "urls": ["string array"],
    "includeLinkImages": "boolean (default false)",
    "maximumLinkDepth": "number (default 1)",
    "linkFetchMode": "'full' | 'summary' | 'extract' (default 'summary')",
    "limitLinksToSubdirectory": "boolean (default false)",
    "fetchCacheTimeToLiveMs": "number (optional)",
    "regularExpressionActivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "regularExpressionDeactivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "regularExpressionExclusionActivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "regularExpressionExclusionDeactivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "messageFilterRegularExpressionActivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "messageFilterRegularExpressionDeactivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "messageFilterRegularExpressionExclusionActivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "messageFilterRegularExpressionExclusionDeactivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "tokenBudget": "number (default 512)",
    "maximumRecursionDepth": "number (default 1)",
    "insertionDepth": "number (default 0)",
    "characterBindings": ["string array of character UUIDs"],
    "useBase64Encoding": "boolean (default false)",
    "isAutoGenerated": "boolean (optional)"
  }]`);
    }

    if (includeLocation) {
        parts.push(`  "locations": [{
    "id": "string (UUID)",
    "name": "string (required)",
    "description": "string (display only, NOT used as AI input)",
    "text": "string",
    "images": ["string array (image filenames for location visuals)"],
    "regularExpressionActivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "regularExpressionDeactivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "regularExpressionExclusionActivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "regularExpressionExclusionDeactivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "backgroundImageRegularExpressionActivationTriggers": {"image index (number)": "regex pattern to switch to this image based on user message"},
    "backgroundImageWeights": {"image index (number)": "sampling weight (number)"},
    "playAudioTrackOnEnterWeights": {"audio track UUID": "sampling weight (number), randomly plays an audio track when entering this location"},
    "locationBindings": ["string array of location UUIDs"],
    "locationBindingRegularExpressionTriggers": {"location UUID": "regex pattern"},
    "characterBindings": ["string array of character UUIDs"],
    "globalWeight": "number (≥0, default 1)",
    "characterWeights": {"character UUID": "weight (number)"},
    "ownerBindings": ["string array of character UUIDs"],
    "latitude": "number (-90 to 90, optional, real-world latitude for local weather and time)",
    "longitude": "number (-180 to 180, optional, real-world longitude for local weather and time)",
    "locationDistances": {"location UUID": "distance in km (number)"},
    "messageFilterNonCoLocatedParticipants": "boolean (default true, hide messages from characters not at this location)",
    "messageFilterRegularExpressionActivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "messageFilterRegularExpressionDeactivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "messageFilterRegularExpressionExclusionActivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "messageFilterRegularExpressionExclusionDeactivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "useBase64Encoding": "boolean (default false)"
  }]`);
    }

    if (includeAudioTrack) {
        parts.push(`  "audioTracks": [{
    "id": "string (UUID)",
    "name": "string (required)",
    "description": "string (display only, NOT used as AI input)",
    "filename": "string (suggested filename, user will provide actual file)",
    "loop": "boolean (default true)",
    "volume": "number (0-1, default 1)",
    "audioCategory": "'ambient' | 'music' | 'sound effect' (default 'ambient')",
    "playableByParticipants": "boolean (default false)",
    "startFadeDurationMs": "number (default 1000)",
    "endFadeDurationMs": "number (default 1000)",
    "regularExpressionActivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "regularExpressionDeactivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "regularExpressionExclusionActivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "regularExpressionExclusionDeactivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "locationBindings": ["string array of location UUIDs"],
    "contextBindings": ["string array of context UUIDs"],
    "characterBindings": ["string array of character UUIDs"],
    "priority": "number (default 0)"
  }]`);
    }

    if (includePromptBlock) {
        parts.push(`  "promptBlocks": [{
    "id": "string (UUID)",
    "name": "string (required)",
    "description": "string (display only, NOT used as AI input)",
    "textContent": "string (required)",
    "images": ["string array (image filenames)"],
    "regularExpressionActivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "regularExpressionDeactivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "regularExpressionExclusionActivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "regularExpressionExclusionDeactivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "messageFilterRegularExpressionActivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "messageFilterRegularExpressionDeactivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "messageFilterRegularExpressionExclusionActivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "messageFilterRegularExpressionExclusionDeactivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "characterBindings": ["string array of character UUIDs"],
    "contextBindings": ["string array of context UUIDs"],
    "locationBindings": ["string array of location UUIDs"]
  }]`);
    }

    if (includeProfile) {
        parts.push(`  "profile": {
    "id": "string (UUID)",
    "name": "string (required)",
    "description": "string (display only, NOT used as AI input)",
    "autonomousMode": "boolean (default false)",
    "autonomousInteractionIntervalMs": "number (1000-60000, default 10000)",
    "volume": "number (-1 to 1, default -1 means per-track default)",
    "forceNameReveal": "boolean (default false)",
    "toolUsageDisplayMode": "'none' | 'icon' | 'simple' | 'detailed' | 'full' | 'raw' (default 'none'). Controls how tool invocations appear in chat output.",
    "enableCharacterExpression": "boolean (default false)",
    "randomizeTextCharacterInjection": "boolean (default false, master toggle for text character injection across all characters)",
    "randomizeTextCharacterInjectionOnRetry": "boolean (default true, only randomize if the initial generation fails. Only relevant when randomizeTextCharacterInjection is true)",
    "maximumNumberOfTextCharacterRandomizationPerModel": "number (≥1, default 1, number of retry attempts per model for text character randomization. Only relevant when randomizeTextCharacterInjection is true)",
    "forceNoCharacterImageInjection": "boolean (default false)",
    "forceNoContextImageInjection": "boolean (default false)",
    "forceNoLocationImageInjection": "boolean (default false)",
    "useCurrentDateAndTime": "boolean (default false)",
    "useWeather": "boolean (default false)",
    "weatherApiKey": "string (OpenWeather API key, required if useWeather is true)",
    "useTimeElapsed": "boolean (default false)",
    "useFrontCameraImage": "number (-1, 0, or 1, default 0). -1 = force off for all characters. 0 = per-character setting. 1 = force on for all characters. Replaces protagonist stored image with live front camera snapshot. Camera activates on first use and auto-closes after 10 minutes idle.",
    "numberOfMessagesToDisableThinkPrompt": "number (-1 or ≥0, default -1 defers to character)",
    "numberOfMessagesToDisableMetaThinkInstructions": "number (-1 or ≥0, default -1 defers to character)",
    "numberOfMessagesToDisableDialoguePrompt": "number (-1 or ≥0, default -1 defers to character)",
    "numberOfMessagesToDisableStarterPrompt": "number (-1 or ≥0, default -1 defers to character)",
    "forceEqualInitiative": "boolean (default false)",
    "chatProbability": "number (-1 or 0-1, default -1 defers to character)",
    "maximumChatStamina": "number (-1 or ≥0, default -1 defers to character)",
    "maximumActionStamina": "number (-1 or ≥0, default -1 defers to character)",
    "nameSensitivity": "number (-1 or ≥0, default -1 defers to character)",
    "chatImpatienceSensitivity": "number (-1 or ≥0, default -1 defers to character)",
    "skipProbability": "number (-1 or 0-1, default -1 defers to character)",
    "memoryRetentionWeight": "number (-1 or ≥0, default -1 defers to character)",
    "contextSensitivity": "number (-1 or ≥0, default -1 defers to character)",
    "cacheInvalidationReductionLevel": "number (0-3, default 0)",
    "doNotInjectDefaultStopTokens": "boolean (default false)",
    "narrateTexts": {
      "normal": "boolean (default false)", "quoted": "boolean (default false)", "bolded": "boolean (default false)",
      "italicized": "boolean (default false)", "parenthesized": "boolean (default false)", "bracketed": "boolean (default false)",
      "braced": "boolean (default false)"
    },
    "stripThinkTokens": "boolean (default true)",
    "tools": {
      "think": "number (-1, 0, or 1, default 0)", "pick": "number (-1, 0, or 1, default 0)", "date": "number (-1, 0, or 1, default 0)", "coin": "number (-1, 0, or 1, default 0)",
      "dice": "number (-1, 0, or 1, default 0)", "random": "number (-1, 0, or 1, default 0)", "rng": "number (-1, 0, or 1, default 0)",
      "move": "number (-1, 0, or 1, default 0)", "timer": "number (-1, 0, or 1, default 0)", "stopwatch": "number (-1, 0, or 1, default 0)",
      "calculator": "number (-1, 0, or 1, default 0)", "web": "number (-1, 0, or 1, default 0)", "dialogue": "number (-1, 0, or 1, default 0)",
      "knowledge": "number (-1, 0, or 1, default 0)", "memory": "number (-1, 0, or 1, default 0)",
      "lookup": "number (-1, 0, or 1, default 0)",
      "map": "number (-1, 0, or 1, default 0)", "audio": "number (-1, 0, or 1, default 0)", "note": "number (-1, 0, or 1, default 0)",
      "inventory": "number (-1, 0, or 1, default 0)", "invite": "number (-1, 0, or 1, default 0)", "kick": "number (-1, 0, or 1, default 0)",
      "teleport": "number (-1, 0, or 1, default 0)", "key": "number (-1, 0, or 1, default 0)", "clothing": "number (-1, 0, or 1, default 0)",
      "summon": "number (-1, 0, or 1, default 0)", "narrate": "number (-1, 0, or 1, default 0)", "inspect": "number (-1, 0, or 1, default 0)",
      "administrator": "number (-1, 0, or 1, default 0)", "creator": "number (-1, 0, or 1, default 0)", "destroyer": "number (-1, 0, or 1, default 0)"
    },
    "inputStrategy": ["array of PromptBlockType strings and/or custom prompt block UUIDs. Built-in types: ${defaultInputStrategy.join(', ')}. Custom prompt blocks are referenced by their UUID string."],
    "summarizationSteps": [{
      "strategyType": "'Sliding Window Replace' | 'Periodic Compression' | 'Recursive Summary' | 'Observation Masking'",
      "enabled": "boolean (default true)",
      "order": "number (default 0)",
      "slidingWindowSize": "number (optional)",
      "compressionInterval": "number (optional)",
      "compressionChunkSize": "number (optional)",
      "recursiveChunkSize": "number (optional)",
      "recursiveMaxDepth": "number (optional)",
      "maskingRelevanceThreshold": "number (optional)",
      "maskingKeywordWeight": "number (optional)",
      "summaryTokenBudget": "number (optional)",
      "summaryModelId": "string (optional UUID)",
      "triggerTokenThreshold": "number (optional)"
    }]
  }`);
    }

    if (hasWorld) {
        const worldParts: string[] = [];
        if (includeCharacter) worldParts.push('"characters": [/* same character schema */]');
        if (includeContext) worldParts.push('"contexts": [/* same context schema */]');
        if (includeLocation) worldParts.push('"locations": [/* same location schema */]');
        if (includeAudioTrack) worldParts.push('"audioTracks": [/* same audioTrack schema */]');
        if (includePromptBlock) worldParts.push('"promptBlocks": [/* same promptBlock schema */]');
        if (includeProfile) worldParts.push('"profile": {/* same profile schema */}');
        parts.push(`  "world": {
    "name": "string (required)",
    "description": "string (display only, NOT used as AI input)",
    ${worldParts.join(',\n    ')}
  }`);
    }

    return `{\n${parts.join(',\n')}\n}`;
}