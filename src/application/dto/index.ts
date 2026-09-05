/**
 * Data Transfer Objects - Objects used to transfer data between layers
 */

export interface SendMessageCommand {
  text: string;
  files?: File[];
  chatDataId: string;
}

export interface ChatSessionState {
  chatData: import('../../core/types').ChatData | null;
  currentCharacter: import('../../core/types').Character | null;
  isLoading: boolean;
  streamingText: string;
  streamingCharacter: import('../../core/types').Character | null;
  generationSpeed: number;
  timeToFirstToken: number;
  numberOfMessages: number;
  numberOfTokens: number;
  numberOfCacheInvalidations: number;
  numberOfRequests: number;
  totalCost: number;
  costWithoutCacheMisses: number;
}

export interface ModelStatus {
  id: string;
  isRunning: boolean;
  isIdle: boolean;
  port?: number;
}

export interface TokenStats {
  fullText: string;
  msPerToken: number;
  tokensPerSecond: number;
  timeToFirstToken: number;
}

export interface CostCalculation {
  promptTokens: number;
  completionTokens: number;
  isCacheMiss: boolean;
  totalCost: number;
  potentialMaxCost: number;
}
