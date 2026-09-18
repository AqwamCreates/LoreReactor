// src/defaults.ts
import type { BudgetData, BudgetStrategy, InterjectableAction, LanguageModel, PromptBlockType, Sampler, textType, tool } from '../types';

export const DEFAULT_BUDGET_RESET_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

const now = Date.now()

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

export const defaultInputStrategy: PromptBlockType[] = [
    'System Prompt', 'Think Prompt', 'Meta Think Instructions', 'Appearance Prompt', 'Dialogue Prompt',
    'Memory', 'Chat History', 'Context', 'Location', 'Weather', 'Date And Time', 'Time Elapsed',
    'Fatigue Information', 'Starter Prompt', 'Tool Instructions', 'Text Injection',
];

export const defaultCharacterTools: Record<tool, boolean> = {
    pick: true,
    date: false,
    coin: true,
    dice: true,
    random: true,
    rng: false,
    move: true,
    timer: false,
    stopwatch: false,
    calculator: false,
    web: false,
    lookup: false,
    map: false,
    audio: false,
    note: false,
    inventory: false,
    invite: false,
    kick: false,
    teleport: false,
    lock: false,
    unlock: false,
    summon: false,
    narrate: false,
    inspect: false,
    administrator: false,
    creator: false,
    destroyer: false,
};

export const defaultProfileTools: Record<tool, number> = {
    pick: 0, date: 0, coin: 0, dice: 0, random: 0, rng: 0,
    move: 0, timer: 0, stopwatch: 0, calculator: 0, web: 0, lookup: 0,
    map: 0, audio: 0, note: 0, inventory: 0,
    invite: 0, kick: 0, teleport: 0, lock: 0, unlock: 0,
    summon: 0, narrate: 0, inspect: 0,
    administrator: 0, creator: 0, destroyer: 0,
};

export const defaultNarrateTexts: Record<textType, boolean> = {
    normal: false, quoted: false, bolded: false, italicized: false,
    parenthesized: false, bracketed: false, braced: false,
};

export const defaultContextLength = 8192