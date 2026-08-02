export interface StopPattern {
  id: string;
  name: string;
  description?: string;
  pattern: string;
}

export interface RawStopPattern {
  name: string;
  description?: string;
  pattern: string;
}

export interface Sampler {
  id: string;
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  stopPatterns: StopPattern[];
  maximumNumberOfTokens?: number;
}

export interface RawSampler {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  stopPatternIds: string[];
  maximumNumberOfTokens?: number;
}

export interface Instruction {
  id: string;
  name: string;
  description?: string;
  content: string;
}

export interface RawInstruction {
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
  maximumChatStamina?: number | undefined;
  sampler?: Sampler | undefined;
}

export interface RawCharacter {
  name: string;
  image?: string;
  description?: string;
  systemPrompt?: string;
  initiativeWeight?: number | undefined;
  chatProbability?: number | undefined;
  maximumChatStamina?: number | undefined;
  samplerId?: string | undefined; // Store only the sampler ID here
}

export interface ChatMessage {
  id: string;
  character: Character;
  textContent: string;
  remainingChatStamina: number | undefined;
  isNameRevealed?: boolean;
  kvCachePath?: string;
  timestamp: number;
  parentChatMessageId?: string | null;
}

export interface RawChatMessage {
  characterId: string;
  textContent: string;
  remainingChatStamina: number | undefined;
  isNameRevealed?: boolean;
  kvCachePath?: string;
  timestamp: number;
  parentChatMessageId?: string | null;
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
  parentChatDataId?: string | null;
  parentChatMessageId?: string | null;
}

export interface RawChatData {
  title: string;
  protagonistId: string;
  participantIds: string[];
  instructionIds: string[];
  chatMessageIdHistory: string[];
  first_created_timestamp: number;
  last_updated_timestamp: number;
  parentChatDataId?: string | null;
  parentChatMessageId?: string | null;
}

export type ExtensionType = 'language_model_api' | 'image_generation_api' | 'accessibility' | 'extra';

export interface Extension {
  id: string;
  name: string;
  description: string;
  extensionType: ExtensionType;
}