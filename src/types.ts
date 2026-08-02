export interface StopPattern {
  id: string;
  name: string;
  description?: string;
  pattern: string;
  regularExpressionTrigger?: string;
  regularExpressionContext?: 'global' | 'local' | 'previous';
  regularExpressionTarget?: 'everyone' | 'responder' | 'self';
  firstCreatedTimestamp: number;
  lastUpdatedTimestamp: number;
}

export interface RawStopPattern {
  name: string;
  description?: string;
  pattern: string;
  regularExpressionTrigger?: string;
  regularExpressionContext?: 'global' | 'local' | 'previous';
  regularExpressionTarget?: 'everyone' | 'responder' | 'self';
  firstCreatedTimestamp: number;
  lastUpdatedTimestamp: number;
}

export interface Sampler {
  id: string;
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  stopPatterns: StopPattern[];
  maximumNumberOfTokens?: number;
  firstCreatedTimestamp: number;
  lastUpdatedTimestamp: number;
}

export interface RawSampler {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  stopPatternIds: string[];
  maximumNumberOfTokens?: number;
  firstCreatedTimestamp: number;
  lastUpdatedTimestamp: number;
}

export interface Context {
  id: string;
  name: string;
  description?: string;
  text?: string;
  images?: string[];
  regularExpressionTrigger?: string;
  regularExpressionContext?: 'global' | 'local' | 'previous';
  regularExpressionTarget?: 'everyone' | 'responder' | 'self';
  firstCreatedTimestamp: number;
  lastUpdatedTimestamp: number;
}

export interface RawContext {
  name: string;
  description?: string;
  text?: string;
  images?: string[];
  regularExpressionTrigger?: string;
  regularExpressionContext?: 'global' | 'local' | 'previous';
  regularExpressionTarget?: 'everyone' | 'responder' | 'self';
  firstCreatedTimestamp: number;
  lastUpdatedTimestamp: number;
}

export interface LanguageModel {
  id: string;
  name: string;
  description?: string;
  backend?: 'Llama.cpp' | 'Transformers' | 'ExLlamaV3' | 'ExLlamaV3 HF' | 'TensorRT-LLM' | 'Ollama' | 'DeepSeek' | 'Qwen' | 'OpenAI' | 'Other';
  contextLength: number;
  model: string;
  mmproj?: string;
  parameters?: Record<string, unknown>;
  firstCreatedTimestamp: number;
  lastUpdatedTimestamp: number;
}
export interface Character {
  id: string;
  name: string;
  image?: string; // Path to the character's image.
  description?: string;
  systemPrompt?: string;
  initiativeWeight?: number | undefined;
  chatProbability?: number | undefined;
  maximumChatStamina?: number | undefined;
  sampler?: Sampler | undefined;
  firstCreatedTimestamp: number;
  lastUpdatedTimestamp: number;
}

export interface RawCharacter {
  name: string;
  image?: string; // Path to the character's image.
  description?: string;
  systemPrompt?: string;
  initiativeWeight?: number | undefined;
  chatProbability?: number | undefined;
  maximumChatStamina?: number | undefined;
  samplerId?: string | undefined; // Store only the sampler ID here
  firstCreatedTimestamp: number;
  lastUpdatedTimestamp: number;
}

export interface ChatMessage {
  id: string;
  character: Character;
  textContent: string;
  remainingChatStamina: number | undefined;
  isNameRevealed?: boolean;
  kvCachePath?: string;
  firstCreatedTimestamp: number;
  lastUpdatedTimestamp: number;
  parentChatMessageId?: string | null;
}

export interface RawChatMessage {
  characterId: string;
  textContent: string;
  remainingChatStamina: number | undefined;
  isNameRevealed?: boolean;
  kvCachePath?: string;
  firstCreatedTimestamp: number;
  lastUpdatedTimestamp: number;
  parentChatMessageId?: string | null;
}

export interface ChatData {
  id: string;
  title: string;
  protagonist: Character;
  participants: Character[];
  contexts?: Context[]; // Changed from instructions
  chatMessageHistory: ChatMessage[];
  firstCreatedTimestamp: number;
  lastUpdatedTimestamp: number;
  parentChatDataId?: string | null;
  parentChatMessageId?: string | null;
}

export interface RawChatData {
  title: string;
  protagonistId: string;
  participantIds: string[];
  contextIds: string[]; // Changed from instructionIds
  chatMessageIdHistory: string[];
  firstCreatedTimestamp: number;
  lastUpdatedTimestamp: number;
  parentChatDataId?: string | null;
  parentChatMessageId?: string | null;
}

export type ExtensionType = 'language_model_api' | 'image_generation_api' | 'accessibility' | 'extra';

export interface Extension {
  id: string;
  name: string;
  description: string;
  extensionType: ExtensionType;
  firstCreatedTimestamp: number;
  lastUpdatedTimestamp: number;
}