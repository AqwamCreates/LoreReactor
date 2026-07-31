export interface StopPattern {
  name: string;
  description?: string;
  patterns: string[];
}

export interface Sampler {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  stopPattern?: StopPattern;
  maxTokens?: number;
}

export interface Instruction {
  name: string;
  description?: string;
  content: string;
}

export interface Character {
  name: string;
  description?: string;
  image?: string;
  systemPrompt?: string;
  initiativeWeight?: number | undefined;
  chatProbability?: number | undefined;
  samplerId?: string;
}

export interface ChatMessage {
  characterId: string;
  textContent: string;
  isAppearanceRevealed?: boolean;
  isNameRevealed?: boolean;
  kvCachePath?: string;
  timestamp: number;
  parentMessageId?: string | null;
}

export interface ChatData {
  title: string;
  protagonistId: string;
  participantIds: string[];
  instructionIds?: string[];
  chatMessageIdHistory: string[];
  first_created_timestamp: number;
  last_updated_timestamp: number;
}