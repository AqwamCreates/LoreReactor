// src/defaults.ts
import type { BudgetData, BudgetStrategy, InterjectableAction, LanguageModel, Sampler } from './types';

export const DEFAULT_BUDGET_RESET_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

const now = Date.now()

export const DefaultSampler: Sampler = {
  id: "default-sampler", 
  name: "Default", 
  description: "Fallback sampler",
  parameters: { temperature: 0.8, top_k: 40, repeat_penalty: 1.15, n_predict: 512, stop: [], frequency_penalty: 0.0, presence_penalty: 0.0 },
  stopPatterns: [], 
  maximumNumberOfTokens: 512,
  firstCreatedTimestamp: now,
  lastUpdatedTimestamp: now,
};

export const DefaultModel: LanguageModel = {
  id: "default-model",
  name: "Default Model",
  description: "Fallback model",
  contextLength: 4096,
  firstCreatedTimestamp: now,
  lastUpdatedTimestamp: now,
};

export const DefaultBudgetData: BudgetData = {

    id: 'global-budget-data',
    name: 'Global Budget Data',
    description: 'Auto-created on first budget strategy activation',
    budgetSpent: 0,
    resetDuration: DEFAULT_BUDGET_RESET_DURATION_MS,
    averageGenerationSpeedMsPerTokenExponentialMovingAverageSmoothing: 0.3,
    averageTimeToFirstTokenExponentialMovingAverageSmoothing: 0.3,
    modelLastUsedTimestamps: {},
    modelLastQuotaHitTimeStamps: {},
    modelLastErrorHitTimeStamps: {},
    lastResetTimestamp: now,
    budgetStrategy: {} as BudgetStrategy,
    modelAverageGenerationSpeedMsPerToken: {},
    firstCreatedTimestamp: now,
    lastUpdatedTimestamp: now,

}

export const DefaultActions: InterjectableAction[] = [
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
];
