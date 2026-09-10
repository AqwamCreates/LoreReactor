// src/services/aiRecommendationSchema.ts
import type { EntityType } from './aiRecommendationTypes';

export function buildJsonSchema(selectedEntities: EntityType[]): string {
    const parts: string[] = [];
    const hasWorld = selectedEntities.includes('World');

    // Determine which sub-entity types to include
    const includeCharacter = selectedEntities.includes('Character');
    const includeContext = selectedEntities.includes('Context');
    const includeLocation = selectedEntities.includes('Location');
    const includeProfile = selectedEntities.includes('Profile');
    const includePromptBlock = selectedEntities.includes('PromptBlock');

    if (includeCharacter) {
        parts.push(`  "characters": [{
    "id": "string (UUID)", "name": "string (required)", "description": "string (display only, NOT used as AI input)",
    "systemPrompt": "string", "thinkPrompt": "string",
    "appearancePrompt": "string", "dialoguePrompt": "string",
    "initiativeWeight": "number (0-10, default 5)", "chatProbability": "number (0-1, default 0.8)",
    "maximumChatStamina": "number (1-20, default 5)", "nameSensitivity": "number (0-1, default 0.3)",
    "chatImpatienceSensitivity": "number (0-1, default 0.2)", "skipProbability": "number (0-1, default 0.1)",
    "memoryRetentionWeight": "number (0-1, default 0.5)", "contextSensitivity": "number (0-1, default 0.5)",
    "doNotInjectCharacterImage": "boolean (default false)",
    "numberOfMessagesToDisableThinkPrompt": "number (default 0)",
    "numberOfMessagesToDisableMetaThinkInstructions": "number (default 0)",
    "numberOfMessagesToDisableDialoguePrompt": "number (default 0)",
    "enableWebSearch": "boolean (default false)", "enableCalculator": "boolean (default false)",
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
    "locationDistances": {"location name or ID": "distance in km (number)"},
    "useBase64Encoding": "boolean (default false)"
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
    "characterBindings": ["character ID strings"],
    "contextBindings": ["context ID strings"],
    "locationBindings": ["location ID strings"]
  }]`);
    }
    if (includeProfile) {
        parts.push(`  "profile": {
    "id": "string (UUID)", "name": "string (required)", "description": "string (display only, NOT used as AI input)",
    "forceNameReveal": "boolean (default false)", "enableCharacterExpression": "boolean (default false)",
    "forceNoCharacterImageInjection": "boolean (default false)", "forceNoContextImageInjection": "boolean (default false)",
    "useCurrentDateAndTime": "boolean (default false)", "useWeather": "boolean (default false)",
    "useTimeElapsed": "boolean (default false)",
    "numberOfMessagesToDisableThinkPrompt": "number (default 0)",
    "numberOfMessagesToDisableMetaThinkInstructions": "number (default 0)",
    "numberOfMessagesToDisableDialoguePrompt": "number (default 0)",
    "forceEqualInitiative": "boolean (default false)",
    "chatProbability": "number (0-1, default 0.8)", "maximumChatStamina": "number (1-20, default 5)",
    "nameSensitivity": "number (0-1, default 0.3)", "chatImpatienceSensitivity": "number (0-1, default 0.2)",
    "skipProbability": "number (0-1, default 0.1)", "memoryRetentionWeight": "number (0-1, default 0.5)",
    "contextSensitivity": "number (0-1, default 0.5)", "cacheInvalidationReductionLevel": "number (0-3, default 0)",
    "narrateNormalText": "boolean (default true)", "narrateQuotedText": "boolean (default false)",
    "narrateBoldedText": "boolean (default false)", "narrateItalicizedText": "boolean (default false)",
    "stripThinkTokens": "boolean (default true)",
    "enableWebSearch": "number (0 or 1, default 0)", "enableCalculator": "number (0 or 1, default 0)",
    "enableMemoryWriting": "number (0 or 1, default 0)", "enableMemoryReading": "number (0 or 1, default 0)",
    "inputStrategy": ["PromptBlockType array"],
    "summarizationSteps": [{"strategyType": "string", "enabled": true, "order": 0}]
  }`);
    }
    if (hasWorld) {
        const worldParts: string[] = [];
        if (includeCharacter) worldParts.push('"characters": [/* same character schema */]');
        if (includeContext) worldParts.push('"contexts": [/* same context schema */]');
        if (includeLocation) worldParts.push('"locations": [/* same location schema */]');
        worldParts.push('"audioTracks": [{"id": "string (UUID)", "name": "string (required)", "filename": "string (required)", "description": "string", "loop": "boolean (default true)", "volume": "number (0-1, default 1)", "startFadeDurationMs": "number (default 1000)", "endFadeDurationMs": "number (default 1000)", "audioCategory": "\'ambient\' | \'music\' | \'sound effect\' (default \'ambient\')", "priority": "number (default 0)", "regularExpressionActivationTrigger": "string (regex)", "regularExpressionDeactivationTrigger": "string (regex)", "locationBindings": ["location name or ID strings"], "contextBindings": ["context name or ID strings"], "characterBindings": ["character name or ID strings"]}]');
        if (includePromptBlock) worldParts.push('"promptBlocks": [/* same promptBlock schema */]');
        if (includeProfile) worldParts.push('"profile": {/* same profile schema */}');
        parts.push(`  "world": {
    "name": "string (required)", "description": "string (display only, NOT used as AI input)",
    ${worldParts.join(',\n    ')}
  }`);
    }
    return `{\n${parts.join(',\n')}\n}`;
}