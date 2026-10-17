// src/frontend_src/utilities/dataSchema.ts
import { defaultInputStrategy, defaultCharacterTools, defaultProfileTools, defaultNarrateTexts } from '../dictionaries/defaults';
import { emotions } from '../dictionaries/characterPresets';
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
    const includeEntityFolder = (selectedEntities as string[]).includes('EntityFolder') || (selectedEntities as string[]).includes('entityFolder');

    // Automatically generate tool schemas from defaults dictionaries
    const characterToolsSchema = Object.entries(defaultCharacterTools)
        .map(([toolName, defaultValue]) => `      "${toolName}": "boolean (default ${defaultValue})"`)
        .join(',\n');

    const profileToolsSchema = Object.keys(defaultProfileTools)
        .map(toolName => `      "${toolName}": "number (-1, 0, or 1, default 0)"`)
        .join(',\n');

    const narrateTextsSchema = Object.entries(defaultNarrateTexts)
        .map(([key, defaultValue]) => `      "${key}": "boolean (default ${defaultValue})"`)
        .join(',\n');

    const narrateTextCharacterIdsSchema = Object.keys(defaultNarrateTexts)
        .map(key => `      "${key}": "string (Character UUID, optional, assigns a specific character to narrate this text type)"`)
        .join(',\n');

    if (includeCharacter) {
        parts.push(`  "characters": [{
    "id": "string (UUID)",
    "name": "string (required)",
    "description": "string (display only, NOT used as AI input)",
    "aliases": ["string array of alternate names/aliases for this character. Used for name detection priority: [name, ...aliases]. Characters learn these via knownCharacterNames."],
    "images": {"expression name": "image filename string"},
    "useFrontCameraImage": "boolean (default false). When true and profile allows per-character control, replace stored image with live front camera snapshot.",
    "voice": "string (optional Voice ID or path)",
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
    "memoryPrompts": {${emotions.map(e => `"${e}": "string (memory content for '${e}' expression)"`).join(', ')}},
    "languageModelSampler": "object (Sampler, optional). Controls the psychological profile and text generation logic (temperature, top_p, etc.).",
    "textToSpeechModelSampler": "object (Sampler, optional). Controls the vocal cords, prosody, pitch, and acoustic expressiveness of the character's voice.",
    "stopPatterns": [{"id": "string (UUID)", "name": "string", "pattern": "string", "description": "string (optional)"}],
    "useEmbeddingModelForDialoguePrompts": "boolean (default false)",
    "useEmbeddingModelForStarterPrompts": "boolean (default false)",
    "useEmbeddingModelForKnowledgePrompts": "boolean (default false)",
    "useEmbeddingModelForMemories": boolean,
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
${characterToolsSchema}
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
    "knownCharacterNames": {"character UUID": ["string array of name/alias strings this character knows about that other character. Detected automatically during chat via name reveal patterns. Defines baseline persistent knowledge."]},
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
    "hasSkyView": "boolean (default true). If true, the sky view prompt and tool will be available to characters at this location.",
    "hasWeather": "boolean (default true). If true, the weather prompt and tool will be available to characters at this location.",
    "regularExpressionActivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "regularExpressionDeactivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "regularExpressionExclusionActivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "regularExpressionExclusionDeactivationTriggers": ${REGEX_TRIGGER_SCHEMA},
    "backgroundImageRegularExpressionActivationTriggers": {"image index (number)": "regex pattern to switch to this image based on user message"},
    "backgroundImageWeights": {"image index (number)": "sampling weight (number)"},
    "playAudioTrackOnEnterWeights": {"audio track UUID": "sampling weight (number), randomly plays an audio track when entering this location"},
    "locationBindings": ["string array of origin location UUIDs. Each entry declares: 'This location is accessible to characters FROM that origin location.' Empty array = accessible from anywhere."],
    "locationBindingRegularExpressionTriggers": {"origin location UUID": "regex pattern that must match the character's message for the path from that origin to this location to be open. Omit or leave empty for unconditional access from that origin."},
    "characterBindings": ["string array of character UUIDs. Only these characters can enter this location. Empty = all characters can enter."],
    "globalWeight": "number (≥0, default 1). Base likelihood for any character to enter this location.",
    "characterWeights": {"character UUID": "weight (number). Overrides globalWeight for specific characters."},
    "ownerBindings": ["string array of character UUIDs who own this location. Owners get exclusivity bonuses, faster stamina regen, reduced speech cost, and always feel at home."],
    "latitude": "number (-90 to 90, optional, real-world latitude for local weather and time)",
    "longitude": "number (-180 to 180, optional, real-world longitude for local weather and time)",
    "locationDistances": {"location UUID": "distance in km (number). Manual override for map tool. Empty = auto-calculated from coordinates."},
    "messageFilterNonCoLocatedParticipants": "boolean (default true). Hide messages from characters not currently at this location.",
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
    "enableAutoSpeechDetection": "boolean (default false)",
    "speechVolumeActivationThreshold": "number (1-100, default 18)",
    "speechSilenceVolumeActivationThreshold": "number (1-100, default 8)",
    "speechSilenceThresholdMs": "number (default 1400)",
    "voiceActivityProbabilityThreshold": "number (0.1-0.9, default 0.5)",
    "volume": "number (-1 to 1, default -1 means per-track default)",
    "forceNameReveal": "boolean (default false)",
    "enableAmbientNarration": "boolean (default false). When true and no character responds, generates environmental/atmospheric narration to fill silence.",
    "toolUsageDisplayMode": "'none' | 'icon' | 'simple' | 'detailed' | 'full' | 'raw' (default 'none'). Controls how tool invocations appear in chat output.",
    "toolUsageDisplayPlacementMode": "'top' | 'before paragraph' | 'before sentence' | 'inline' | 'after sentence' 'after paragraph' | 'bottom' (default 'before paragraph')",
    "enableCharacterExpression": "boolean (default false)",
    "randomizeTextCharacterInjection": "boolean (default false, master toggle for text character injection across all characters)",
    "randomizeTextCharacterInjectionOnRetry": "boolean (default true, only randomize if the initial generation fails. Only relevant when randomizeTextCharacterInjection is true)",
    "maximumNumberOfTextCharacterRandomizationPerModel": "number (≥1, default 1, number of retry attempts per model for text character randomization. Only relevant when randomizeTextCharacterInjection is true)",
    "forceNoCharacterImageInjection": "boolean (default false)",
    "forceNoContextImageInjection": "boolean (default false)",
    "forceNoLocationImageInjection": "boolean (default false)",
    "weatherApiKey": "string (OpenWeather API key, optional)",
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
    "cacheEfficiencyLevels": {
      "Character Name": "number (0-2, default 0). 0 = no optimization, names resolved dynamically. 1 = freeze names for co-located participants. 2 = freeze names for all participants.",
      "System Prompt": "number (0-2, default 0). 0 = only current character system prompt. 1 = inject co-located participants system prompts. 2 = inject all participants system prompts.",
      "Think Prompt": "number (0-2, default 0). 0 = only current character think prompt. 1 = inject co-located participants think prompts. 2 = inject all participants think prompts."
    },
    "minimalVolatileCacheMode": "boolean (default false). When true, volatile sections (date/time, weather, fatigue, inventory, tools, location) are forced to end of prompt regardless of input strategy ordering to maximize cache stability.",
    "doNotInjectDefaultStopTokens": "boolean (default false)",
    "enableSpeculativeMarkov": "boolean (default false). Uses a local Markov chain to predict and append highly confident tokens during streaming, reducing API output costs.",
    "sentimentalAnalysisDeviceType": "'auto' | 'cpu' | 'gpu' (default 'auto')",
    "textToSpeechDeviceType": "'auto' | 'cpu' | 'gpu' (default 'auto')",
    "speechToTextDeviceType": "'auto' | 'cpu' | 'gpu' (default 'auto')",
    "voiceActivityDetectionDeviceType": "'auto' | 'cpu' | 'gpu' (default 'auto')",
    "embeddingDeviceType": "'auto' | 'cpu' | 'gpu' (default 'auto')",
    "narrateTexts": {
${narrateTextsSchema}
    },
    "narrateTextCharacterIds": {
${narrateTextCharacterIdsSchema}
    },
    "stripThinkTokens": "boolean (default true)",
    "tools": {
${profileToolsSchema}
    },
    "inputStrategy": ["array of promptBlockType strings and/or custom prompt block UUIDs. Built-in types: ${defaultInputStrategy.join(', ')}. Custom prompt blocks are referenced by their UUID string."],
    "summarizationSteps": [{
      "strategyType": "'Sliding Window Replace' | 'Periodic Compression' | 'Recursive Summary' | 'Observation Masking' | 'Entropy Pruning'",
      "enabled": "boolean (default true)",
      "order": "number (default 0)",
      "slidingWindowSize": "number (optional)",
      "periodicCompressionInterval": "number (optional)",
      "periodicCompressionChunkSize": "number (optional)",
      "recursiveSummaryChunkSize": "number (optional)",
      "recursiveSummaryMaximumDepth": "number (optional)",
      "maskingRelevanceThreshold": "number (optional)",
      "maskingKeywordWeight": "number (optional)",
      "entropyPruningChunkSize": "number (optional, default 3). Messages per analysis unit for entropy pruning.",
      "entropyPruningThreshold": "number (optional, default 0.35). Below this entropy score = fluff (0.0-1.0).",
      "entropyPruningTokenBudget": "number (optional, default 2000). Max tokens to keep raw before summarizing.",
      "summaryTokenBudget": "number (optional)",
      "summaryModelId": "string (optional UUID)",
      "triggerTokenThreshold": "number (optional)"
    }],
    "summarizationInstruction": "string (optional, custom instruction for the summarization model)",
    "autoResumeSignals": [{
      "regularExpressionActivationTrigger": "string (optional regex)",
      "regularExpressionDeactivationTrigger": "string (optional regex)",
      "stopPattern": "string (appended to sampler stop patterns if activated)",
      "minimumLength": "string (default '0', minimum characters after activation before deactivation)",
      "maximumNumberOfAutoResumes": "number (default 10, 0 = disabled)"
    }],
    "characterLanguageModelSampler": "object (Sampler, optional). Controls text generation parameters for characters.",
    "characterTextToSpeechModelSampler": "object (Sampler, optional). Controls voice generation parameters for characters.",
    "webSummarizationSampler": "object (Sampler, optional)",
    "interactionDataSummarizationSampler": "object (Sampler, optional)",
    "aiRecommendationSampler": "object (Sampler, optional)",
    "characterStopPattern": "object (StopPattern, optional)",
    "webSummarizationStopPattern": "object (StopPattern, optional)",
    "interactionDataSummarizationStopPattern": "object (StopPattern, optional)",
    "aiRecommendationStopPattern": "object (StopPattern, optional)"
  }`);
    }

    if (includeEntityFolder) {
        parts.push(`  "entityFolders": [{
    "id": "string (UUID)",
    "name": "string (required, entity folder name)",
    "description": "string (display only, optional)",
    "entityType": "'character' | 'context' | 'location' | 'audioTrack' | 'world' | 'interactionData' | 'model' | 'sampler' | 'promptBlock' | 'stopPattern' | 'budgetStrategy' | 'profile' | 'account' | 'multiplayerData' (required, entity category for this entity folder)",
    "itemIds": ["string array of entity UUIDs belonging to this entity folder"]
  }]`);
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