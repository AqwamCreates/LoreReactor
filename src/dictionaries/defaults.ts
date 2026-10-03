// src/dictionaries/defaults.ts
import type { BudgetData, BudgetStrategy, Character, InterjectableAction, LanguageModel, MultiplayerData, promptBlockType, Sampler, textType, tool, tristateInteger } from '../types';

export const DEFAULT_BUDGET_RESET_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

const now = Date.now()

export const defaultCharacterTools: Record<tool, boolean> = {
    whisper: true,
    think: false,
    pick: true,
    clock: true,
    calendar: true,
    coin: true,
    dice: true,
    random: true,
    rng: false,
    move: true,
    timer: false,
    stopwatch: false,
    schedule: false,
    calculator: false,
    web: false,
    dialogue: false,
    knowledge: false,
    memory: false,
    lookup: false,
    map: false,
    audio: false,
    note: false,
    clothing: false,
    inventory: false,
    trade: false,
    invite: false,
    kick: false,
    oracle: false,
    teleport: false,
    key: false,
    summon: false,
    narrate: false,
    inspect: false,
    administrator: false,
    creator: false,
    destroyer: false,
    schedule_response: false,
    text_to_speech: false,
    gpu: false,
    system_info: false,
    notify: false,
    volume_control: false,
    lock_screen: false,
    sleep: false,
    shutdown: false,
    clipboard: false,
    screenshot: false,
    webcam: false,
    network_scanner: false,
    file_watcher: false,
    window_monitor: false,
    process_monitor: false,
    trash: false,
    browser: false,
    read_file: false,
    write_file: false,
    shell: false,
    virtual_input: false,
    hardware_control: false,
};

export const defaultCharacter: Character = {

    id: '',
    name: 'Default Character',
    description: '',
    images: {},
    initiativeWeight: 1,
    chatProbability: 0.5,
    maximumChatStamina: 4,
    nameSensitivity: 1,
    chatImpatienceSensitivity: 0,
    skipProbability: 0,
    memoryRetentionWeight: 1,
    contextSensitivity: 1,
    maximumActionStamina: 5,
    numberOfMessagesToDisableThinkPrompt: 1,
    numberOfMessagesToDisableMetaThinkInstructions: 1,
    numberOfMessagesToDisableDialoguePrompt: 1,
    numberOfMessagesToDisableStarterPrompt: 1,
    tools: { ...defaultCharacterTools },
    clothings: [],
    knownCharacterNames: {},
    textCharacterInjections: [],
    memories: {},
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,

}

export const defaultSampler: Sampler = {
    id: "default-sampler",
    name: "Default",
    description: "Fallback sampler",
    parameters: { temperature: 0.8, top_k: 40, repeat_penalty: 1.15, n_predict: 512, stop: [], frequency_penalty: 0.0, presence_penalty: 0.0 },
    stopPatterns: [],
    maximumNumberOfTokens: 512,
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
};

export const defaultModel: LanguageModel = {
    id: "default-model",
    name: "Default Model",
    description: "Fallback model",
    backend: "Llama.cpp",
    contextLength: 4096,
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
};

export const defaultBudgetData: BudgetData = {
    id: 'global-budget-data',
    name: 'Global Budget Data',
    description: 'Auto-created on first budget strategy activation',
    budgetSpent: 0,
    resetDuration: DEFAULT_BUDGET_RESET_DURATION_MS,
    averageLatencyMsPerTokenExponentialMovingAverageSmoothing: 0.3,
    averageTimeToFirstTokenExponentialMovingAverageSmoothing: 0.3,
    modelLastUsedTimestamps: {},
    modelLastQuotaHitTimeStamps: {},
    modelLastErrorHitTimeStamps: {},
    modelUsedCount: {},
    modelRegenerationCount: {},
    modelCensorshipHitCount: {},
    modelBrokenCount: {},
    modelQuotaHitCount: {},
    modelErrorHitCount: {},
    lastResetTimestamp: now,
    budgetStrategy: {} as BudgetStrategy,
    modelBudgetSpent: {},
    modelAverageLatencyMsPerToken: {},
    modelAverageTimeToFirstToken: {},
    modelTotalSessionDuration: {},
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,
};

export const defaultActions: InterjectableAction[] = [
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
    { label: 'Pout At', count: 0 },
];

export const defaultInputStrategy: promptBlockType[] = [
    'System Prompt', 'Think Prompt', 'Meta Think Instructions', 'Appearance Prompt', 'Dialogue Prompt',
    'Chat History', 'Context', 'Location', 'Weather', 'Inventory', 'Date', 'Time', 'Time Elapsed',
    'Fatigue Information', 'Starter Prompt', 'Tool Instructions', 'Anti-Repetition Nudge', 'Text Injection',
];

export const defaultProfileTools: Record<tool, tristateInteger> = Object.fromEntries(
    Object.keys(defaultCharacterTools).map(key => [key, 0])
) as Record<tool, tristateInteger>;

export const defaultNarrateTexts: Record<textType, boolean> = {
    normal: false, quoted: false, bolded: false, italicized: false,
    parenthesized: false, bracketed: false, braced: false,
};

export function createDefaultMultiplayerData(): MultiplayerData {
    const now = Date.now();
    return {
        id: '',
        name: '',
        password: '',
        canUseJoinerCharacterIds: true,
        joinerCharacterIdsRequiresHosterApproval: true,
        sharedHosterCharacterIds: [],
        hosterCharacterIdsRequiresHosterApproval: true,
        useJoinerLanguageModel: 0,
        interactionDataIds: [],
        multiplayerDataAccountConfigurations: {},
        pendingAccountIds: [],
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    };
}

export const defaultContextLength = 8192