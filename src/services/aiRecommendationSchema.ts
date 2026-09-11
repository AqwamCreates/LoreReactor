// src/services/aiRecommendationSchema.ts
import { defaultInputStrategy } from '../defaults';
import type { EntityType } from './aiRecommendationTypes';

export function buildJsonSchema(selectedEntities: EntityType[]): string {
    const parts: string[] = [];
    const hasWorld = selectedEntities.includes('World');

    // Determine which sub-entity types to include
    const includeCharacter = selectedEntities.includes('Character');
    const includeContext = selectedEntities.includes('Context');
    const includeLocation = selectedEntities.includes('Location');
    const includeAudioTrack = selectedEntities.includes('AudioTrack');
    const includePromptBlock = selectedEntities.includes('PromptBlock');
    const includeProfile = selectedEntities.includes('Profile');

    if (includeCharacter) {
        parts.push(`  "characters": [{
    "id": "string (UUID)", "name": "string (required)", "description": "string (display only, NOT used as AI input)",
    "systemPrompt": "string", "thinkPrompt": "string",
    "appearancePrompt": "string", "dialoguePrompt": "string",
    "initiativeWeight": "number (0-10, default 5)", "chatProbability": "number (0-1, default 0.8)",
    "maximumChatStamina": "number (1-20, default 5)", "maximumActionStamina": "number (1-20, default 5)",
    "nameSensitivity": "number (0-1, default 0.3)",
    "chatImpatienceSensitivity": "number (0-1, default 0.2)", "skipProbability": "number (0-1, default 0.1)",
    "memoryRetentionWeight": "number (0-1, default 0.5)", "contextSensitivity": "number (0-1, default 0.5)",
    "doNotInjectCharacterImage": "boolean (default false)",
    "numberOfMessagesToDisableThinkPrompt": "number (default 1)",
    "numberOfMessagesToDisableMetaThinkInstructions": "number (default 1)",
    "numberOfMessagesToDisableDialoguePrompt": "number (default 1)",
    "tools": {"pick": "boolean (default true)", "date": "boolean (default false)", "coin": "boolean (default true)", "dice": "boolean (default true)", "random": "boolean (default true)", "rng": "boolean (default false)", "timer": "boolean (default false)", "stopwatch": "boolean (default false)", "calculator": "boolean (default false)", "web": "boolean (default false)", "lookup": "boolean (default false)", "map": "boolean (default false)", "audio": "boolean (default false)", "note": "boolean (default false)", "inventory": "boolean (default false)"},
    "enableMemoryWriting": "boolean (default false)", "enableMemoryReading": "boolean (default false)"
  }]`);
    }
    if (includeContext) {
        parts.push(`  "contexts": [{
    "id": "string (UUID)", "name": "string (required)", "description": "string (display only, NOT used as AI input)",
    "text": "string (required)",
    "searchTerms": ["string array"], "urls": ["string array"],
    "includeLinkImages": "boolean (default false)", "maximumLinkDepth": "number (default 1)",
    "linkFetchMode": "'full' | 'summary' | 'extract' (default 'summary')",
    "limitLinksToSubdirectory": "boolean (default false)", "fetchCacheTimeToLiveMs": "number",
    "regularExpressionActivationTrigger": "string (regex without delimiters)",
    "regularExpressionDeactivationTrigger": "string (regex without delimiters)",
    "regularExpressionContext": "'global' | 'local' | 'previous' (default 'global')",
    "regularExpressionTarget": "'everyone' | 'listener' | 'self' (default 'everyone')",
    "tokenBudget": "number (default 512)", "maximumRecursionDepth": "number (default 1)",
    "insertionDepth": "number (default 0)", "characterBindings": ["character name or ID strings"],
    "useBase64Encoding": "boolean (default false)"
  }]`);
    }
    if (includeLocation) {
        parts.push(`  "locations": [{
    "id": "string (UUID)", "name": "string (required)", "description": "string (display only, NOT used as AI input)",
    "text": "string (required)",
    "images": ["string array (image filenames for location visuals)"],
    "regularExpressionActivationTrigger": "string (regex without delimiters)",
    "backgroundImageRegularExpressionActivationTriggers": {"image index (number)": "regex pattern to switch to this image based on user message"},
    "backgroundImageWeights": {"image index (number)": "sampling weight (number)"},
    "locationBindings": ["location name or ID strings"],
    "locationBindingRegularExpressionTriggers": {"location name or ID": "regex pattern"},
    "characterBindings": ["character name or ID strings"],
    "globalWeight": "number (0-10, default 1)", "characterWeights": {"character name or ID": weight},
    "latitude": "number (-90 to 90, optional, real-world latitude for local weather and time)",
    "longitude": "number (-180 to 180, optional, real-world longitude for local weather and time)",
    "locationDistances": {"location name or ID": "distance in km (number)"},
    "useBase64Encoding": "boolean (default false)"
  }]`);
    }
    if (includeAudioTrack) {
        parts.push(`  "audioTracks": [{
    "id": "string (UUID)", "name": "string (required)", "description": "string (display only, NOT used as AI input)",
    "filename": "string (suggested filename, user will provide actual file)",
    "loop": "boolean (default true)", "volume": "number (0-1, default 1)",
    "startFadeDurationMs": "number (default 1000)", "endFadeDurationMs": "number (default 1000)",
    "audioCategory": "'ambient' | 'music' | 'sound effect' (default 'ambient')",
    "priority": "number (default 0)",
    "playableByParticipant": "boolean (default false)",
    "regularExpressionActivationTrigger": "string (regex without delimiters)",
    "regularExpressionDeactivationTrigger": "string (regex without delimiters)",
    "locationBindings": ["location name or ID strings"],
    "contextBindings": ["context name or ID strings"],
    "characterBindings": ["character name or ID strings"]
  }]`);
    }
    if (includePromptBlock) {
        parts.push(`  "promptBlocks": [{
    "id": "string (UUID)", "name": "string (required)", "description": "string (display only, NOT used as AI input)",
    "textContent": "string (required)",
    "images": ["string array (image filenames)"],
    "regularExpressionActivationTrigger": "string (regex without delimiters)",
    "regularExpressionDeactivationTrigger": "string (regex without delimiters)",
    "regularExpressionContext": "'global' | 'local' | 'previous' (default 'global')",
    "regularExpressionTarget": "'everyone' | 'listener' | 'self' (default 'everyone')",
    "characterBindings": ["character name or ID strings"],
    "contextBindings": ["context name or ID strings"],
    "locationBindings": ["location name or ID strings"]
  }]`);
    }
    if (includeProfile) {
        parts.push(`  "profile": {
    "id": "string (UUID)", "name": "string (required)", "description": "string (display only, NOT used as AI input)",
    "autonomousMode": "boolean (default false)",
    "autonomousInteractionIntervalMs": "number (1000-60000, default 10000)",
    "volume": "number (-1 to 1, default -1 means per-track default)",
    "forceNameReveal": "boolean (default false)", "enableCharacterExpression": "boolean (default false)",
    "forceNoCharacterImageInjection": "boolean (default false)", "forceNoContextImageInjection": "boolean (default false)",
    "forceNoLocationImageInjection": "boolean (default false)",
    "useCurrentDateAndTime": "boolean (default false)", "useWeather": "boolean (default false)",
    "weatherApiKey": "string (OpenWeather API key, required if useWeather is true)",
    "useTimeElapsed": "boolean (default false)",
    "numberOfMessagesToDisableThinkPrompt": "number (default 0)",
    "numberOfMessagesToDisableMetaThinkInstructions": "number (default 0)",
    "numberOfMessagesToDisableDialoguePrompt": "number (default 0)",
    "forceEqualInitiative": "boolean (default false)",
    "chatProbability": "number (0-1, default 0.8)", "maximumChatStamina": "number (default 4)",
    "maximumActionStamina": "number (1-20, default 5)",
    "nameSensitivity": "number (0-1, default 0.3)", "chatImpatienceSensitivity": "number (0-1, default 0.2)",
    "skipProbability": "number (0-1, default 0.1)", "memoryRetentionWeight": "number (0-1, default 0.5)",
    "contextSensitivity": "number (0-1, default 0.5)", "cacheInvalidationReductionLevel": "number (0-3, default 0)",
    "narrateNormalText": "boolean (default true)", "narrateQuotedText": "boolean (default false)",
    "narrateBoldedText": "boolean (default false)", "narrateItalicizedText": "boolean (default false)",
    "stripThinkTokens": "boolean (default true)",
    "tools": {"pick": "number (-1, 0, or 1, default 0)", "date": "number (-1, 0, or 1, default 0)", "coin": "number (-1, 0, or 1, default 0)", "dice": "number (-1, 0, or 1, default 0)", "random": "number (-1, 0, or 1, default 0)", "rng": "number (-1, 0, or 1, default 0)", "timer": "number (-1, 0, or 1, default 0)", "stopwatch": "number (-1, 0, or 1, default 0)", "calculator": "number (-1, 0, or 1, default 0)", "web": "number (-1, 0, or 1, default 0)", "lookup": "number (-1, 0, or 1, default 0)", "map": "number (-1, 0, or 1, default 0)", "audio": "number (-1, 0, or 1, default 0)", "note": "number (-1, 0, or 1, default 0)", "inventory": "number (-1, 0, or 1, default 0)"},
    "enableMemoryWriting": "number (-1, 0, or 1, default 0)", "enableMemoryReading": "number (-1, 0, or 1, default 0)",
    "inputStrategy": ["array of built-in block types and/or custom prompt block UUIDs. ${defaultInputStrategy.join(", ")}. Custom prompt blocks are referenced by their UUID string."],
    "summarizationSteps": [{"strategyType": "string", "enabled": true, "order": 0}]
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
    "name": "string (required)", "description": "string (display only, NOT used as AI input)",
    ${worldParts.join(',\n    ')}
  }`);
    }
    return `{\n${parts.join(',\n')}\n}`;
}