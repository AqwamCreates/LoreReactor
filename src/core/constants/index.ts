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
// AMBIENT NARRATION POOL
// ============================================================================

export const AMBIENT_NARRATION_POOL = [
  { keywords: ['hello', 'hi', 'hey', 'greet', 'good morning', 'good evening', 'good night', 'howdy', 'yo', '?'], lines: ["A tentative quiet hangs in the air, waiting to be shaped.", "The space between them hums with the possibility of conversation.", "Words hover at the edge of silence, not yet committed.", "The air shifts subtly, acknowledging a presence.", "Something stirs in the stillness — an opening.", "The moment balances on the edge of beginning."] },
  { keywords: ['night', 'dark', 'moon', 'star', 'midnight', 'dusk', 'evening', 'twilight'], lines: ["Crickets hum softly beyond the walls.", "The darkness outside presses gently against the windows.", "A cool night breeze carries distant sounds through the stillness.", "Moonlight traces pale shapes across the floor.", "The night holds its breath around them.", "Somewhere outside, an owl calls once and falls silent."] },
  { keywords: ['morning', 'dawn', 'sunrise', 'sun', 'daybreak', 'early'], lines: ["Pale light filters through the gaps in the curtains.", "Birdsong drifts in from somewhere far away.", "The first warmth of morning touches the edges of the room.", "Dew-laden air seeps through the cracks, fresh and quiet.", "The world outside is just beginning to stir."] },
  { keywords: ['rain', 'storm', 'thunder', 'lightning', 'pouring', 'drizzle', 'wet'], lines: ["Rain taps a steady rhythm against the glass.", "Thunder rumbles low and distant, then fades.", "Water streaks down the windows in silver threads.", "The storm mutters to itself beyond the walls.", "Each raindrop sounds impossibly loud in the quiet."] },
  { keywords: ['room', 'inside', 'indoors', 'house', 'hall', 'chamber', 'apartment'], lines: ["The room settles into its own particular silence.", "Dust motes drift lazily through a shaft of light.", "The walls seem to absorb the quiet, holding it close.", "Something in the room creaks softly, then stills.", "The space between them feels measured and deliberate."] },
  { keywords: ['outside', 'garden', 'forest', 'tree', 'wind', 'grass', 'field', 'path'], lines: ["Leaves rustle in a wind that carries no warmth.", "Branches sway overhead in slow, patient arcs.", "The outdoors hums with a life that doesn't need words.", "Grass bends and rises in waves of quiet motion.", "The horizon holds still, watching."] },
  { keywords: ['footstep', 'walk', 'pace', 'approach', 'tread', 'floorboard'], lines: ["Footsteps echo faintly, then stop.", "The floor groans under shifting weight somewhere nearby.", "A measured tread passes and fades into distance.", "Each step lands carefully, as if the walker doesn't want to be heard."] },
  { keywords: ['creak', 'groan', 'settle', 'shift', 'wood', 'old'], lines: ["Wood settles with a long, patient sigh.", "Something old shifts its weight and goes still again.", "A creak rises and dissolves into the silence.", "The structure around them breathes in its own slow way."] },
  { keywords: ['fire', 'flame', 'hearth', 'warm', 'candle', 'ember', 'glow'], lines: ["Embers pop softly, casting brief orange light.", "The fire murmurs to itself in a language of heat.", "Warmth radiates outward in gentle, invisible waves.", "A candle flickers though nothing has moved the air."] },
  { keywords: ['water', 'river', 'sea', 'ocean', 'wave', 'stream', 'lake', 'shore'], lines: ["Water moves endlessly in the distance, indifferent and constant.", "Waves fold over themselves in a rhythm older than memory.", "The sound of water fills the silence without breaking it.", "Current pulls at something unseen beneath the surface."] },
  { keywords: ['crowd', 'people', 'voices', 'busy', 'market', 'street', 'city'], lines: ["Distant voices blur into a murmur that means nothing.", "Life continues somewhere else, oblivious.", "The noise of others fades to a hum, then less than a hum.", "Footsteps pass without stopping, belonging to strangers."] },
  { keywords: ['cold', 'frost', 'ice', 'snow', 'winter', 'freeze', 'chill'], lines: ["Cold seeps in through places you can't quite find.", "Frost crystals form silently on the other side of the glass.", "The air bites at exposed skin, patient and persistent.", "Ice shifts somewhere with a sound like a whisper."] },
  { keywords: ['book', 'page', 'read', 'paper', 'library', 'shelf', 'ink'], lines: ["Pages settle against each other with a papery sigh.", "The weight of unread words hangs quietly in the air.", "Ink and paper hold their stories in patient silence.", "A book lies open, waiting for eyes that have looked away."] },
] as const;

export const AMBIENT_FALLBACK = [
  "A heavy silence settles over everything.",
  "The air grows still, thick with unspoken words.",
  "Quiet stretches between them like a held breath.",
  "The moment lingers, neither comfortable nor cruel.",
  "Stillness fills the space where words should be.",
  "Time seems to slow in the absence of sound.",
  "The pause grows teeth.",
  "Nothing moves. Nothing breaks the stillness.",
  "The silence has a texture now, rough and unresolved.",
  "A beat passes. Then another.",
] as const;

// ============================================================================
// INTERJECTABLE ACTIONS
// ============================================================================

export const DEFAULT_ACTIONS = [
  { label: 'Hug', count: 0 }, { label: 'Kiss At', count: 0 }, { label: 'Slap', count: 0 },
  { label: 'Push Away', count: 0 }, { label: 'Touch', count: 0 }, { label: 'Grab', count: 0 },
  { label: 'Wave At', count: 0 }, { label: 'Poke', count: 0 }, { label: 'Fish', count: 0 },
  { label: 'Dance Near', count: 0 }, { label: 'Sing To', count: 0 }, { label: 'Whisper At', count: 0 },
  { label: 'Shout At', count: 0 }, { label: 'Whistle', count: 0 }, { label: 'Cough At', count: 0 },
  { label: 'Sneeze At', count: 0 }, { label: 'Laugh At', count: 0 }, { label: 'Cry At', count: 0 },
  { label: 'Sigh At', count: 0 }, { label: 'Stretch', count: 0 }, { label: 'Yawn At', count: 0 },
  { label: 'Bow At', count: 0 }, { label: 'Nod At', count: 0 }, { label: 'Shake At', count: 0 },
  { label: 'Point At', count: 0 }, { label: 'Wink At', count: 0 }, { label: 'Blush At', count: 0 },
  { label: 'Frown At', count: 0 }, { label: 'Smile At', count: 0 }, { label: 'Grin At', count: 0 },
  { label: 'Pout At', count: 0 }
] as const;

// ============================================================================
// INPUT STRATEGY
// ============================================================================

export const DEFAULT_INPUT_STRATEGY = [
  'System Prompt', 
  'Think Prompt', 
  'Meta Think Instruction', 
  'Appearance Prompt', 
  'Dialogue Prompt', 
  'Memory', 
  'Chat History', 
  'Context', 
  'Fatigue Information', 
  'Date And Time', 
  'Text Injection'
] as const;

// ============================================================================
// BACKEND CLASSIFICATIONS
// ============================================================================

export const CLOUD_BACKENDS = [
  'DeepSeek', 'Qwen', 'Kimi', 'GLM', 'MiMo', 'OpenAI', 'Mistral', 'Groq', 'YandexGPT', 'OpenRouter', 'Inworld'
] as const;

export const STOP_UNSUPPORTED_BACKENDS = ['Google'] as const;
