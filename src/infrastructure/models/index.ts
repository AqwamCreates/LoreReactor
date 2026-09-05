/**
 * Infrastructure Models - External service interfaces and types
 */

export interface LanguageModelContext {
  apiKey?: string;
  backend?: string;
  modelPath?: string;
  runtimePort?: number;
}

export interface StreamCallbacks {
  onToken: (stats: TokenStats) => void;
}

export interface TokenStats {
  fullText: string;
  msPerToken: number;
  tokensPerSecond: number;
  timeToFirstToken: number;
}

export interface TextToSpeedLanguageModelContext {
  voiceUrl?: string;
  runtimePort?: number;
}
