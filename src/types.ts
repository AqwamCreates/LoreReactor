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

export type backend = 'Llama.cpp' | 'Transformers' | 'ExLlamaV3' | 'ExLlamaV3 HF' | 'TensorRT-LLM' | 'Ollama' | 'DeepSeek' | 'Qwen' | `Kimi` | 'GLM' | 'MiMo' |'OpenAI' | 'Mistral' | 'Groq'| 'YandexGPT' |'OpenRouter' | 'Inworld' | 'Other'

export interface LanguageModel extends ObjectData {

  backend?: backend;
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

  backend?: backend;
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
  thinkPrompt?: string;
  initiativeWeight?: number | undefined;
  chatProbability?: number | undefined;
  maximumChatStamina?: number | undefined;
  maximumNumberOfParagraphsPerTurn?: number | undefined;
  sampler?: Sampler | undefined;

}

export interface RawCharacter extends RawData {

  image?: string; // Path to the character's image.
  systemPrompt?: string;
  thinkPrompt?: string;
  initiativeWeight?: number | undefined;
  chatProbability?: number | undefined;
  maximumChatStamina?: number | undefined;
  maximumNumberOfParagraphsPerTurn?: number | undefined;
  samplerId?: string | undefined; // Store only the sampler ID here

}

export interface ChatMessage {
  
  id: string;
  character: Character;
  textContent: string;
  remainingChatStamina: number | undefined;
  isNameRevealed?: boolean;
  textContentSummary?: string;
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
  textContentSummary?: string;
  kvCachePath?: string;
  firstCreatedTimestamp: number;
  lastUpdatedTimestamp: number;
  parentChatMessageId?: string | null;

}

export interface ChatData extends ObjectData {

  protagonist: Character;
  participants: Character[];
  contexts?: Context[]; // Changed from instructions
  chatMessageHistory: ChatMessage[];
  messageCount?: number; // ✅ Total message count from metadata, available without loading messages
  parentChatDataId?: string | null;
  parentChatMessageId?: string | null;
  Profile?: Profile;

}

export interface RawChatData extends RawData {

  protagonistId: string;
  participantIds: string[];
  contextIds: string[]; // Changed from instructionIds
  chatMessageIdHistory: string[];
  parentChatDataId?: string | null;
  parentChatMessageId?: string | null;
  ProfileId?: string;
  

}

export type ExtensionType = 'Image Generation API' | 'Accessibility' | 'Extra';

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

export type PromptBlockType = 
  | 'Context'              // Active context entries (regex-matched)     // Think/meta-instruction prompts  
  | 'System Prompt'        // Character system prompts
  | 'Think Prompt'
  | 'Chat History'         // Conversation history messages

export interface Profile extends ObjectData {

  forceNameReveal: boolean;
  forceEqualInitiative: boolean;
  chatProbability: number; // 0 means it is disabled and uses character default.
  maximumChatStamina: number; // 0 means it is disabled and uses character default..
  cacheInvalidationReductionLevel: number // 0 for no cache invalidation reduction, 1 forces name injection, 2 forces prompt injection.
  stripThinkTokens: boolean;
  inputStrategy: PromptBlockType[] // Controls the order for which prompt is added first.

}

export interface RawProfile extends RawData{

  forceNameReveal: boolean;
  forceEqualInitiative: boolean;
  chatProbability: number; // -1 means it is disabled and uses character default.
  maximumChatStamina: number; // -1 means it is disabled and uses character default..
  cacheInvalidationReductionLevel: number // 0 for no cache invalidation reduction, 1 forces name injection, 2 forces prompt injection.
  stripThinkTokens: boolean;
  inputStrategy: PromptBlockType[] // Controls the order for which prompt is added first.

}

export interface InterjectableAction {
  label: string;
  count: number;
}

