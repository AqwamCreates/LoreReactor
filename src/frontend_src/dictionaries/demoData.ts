// src/frontend_src/dictionaries/demoData.ts

import { v4 as uuidv4 } from 'uuid';
import type {
  Character,
  Context,
  Location,
  AudioTrack,
  World,
  PromptBlock,
  InteractionData,
  LanguageModel,
  SpatiotemporalModel,
  TokenSampler,
  StopPattern,
  RetrievalConfiguration,
  BudgetStrategy,
  Profile,
  EntityFolder,
  SummarizationStep,
} from '../types';
import {
  defaultCharacter,
  defaultCharacterTools,
  defaultInputStrategy,
  defaultNarrateTexts,
  defaultProfileTools,
  defaultEntityImageTypes,
  defaultMemorySearchSpace,
} from './defaults';

export interface DemoDataBundle {
  characters: Character[];
  contexts: Context[];
  locations: Location[];
  audioTracks: AudioTrack[];
  worlds: World[];
  promptBlocks: PromptBlock[];
  interactionData: InteractionData[];
  languageModels: LanguageModel[];
  spatiotemporalModels: SpatiotemporalModel[];
  tokenSamplers: TokenSampler[];
  stopPatterns: StopPattern[];
  retrievalConfigurations: RetrievalConfiguration[];
  budgetStrategies: BudgetStrategy[];
  profiles: Profile[];
  entityFolders: EntityFolder[];
}

const TEMP_NOTICE = '[Temporary preset unless edited]';

