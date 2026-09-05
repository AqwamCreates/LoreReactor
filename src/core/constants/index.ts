/**
 * Application-wide constants
 */

// ============================================================================
// STORAGE KEYS
// ============================================================================

export const STORAGE_KEYS = {
  ACTIVE_CHAT: 'loreReactor_activeChatId',
  BUDGET_STRATEGY: 'loreReactor_selectedBudgetStrategyId',
  DEFAULT_CHARACTER: 'loreReactor_defaultCharacterId',
  SELECTED_MODEL: 'loreReactor_selectedModelId',
} as const;

// ============================================================================
// PATHS
// ============================================================================

export const PATHS = {
  characters: "/user_data/character_data",
  characterImages: "/user_data/character_images",
  characterVoices: "/user_data/character_voices",
  samplers: "/user_data/sampler_data",
  contexts: "/user_data/context_data",
  models: "/user_data/model_data",
  stopPatterns: "/user_data/stop_pattern_data",
  chatMessages: "/user_data/chat_messages",
  chatData: "/user_data/chat_data",
  kvCaches: "/user_data/kv_caches",
  budgetStrategies: "/user_data/budget_strategies",
  profiles: "/user_data/profile_data",
  webpages: "/user_data/webpage_data",
  memories: "/user_data/memory_data",
  actions: "/user_data/actions.json",
} as const;

export const MANIFEST_FILE = 'manifest.json';

// ============================================================================
// PROMPT MARKERS
// ============================================================================

export const PROMPT_MARKERS = {
  CONTEXT_START: "{",
  CONTEXT_END: "}",
  TURN_START: "{",
  TURN_END: "}",
  MEMORY_WRITE_TRIGGER: "<memory>",
  COMMON_THINK_START: "<think>",
  COMMON_THINK_END: "</think>",
  GEMMA_THINK_START: "<|channel>",
  GEMMA_THINK_END: "<channel|>",
} as const;

export const THINK_START_STRING = `${PROMPT_MARKERS.GEMMA_THINK_START}${PROMPT_MARKERS.COMMON_THINK_START}`;
export const THINK_END_STRING = `${PROMPT_MARKERS.COMMON_THINK_END}${PROMPT_MARKERS.GEMMA_THINK_END}`;

// ============================================================================
// DEFAULT VALUES
// ============================================================================

export const DEFAULT_VALUES = {
  SAMPLER: {
    TEMPERATURE: 0.8,
    TOP_K: 40,
    REPEAT_PENALTY: 1.15,
    N_PREDICT: 512,
    FREQUENCY_PENALTY: 0.0,
    PRESENCE_PENALTY: 0.0,
  },
  CHARACTER: {
    INITIATIVE_WEIGHT: 1,
    CHAT_PROBABILITY: 0.5,
    MAXIMUM_CHAT_STAMINA: Number.POSITIVE_INFINITY,
    NAME_SENSITIVITY: 1,
    RESPONSE_DELAY_WEIGHT: 0,
    MEMORY_RETENTION_WEIGHT: 1,
    CONTEXT_SENSITIVITY: 1,
  },
  CONTEXT: {
    TOKEN_BUDGET: 2048,
    MAX_RECURSION_DEPTH: 5,
    FETCH_CACHE_TTL_MS: 300000, // 5 minutes
  },
  PROFILE: {
    CACHE_INVALIDATION_REDUCTION_LEVEL: 0,
    ENABLE_MEMORY_WRITING: 0,
    ENABLE_MEMORY_READING: 0,
  },
} as const;

// ============================================================================
// BACKEND CLASSIFICATIONS
// ============================================================================

export const CLOUD_BACKENDS = [
  'DeepSeek', 'Qwen', 'Kimi', 'GLM', 'MiMo', 'OpenAI', 'Mistral', 'Groq', 'YandexGPT', 'OpenRouter', 'Inworld'
] as const;

export const STOP_UNSUPPORTED_BACKENDS = ['Google'] as const;
