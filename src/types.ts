interface ObjectData {

  id: string;
  name: string;
  description?: string;
  firstCreatedTimestamp: number;
  lastUpdatedTimestamp: number;

}

interface RawData {

  name: string;
  description?: string;
  firstCreatedTimestamp: number;
  lastUpdatedTimestamp: number;

}

export interface StopPattern extends ObjectData {

  pattern: string;
  regularExpressionTrigger?: string;
  regularExpressionContext?: 'global' | 'local' | 'previous';
  regularExpressionTarget?: 'everyone' | 'listener' | 'self';

}

export interface RawStopPattern extends RawData {

  pattern: string;
  regularExpressionTrigger?: string;
  regularExpressionContext?: 'global' | 'local' | 'previous';
  regularExpressionTarget?: 'everyone' | 'listener' | 'self';

}

export interface Sampler extends ObjectData {

  parameters?: Record<string, unknown>;
  stopPatterns: StopPattern[];
  maximumNumberOfTokens?: number;
  
}

export interface RawSampler extends RawData  {

  parameters?: Record<string, unknown>;
  stopPatternIds: string[];
  maximumNumberOfTokens?: number;

}

export interface Context extends ObjectData  {
  text?: string;
  images?: string[];
  regularExpressionTrigger?: string;
  regularExpressionContext?: 'global' | 'local' | 'previous';
  regularExpressionTarget?: 'everyone' | 'listener' | 'self';
  useBase64Encoding: boolean

}

export interface RawContext extends RawData  {

  text?: string;
  images?: string[];
  regularExpressionTrigger?: string;
  regularExpressionContext?: 'global' | 'local' | 'previous';
  regularExpressionTarget?: 'everyone' | 'listener' | 'self';
  useBase64Encoding: boolean

}

export interface LanguageModel extends ObjectData {

  backend?: 'Llama.cpp' | 'Transformers' | 'ExLlamaV3' | 'ExLlamaV3 HF' | 'TensorRT-LLM' | 'Ollama' | 'DeepSeek' | 'Qwen' | `Kimi` | 'OpenAI' | 'Groq'| 'OpenRouter' | 'Inworld' | 'Other';
  contextLength: number;
  model?: string;
  mmproj?: string;
  apiKey?: string;
  parameters?: Record<string, unknown>;
  cacheHitCostPerOneMillionOfTokens?: number,
  cacheMissCostPerOneMillionOfTokens?: number,
  outputGenerationCostPerOneMillionOfTokens?: number,

}

export interface RawLanguageModel extends RawData {

  backend?: 'Llama.cpp' | 'Transformers' | 'ExLlamaV3' | 'ExLlamaV3 HF' | 'TensorRT-LLM' | 'Ollama' | 'DeepSeek' | 'Qwen' | 'OpenAI' | 'Other';
  contextLength: number;
  model?: string;
  mmproj?: string;
  apiKey?: string;
  parameters?: Record<string, unknown>;
  cacheHitCostPerOneMillionOfTokens?: number,
  cacheMissCostPerOneMillionOfTokens?: number,
  outputGenerationCostPerOneMillionOfTokens?: number,

}
export interface Character extends ObjectData  {
  
  image?: string; // Path to the character's image.
  systemPrompt?: string;
  initiativeWeight?: number | undefined;
  chatProbability?: number | undefined;
  maximumChatStamina?: number | undefined;
  sampler?: Sampler | undefined;

}

export interface RawCharacter extends RawData {

  image?: string; // Path to the character's image.
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
  name: string;
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

  name: string;
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

export interface Extension extends ObjectData{

  extensionType: ExtensionType;

}

export interface BudgetStrategy extends ObjectData {

  onlineModel: LanguageModel;
  localModel: LanguageModel;
  switchProbabilty: number; //When the random value is less than the probability, the online model will be used.
  switchOnContextSize: number; //When the context size exceeds this limit, the online model will be used.
  switchOnComplexityScore: number, // When complexity score exceeds this limit, the online model will be used.
  fallbackOnLocalFailure: boolean; // If the local model fails to stop, the online model will be used.
  fallbackOnQualityThreshold: number;  // If the quality score below this, the online model will be used.
  fallbackOnTimeoutInSeconds: number; // If local takes too long, the online model will be used.
  maximumBudget: number; //When the cost exceeds the budget, then the local model will be used throughout the rest of the conversations.

}

export interface RawBudgetStrategy extends RawData {

  onlineModelId: string;
  localModelId: string;
  switchProbabilty: number; //When the random value is less than the probability, the online model will be used.
  switchOnContextSize: number; //When the context size exceeds this limit, the online model will be used.
  switchOnComplexityScore: number, // When complexity score exceeds this limit, the online model will be used.
  fallbackOnLocalFailure: boolean; // If the local model fails to stop, the online model will be used.
  fallbackOnQualityThreshold: number;  // If the quality score below this, the online model will be used.
  fallbackOnTimeoutInSeconds: number; // If local takes too long, the online model will be used.
  maximumBudget: number; //When the cost exceeds the budget, then the local model will be used throughout the rest of the conversations.

}