export function createDemoData(): DemoDataBundle {
  const now = Date.now();

  // ─── 1. StopPattern ('stopPattern') ─────────────────────────────────────────
  const stopPatternUserTurn: StopPattern = {
    id: uuidv4(),
    name: 'User Turn Boundary',
    description: `${TEMP_NOTICE} Prevents the model from generating responses on behalf of the user.`,
    pattern: '\\nUser:',
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
  };

  // ─── 2. RetrievalConfiguration ('retrievalConfiguration') ──────────────────
  const hybridRetrievalConfig: RetrievalConfiguration = {
    id: uuidv4(),
    name: 'Standard Hybrid RAG',
    description: `${TEMP_NOTICE} Balanced dense and sparse retrieval for technical documentation and session memory.`,
    retrievalStrategy: 'hybrid',
    topK: 4,
    similarityThreshold: 0.65,
    tokenBudget: 1024,
    sortOrderFromTop: 'highest',
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
  };

  // ─── 3. TokenSampler ('tokenSampler') ───────────────────────────────────────
  const balancedSampler: TokenSampler = {
    id: uuidv4(),
    name: 'Balanced Technical Sampler',
    description: `${TEMP_NOTICE} Low-variance sampling configuration suitable for structured explanations and assistant guidance.`,
    parameters: {
      temperature: 0.65,
      top_p: 0.9,
      top_k: 40,
      repeat_penalty: 1.1,
      frequency_penalty: 0.0,
      presence_penalty: 0.0,
    },
    stopPatterns: [stopPatternUserTurn],
    maximumNumberOfTokens: 768,
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
  };

  // ─── 4. LanguageModel ('languageModel') & SpatiotemporalModel ('spatiotemporalModel') ───
  const geminiFlashModel: LanguageModel = {
    id: uuidv4(),
    name: 'Gemini 2.5 Flash (Google Cloud API)',
    description: `${TEMP_NOTICE} Enter your Google AI Studio API key and save to persist your configuration.`,
    backend: 'Google',
    model: 'gemini-2.5-flash',
    contextLength: 32768,
    apiKey: '',
    parameters: { temperature: 0.7 },
    cacheHitCostPerOneMillionOfTokens: 0.0375,
    cacheMissCostPerOneMillionOfTokens: 0.15,
    outputGenerationCostPerOneMillionOfTokens: 0.60,
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
  };

  const openRouterModel: LanguageModel = {
    id: uuidv4(),
    name: 'OpenRouter Free Tier (Cloud API)',
    description: `${TEMP_NOTICE} Add an OpenRouter API key and save to select and persist alternative models.`,
    backend: 'OpenRouter',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    contextLength: 16384,
    apiKey: '',
    parameters: { temperature: 0.7 },
    cacheHitCostPerOneMillionOfTokens: 0,
    cacheMissCostPerOneMillionOfTokens: 0,
    outputGenerationCostPerOneMillionOfTokens: 0,
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
  };

  const cloudImageModel: SpatiotemporalModel = {
    id: uuidv4(),
    name: 'Google Imagen / Cloud Diffusion API',
    description: `${TEMP_NOTICE} Cloud-based image generation preset for browser sessions.`,
    backend: 'Google',
    model: 'imagen-3.0-generate-002',
    apiKey: '',
    defaults: {
      steps: 20,
      cfgScale: 7.0,
      width: 512,
      height: 512,
    },
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
  };

  // ─── 5. BudgetStrategy ('budgetStrategy') ───────────────────────────────────
  const demoBudgetStrategy: BudgetStrategy = {
    id: uuidv4(),
    name: 'Cloud API Cost & Latency Tiering',
    description: `${TEMP_NOTICE} Routes requests across configured cloud API models based on context size and token budget.`,
    modelIds: [geminiFlashModel.id, openRouterModel.id],
    modelCostTiers: { [geminiFlashModel.id]: 1, [openRouterModel.id]: 0 },
    modelLatencyMsPerTokenTiers: { [geminiFlashModel.id]: 12, [openRouterModel.id]: 25 },
    modelTimeToFirstTokenTiers: { [geminiFlashModel.id]: 250, [openRouterModel.id]: 450 },
    modelQualityTiers: { [geminiFlashModel.id]: 9, [openRouterModel.id]: 8 },
    modelActivationContextSize: { [geminiFlashModel.id]: 0, [openRouterModel.id]: 0 },
    modelDeactivationContextSize: { [geminiFlashModel.id]: 32768, [openRouterModel.id]: 16384 },
    maximumBudget: 5.0,
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
  };

  // ─── 6. Profile ('profile') ─────────────────────────────────────────────────
  const demoSummarizationSteps: SummarizationStep[] = [
    {
      id: uuidv4(),
      name: 'Sliding Window Replace',
      description: `${TEMP_NOTICE} Summarizes older turns outside the active window limits.`,
      strategyType: 'Sliding Window Replace',
      enabled: true,
      order: 0,
      slidingWindowSize: 12,
      summaryTokenBudget: 256,
      triggerTokenThreshold: 4096,
      firstCreatedTimestamp: now,
      lastUpdatedTimestamp: now,
    },
    {
      id: uuidv4(),
      name: 'Entropy Pruning',
      description: `${TEMP_NOTICE} Prunes low-information message chunks when token threshold is exceeded.`,
      strategyType: 'Entropy Pruning',
      enabled: false,
      order: 1,
      entropyPruningChunkSize: 3,
      entropyPruningThreshold: 0.35,
      entropyPruningTokenBudget: 2000,
      triggerTokenThreshold: 6144,
      firstCreatedTimestamp: now,
      lastUpdatedTimestamp: now,
    },
  ];

  const demoProfile: Profile = {
    id: uuidv4(),
    name: 'Standard Workspace Profile',
    description: `${TEMP_NOTICE} Default orchestration profile with hybrid retrieval and co-located participant scope.`,
    autonomousMode: false,
    autonomousInteractionIntervalMs: 2000,
    volume: 1,
    forceNameReveal: true,
    enableAmbientNarration: false,
    toolUsageDisplayMode: 'detailed',
    toolUsageDisplayPlacementMode: 'before sentence',
    enableCharacterExpression: true,
    enableAutoSpeechDetection: false,
    speechVolumeActivationThreshold: 18,
    speechSilenceVolumeActivationThreshold: 8,
    speechSilenceThresholdMs: 1400,
    voiceActivityProbabilityThreshold: 0.5,
    randomizeTextCharacterInjection: false,
    randomizeTextCharacterInjectionOnRetry: true,
    maximumNumberOfTextCharacterRandomizationPerModel: 1,
    useFrontCameraImage: -1,
    numberOfMessagesToDisableThinkPrompt: -1,
    numberOfMessagesToDisableMetaThinkInstructions: -1,
    numberOfMessagesToDisableDialoguePrompt: -1,
    numberOfMessagesToDisableStarterPrompt: 1,
    forceEqualInitiative: false,
    chatProbability: -1,
    maximumChatStamina: -1,
    chatStaminaRegenerationRate: -1,
    nameSensitivity: -1,
    chatImpatienceSensitivity: -1,
    skipProbability: -1,
    memoryRetentionWeight: -1,
    contextSensitivity: -1,
    maximumActionStamina: -1,
    actionStaminaRegenerationRate: -1,
    participantScopeModes: {
      'Character Name': 'coLocated',
      'System Prompt': 'coLocated',
      'Think Prompt': 'coLocated',
    },
    participantInsertionModes: {
      'Character Name': 'dynamic',
      'System Prompt': 'dynamic',
      'Think Prompt': 'dynamic',
    },
    participantsKnownNamesLimits: {
      'Character Name': -1,
      'System Prompt': -1,
      'Think Prompt': -1,
    },
    minimalVolatileCacheMode: false,
    doNotInjectDefaultStopTokens: false,
    textGenerationBehaviourOnNarration: 'wait',
    narrateTexts: { ...defaultNarrateTexts },
    narrateTextCharacterIds: {
      normal: '', quote: '', bold: '', italic: '', underline: '',
      parenthesis: '', bracket: '', brace: '', strikethrough: '',
      inline_code: '', code_block: '', think_block: '',
    },
    tools: { ...defaultProfileTools },
    inputStrategy: [...defaultInputStrategy],
    promptFormatMode: 'chat',
    entityImageTypes: [...defaultEntityImageTypes],
    summarizationSteps: demoSummarizationSteps,
    summarizationInstruction: 'Summarize key technical decisions and current session context concisely.',
    enableSpeculativeMarkov: false,
    sentimentalAnalysisDeviceType: 'auto',
    textToSpeechDeviceType: 'auto',
    speechToTextDeviceType: 'auto',
    voiceActivityDetectionDeviceType: 'auto',
    embeddingDeviceType: 'auto',
    autoResumeSignals: [],
    characterLanguageModelTokenSampler: balancedSampler,
    characterDialogueRetrievalConfiguration: hybridRetrievalConfig,
    characterKnowledgeRetrievalConfiguration: hybridRetrievalConfig,
    characterMemoryRetrievalConfiguration: hybridRetrievalConfig,
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
  };

  // ─── 7. Character ('character') ─────────────────────────────────────────────
  // userCharacter is defined and returned FIRST so it is always loaded first and set as Protagonist
  const userCharacterId = uuidv4();
  const guideCharacterId = uuidv4();

  const dpToneId = uuidv4();
  const dpFollowUpId = uuidv4();
  const kpStorageId = uuidv4();
  const kpPipelineId = uuidv4();
  const clothingBlazerId = uuidv4();
  const clothingShirtId = uuidv4();

  const userCharacter: Character = {
    ...defaultCharacter,
    id: userCharacterId,
    name: 'User',
    aliases: ['Evaluator', 'Developer'],
    description: `${TEMP_NOTICE} Workspace user evaluating the LoreReactor interface and multi-agent orchestration engine.`,
    appearancePrompt: 'Standard professional office attire.',
    knownCharacterNames: {
      [guideCharacterId]: ['LoreReactor Guide', 'Guide'],
    },
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
  };

  const guideCharacter: Character = {
    ...defaultCharacter,
    id: guideCharacterId,
    name: 'LoreReactor Guide',
    aliases: ['Guide', 'System Assistant'],
    description: `${TEMP_NOTICE} Interactive technical onboarding assistant configured to explain LoreReactor’s architecture, RAG pipelines, spatial locations, and prompt compilation.`,
    systemPrompt:
      'You are the LoreReactor Guide, a concise and professional technical assistant. Help the user explore the application’s features, including multi-agent turn scheduling, spatial location graphs, RAG retrieval configurations, and context budget management. Provide clear, direct answers.',
    thinkPrompt:
      'Identify which subsystem the user is asking about (e.g., Retrieval, Locations, Token Samplers, or Prompt Blocks) and reference the relevant technical details concisely.',
    appearancePrompt: 'Clean, modern corporate avatar wearing a tailored navy blazer and smart glasses.',
    initiativeWeight: 1.0,
    chatProbability: 0.9,
    languageModelTokenSampler: balancedSampler,
    dialogueRetrievalConfiguration: hybridRetrievalConfig,
    knowledgeRetrievalConfiguration: hybridRetrievalConfig,
    memoryRetrievalConfiguration: hybridRetrievalConfig,
    useEmbeddingModelForDialoguePrompts: false,
    useEmbeddingModelForKnowledgePrompts: false,
    useEmbeddingModelForMemories: false,
    memorySearchSpaces: [...defaultMemorySearchSpace],
    tools: {
      ...defaultCharacterTools,
      think: true,
      clock: true,
      calendar: true,
      calculator: true,
      memory: true,
      knowledge: true,
      move: true,
    },
    clothings: [
      {
        id: clothingBlazerId,
        name: 'Tailored Navy Blazer',
        description: `${TEMP_NOTICE} Outer layer that occludes the shirt underneath when worn.`,
        initialWearingProbability: 1,
        clothingBindings: [clothingShirtId],
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
      },
      {
        id: clothingShirtId,
        name: 'Button-Down Oxford Shirt',
        description: `${TEMP_NOTICE} Base layer office attire.`,
        initialWearingProbability: 1,
        clothingBindings: [],
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
      },
    ],
    starterPrompts: [
      {
        id: uuidv4(),
        name: 'Default Onboarding Greeting',
        description: `${TEMP_NOTICE} Initial greeting node.`,
        textContent:
          'Welcome to LoreReactor. You can inspect the active prompt pipeline, test multi-location state routing, or configure cloud API backends from the top toolbar. Which subsystem would you like to explore first?',
        weight: 1,
        skipProbability: 0,
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
      },
    ],
    dialoguePrompts: [
      {
        id: dpToneId,
        name: 'Concise Technical Tone',
        description: `${TEMP_NOTICE} Primary dialogue style rule.`,
        textContent: 'Keep explanations structured and practical. Reference specific UI controls when explaining features.',
        dialoguePromptBindings: [dpFollowUpId],
        weight: 1,
        breakProbability: 0.1,
        skipProbability: 0,
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
      },
      {
        id: dpFollowUpId,
        name: 'Architecture Context Follow-Up',
        description: `${TEMP_NOTICE} Chained follow-up dialogue node.`,
        textContent: 'When discussing model inference or RAG, mention how token budgets and context compression steps keep latency low.',
        dialoguePromptBindings: [],
        weight: 0.9,
        breakProbability: 0,
        skipProbability: 0,
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
      },
    ],
    knowledgePrompts: [
      {
        id: kpStorageId,
        name: 'Browser & IndexedDB Persistence Architecture',
        description: `${TEMP_NOTICE} Triggered when asking about storage or saving.`,
        textContent:
          'In static web deployments such as GitHub Pages, LoreReactor holds demo presets in memory until edited, and automatically persists any modified or newly created entities directly in the browser via IndexedDB.',
        knowledgePromptBindings: [kpPipelineId],
        regularExpressionActivationTriggers: [
          { trigger: 'storage|database|indexeddb|save|persistence', context: 'local', target: 'everyone' },
        ],
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
      },
      {
        id: kpPipelineId,
        name: 'Client-Side ML & Retrieval Pipeline',
        description: `${TEMP_NOTICE} Linked knowledge node on client-side ML.`,
        textContent:
          'Embeddings, sentiment analysis, speculative Markov prediction, and factorization machines run client-side in the browser via ONNX Runtime Web and Transformers.js, supporting dense, sparse, hybrid, and MMR retrieval strategies.',
        knowledgePromptBindings: [],
        regularExpressionActivationTriggers: [
          { trigger: 'rag|retrieval|embedding|onnx|ml|model', context: 'local', target: 'everyone' },
        ],
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
      },
    ],
    knownCharacterNames: {
      [userCharacterId]: ['User'],
    },
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
  };

  // ─── 8. Location ('location') ───────────────────────────────────────────────
  const mainOfficeId = uuidv4();
  const conferenceRoomId = uuidv4();
  const breakRoomId = uuidv4();

  const mainOfficeLocation: Location = {
    id: mainOfficeId,
    name: 'Main Office',
    description: `${TEMP_NOTICE} Primary workspace and onboarding desk.`,
    text: 'A quiet, sunlit open-plan office with dual-monitor workstations, a whiteboard outlining system architecture, and glass doors leading to the conference room and lounge.',
    hasSkyView: true,
    hasWeather: true,
    chatStaminaRegenerationRateMultiplier: 1,
    actionStaminaRegenerationRateMultiplier: 1,
    locationBindings: [conferenceRoomId, breakRoomId],
    locationDistances: { [conferenceRoomId]: 10, [breakRoomId]: 15 },
    locationBindingRegularExpressionTriggers: {
      [conferenceRoomId]: 'conference|meeting',
      [breakRoomId]: 'lounge|break|coffee',
    },
    characterBindings: [userCharacterId, guideCharacterId],
    globalWeight: 1,
    messageFilterNonCoLocatedParticipants: true,
    useBase64Encoding: false,
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
  };

  const conferenceRoomLocation: Location = {
    id: conferenceRoomId,
    name: 'Conference Room',
    description: `${TEMP_NOTICE} Meeting space for multi-participant discussions and timeline branching.`,
    text: 'An enclosed glass conference room equipped with a long oak table, presentation display, and acoustic paneling.',
    hasSkyView: true,
    hasWeather: false,
    chatStaminaRegenerationRateMultiplier: 1,
    actionStaminaRegenerationRateMultiplier: 1,
    locationBindings: [mainOfficeId],
    locationDistances: { [mainOfficeId]: 10 },
    characterBindings: [],
    globalWeight: 1,
    messageFilterNonCoLocatedParticipants: true,
    useBase64Encoding: false,
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
  };

  const breakRoomLocation: Location = {
    id: breakRoomId,
    name: 'Executive Lounge',
    description: `${TEMP_NOTICE} Quiet secondary room for testing spatial participant isolation.`,
    text: 'A comfortable lounge area overlooking the city skyline with armchairs, a coffee bar, and a wall-mounted status screen.',
    hasSkyView: true,
    hasWeather: true,
    chatStaminaRegenerationRateMultiplier: 1.2,
    actionStaminaRegenerationRateMultiplier: 1.2,
    locationBindings: [mainOfficeId],
    locationDistances: { [mainOfficeId]: 15 },
    characterBindings: [],
    globalWeight: 1,
    messageFilterNonCoLocatedParticipants: true,
    useBase64Encoding: false,
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
  };

  // ─── 9. Context ('context'), PromptBlock ('promptBlock'), AudioTrack ('audioTrack') ───
  const demoContext: Context = {
    id: uuidv4(),
    name: 'Application Overview',
    description: `${TEMP_NOTICE} High-level summary of the browser demo environment.`,
    text: 'This workspace is pre-populated with temporary demo presets. Any entity you edit or create will be permanently saved to your browser’s IndexedDB storage.',
    limitLinksToSubdirectory: false,
    useBase64Encoding: false,
    isAutoGenerated: false,
    characterBindings: [guideCharacterId],
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
  };

  const demoPromptBlock: PromptBlock = {
    id: uuidv4(),
    name: 'Standard Assistant Formatting',
    description: `${TEMP_NOTICE} Formatting guidelines for structured technical responses.`,
    textContent: 'Respond in clear, well-structured prose. Keep technical explanations concise and directly actionable.',
    images: [],
    characterBindings: [guideCharacterId],
    contextBindings: [demoContext.id],
    locationBindings: [mainOfficeId],
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
  };

  const demoAudioTrack: AudioTrack = {
    id: uuidv4(),
    name: 'Office Ambient Room Tone',
    description: `${TEMP_NOTICE} Sample ambient audio track configuration bound to Main Office.`,
    filename: '',
    loop: true,
    volume: 0.4,
    audioCategory: 'ambient',
    playableByParticipants: true,
    startFadeDurationMs: 1000,
    endFadeDurationMs: 1000,
    locationBindings: [mainOfficeId],
    contextBindings: [],
    characterBindings: [],
    priority: 1,
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
  };

  // ─── 10. World ('world') ────────────────────────────────────────────────────
  const demoWorld: World = {
    id: uuidv4(),
    name: 'Onboarding Workspace',
    description: `${TEMP_NOTICE} Pre-configured office environment with linked locations, RAG knowledge nodes, and assistant guide.`,
    characterIds: [userCharacterId, guideCharacterId],
    contextIds: [demoContext.id],
    locationIds: [mainOfficeId, conferenceRoomId, breakRoomId],
    audioTrackIds: [demoAudioTrack.id],
    profileId: demoProfile.id,
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
  };

  // ─── 11. InteractionData ('interactionData') ────────────────────────────────
  const msg1Id = uuidv4();
  const msg2Id = uuidv4();
  const msg3Id = uuidv4();

  const demoChat: InteractionData = {
    id: uuidv4(),
    name: 'System Onboarding & Architecture Demo',
    description: `${TEMP_NOTICE} Sample session demonstrating multi-location state, chained prompts, and view mode switching.`,
    protagonistIds: [userCharacterId],
    participants: [userCharacter, guideCharacter],
    contexts: [demoContext],
    locations: [mainOfficeLocation, conferenceRoomLocation, breakRoomLocation],
    audioTracks: [demoAudioTrack],
    profile: demoProfile,
    worldIds: [demoWorld.id],
    parentInteractionDataId: null,
    parentMessageId: null,
    numberOfMessages: 3,
    interactionHistories: {
      [mainOfficeId]: [
        {
          id: msg1Id,
          messageType: 'narration',
          character: guideCharacter,
          textContent:
            `${TEMP_NOTICE} Workspace initialized in Main Office. Connected locations: Conference Room (10m) and Executive Lounge (15m).`,
          characterClothingWearingStatuses: {
            [clothingBlazerId]: true,
            [clothingShirtId]: true,
          },
          characterLockedLocations: {},
          isPresent: true,
          parentMessageId: null,
          firstCreatedTimestamp: now - 60000,
          lastUpdatedTimestamp: now - 60000,
        },
        {
          id: msg2Id,
          messageType: 'chat',
          character: guideCharacter,
          characterExpression: 'neutral',
          textContent:
            'Welcome to the LoreReactor workspace. This session is pre-configured with a multi-room office layout, hybrid retrieval configs, and chained prompt graphs so you can inspect how the engine structures context. You can switch between Chat, Visual Novel, Cinematic, Ladder, and Card views using the top dropdown, or open any editor modal to inspect the underlying data.',
          characterClothingWearingStatuses: {
            [clothingBlazerId]: true,
            [clothingShirtId]: true,
          },
          characterLockedLocations: {},
          isPresent: true,
          parentMessageId: msg1Id,
          modelTextContentSummaries: {},
          modelInteractionTextContentSummaries: {},
          kvCacheTextContentPaths: {},
          kvCacheTextContentSummaryPaths: {},
          kvCacheInteractionTextContentSummaries: {},
          firstCreatedTimestamp: now - 30000,
          lastUpdatedTimestamp: now - 30000,
        },
        {
          id: msg3Id,
          messageType: 'chat',
          character: userCharacter,
          characterExpression: 'neutral',
          textContent:
            "Thanks. Let's review how the prompt compilation pipeline and location state routing work.",
          characterClothingWearingStatuses: {},
          characterLockedLocations: {},
          isPresent: true,
          parentMessageId: msg2Id,
          modelTextContentSummaries: {},
          modelInteractionTextContentSummaries: {},
          kvCacheTextContentPaths: {},
          kvCacheTextContentSummaryPaths: {},
          kvCacheInteractionTextContentSummaries: {},
          firstCreatedTimestamp: now - 10000,
          lastUpdatedTimestamp: now - 10000,
        },
      ],
      [conferenceRoomId]: [],
      [breakRoomId]: [],
    },
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
  };

  // ─── 12. EntityFolder ('entityFolder') ──────────────────────────────────────
  const entityFolders: EntityFolder[] = [
    {
      id: uuidv4(),
      name: 'Temporary Characters',
      description: `${TEMP_NOTICE} Pre-configured onboarding characters.`,
      entityType: 'character',
      itemIds: [userCharacterId, guideCharacterId],
      firstCreatedTimestamp: now,
      lastUpdatedTimestamp: now,
    },
    {
      id: uuidv4(),
      name: 'Temporary Locations',
      description: `${TEMP_NOTICE} Pre-configured office locations.`,
      entityType: 'location',
      itemIds: [mainOfficeId, conferenceRoomId, breakRoomId],
      firstCreatedTimestamp: now,
      lastUpdatedTimestamp: now,
    },
    {
      id: uuidv4(),
      name: 'Temporary Contexts',
      description: `${TEMP_NOTICE} Pre-configured workspace contexts.`,
      entityType: 'context',
      itemIds: [demoContext.id],
      firstCreatedTimestamp: now,
      lastUpdatedTimestamp: now,
    },
    {
      id: uuidv4(),
      name: 'Temporary Audio Tracks',
      description: `${TEMP_NOTICE} Pre-configured audio track entities.`,
      entityType: 'audioTrack',
      itemIds: [demoAudioTrack.id],
      firstCreatedTimestamp: now,
      lastUpdatedTimestamp: now,
    },
    {
      id: uuidv4(),
      name: 'Temporary Worlds',
      description: `${TEMP_NOTICE} Pre-configured world bundles.`,
      entityType: 'world',
      itemIds: [demoWorld.id],
      firstCreatedTimestamp: now,
      lastUpdatedTimestamp: now,
    },
    {
      id: uuidv4(),
      name: 'Temporary Prompt Blocks',
      description: `${TEMP_NOTICE} Pre-configured prompt block rules.`,
      entityType: 'promptBlock',
      itemIds: [demoPromptBlock.id],
      firstCreatedTimestamp: now,
      lastUpdatedTimestamp: now,
    },
    {
      id: uuidv4(),
      name: 'Temporary Sessions',
      description: `${TEMP_NOTICE} Pre-configured interaction data sessions.`,
      entityType: 'interactionData',
      itemIds: [demoChat.id],
      firstCreatedTimestamp: now,
      lastUpdatedTimestamp: now,
    },
    {
      id: uuidv4(),
      name: 'Temporary Language Models',
      description: `${TEMP_NOTICE} Pre-configured cloud language model presets.`,
      entityType: 'languageModel',
      itemIds: [geminiFlashModel.id, openRouterModel.id],
      firstCreatedTimestamp: now,
      lastUpdatedTimestamp: now,
    },
    {
      id: uuidv4(),
      name: 'Temporary Spatiotemporal Models',
      description: `${TEMP_NOTICE} Pre-configured cloud diffusion presets.`,
      entityType: 'spatiotemporalModel',
      itemIds: [cloudImageModel.id],
      firstCreatedTimestamp: now,
      lastUpdatedTimestamp: now,
    },
    {
      id: uuidv4(),
      name: 'Temporary Token Samplers',
      description: `${TEMP_NOTICE} Pre-configured token sampling presets.`,
      entityType: 'tokenSampler',
      itemIds: [balancedSampler.id],
      firstCreatedTimestamp: now,
      lastUpdatedTimestamp: now,
    },
    {
      id: uuidv4(),
      name: 'Temporary Stop Patterns',
      description: `${TEMP_NOTICE} Pre-configured stop pattern presets.`,
      entityType: 'stopPattern',
      itemIds: [stopPatternUserTurn.id],
      firstCreatedTimestamp: now,
      lastUpdatedTimestamp: now,
    },
    {
      id: uuidv4(),
      name: 'Temporary Retrieval Configurations',
      description: `${TEMP_NOTICE} Pre-configured RAG retrieval presets.`,
      entityType: 'retrievalConfiguration',
      itemIds: [hybridRetrievalConfig.id],
      firstCreatedTimestamp: now,
      lastUpdatedTimestamp: now,
    },
    {
      id: uuidv4(),
      name: 'Temporary Budget Strategies',
      description: `${TEMP_NOTICE} Pre-configured model routing and budget strategies.`,
      entityType: 'budgetStrategy',
      itemIds: [demoBudgetStrategy.id],
      firstCreatedTimestamp: now,
      lastUpdatedTimestamp: now,
    },
    {
      id: uuidv4(),
      name: 'Temporary Profiles',
      description: `${TEMP_NOTICE} Pre-configured orchestration profiles.`,
      entityType: 'profile',
      itemIds: [demoProfile.id],
      firstCreatedTimestamp: now,
      lastUpdatedTimestamp: now,
    },
  ];

  return {
    characters: [userCharacter, guideCharacter],
    contexts: [demoContext],
    locations: [mainOfficeLocation, conferenceRoomLocation, breakRoomLocation],
    audioTracks: [demoAudioTrack],
    worlds: [demoWorld],
    promptBlocks: [demoPromptBlock],
    interactionData: [demoChat],
    languageModels: [geminiFlashModel, openRouterModel],
    spatiotemporalModels: [cloudImageModel],
    tokenSamplers: [balancedSampler],
    stopPatterns: [stopPatternUserTurn],
    retrievalConfigurations: [hybridRetrievalConfig],
    budgetStrategies: [demoBudgetStrategy],
    profiles: [demoProfile],
    entityFolders,
  };
}