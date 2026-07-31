export interface StopPattern {
  id: string;
  name: string;
  description?: string;
  patterns: string[];
}

export interface Sampler {
  id: string;
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  stopPattern?: StopPattern;
  maxTokens?: number;
}

export interface Instruction {
  id: string;
  name: string;
  description?: string;
  content: string;
}

export interface Character {
  id: string;
  name: string;
  image?: string;
  description?: string;
  systemPrompt?: string;
  initiativeWeight?: number | undefined;
  chatProbability?: number | undefined;
  sampler?: Sampler | undefined;
}

export interface ChatMessage {
  id: string;
  character: Character;
  textContent: string;
  isAppearanceRevealed?: boolean;
  isNameRevealed?: boolean;
  kvCachePath?: string;
  timestamp: number;
  parentMessageId?: string | null;
}

export interface ChatData {
  id: string;
  title: string;
  protagonist: Character;
  participants: Character[];
  instructions?: Instruction[];
  chatMessageHistory: ChatMessage[];
  first_created_timestamp: number;
  last_updated_timestamp: number;
}