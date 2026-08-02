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
  regularExpressionTrigger?: string // If this is empty, then this always get triggered. You can disable chat-specific instructions in the instruction menu.
  regularExpressionContext?: 'global' | 'local' | 'previous'  // The global context uses the whole conversation. The local context uses the information between the character's previous chat to the character's current talk. The previous context only takes into account from previous turn. 
  regularExpressionTarget?: 'everyone' | 'responder' | 'self' // If everyone is the target, then everyone's messages are used. If responder is the target, then that person's messages are used. If self is the target, then only the person themselves are used.
}

export interface RawInstruction {
  name: string;
  description?: string;
  content: string;
  regularExpressionTrigger?: string // If this is empty, then this always get triggered. You can disable chat-specific instructions in the instruction menu.
  regularExpressionContext?: 'global' | 'local' | 'previous'  // The global context uses the whole conversation. The local context uses the information between the character's previous chat to the character's current talk. The previous context only takes into account from previous turn. 
  regularExpressionTarget?: 'everyone' | 'responder' | 'self' // If everyone is the target, then everyone's messages are used. If responder is the target, then that person's messages are used. If self is the target, then only the person themselves are used.
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