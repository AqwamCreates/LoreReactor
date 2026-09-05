/**
 * Application Ports - Interfaces for external communication
 */

// Input ports (use cases expose these)
export interface IChatOrchestrationPort {
  sendMessage(text: string, files?: File[]): Promise<void>;
  stopGeneration(): void;
  regenerateFromMessage(messageId: string): Promise<void>;
  resumeGeneration(messageId: string): Promise<void>;
  startNewChat(protagonistId: string, participantIds: string[]): Promise<void>;
}

export interface ICharacterManagementPort {
  saveCharacter(character: import('../../core/types').Character): Promise<boolean>;
  deleteCharacter(id: string): Promise<boolean>;
  loadFullCharacter(id: string): Promise<import('../../core/types').Character | null>;
}

export interface IContextManagementPort {
  saveContext(context: import('../../core/types').Context): Promise<boolean>;
  deleteContext(id: string): Promise<boolean>;
}

export interface ISamplerManagementPort {
  saveSampler(sampler: import('../../core/types').Sampler): Promise<boolean>;
  deleteSampler(id: string): Promise<boolean>;
}

export interface IStopPatternManagementPort {
  saveStopPattern(pattern: import('../../core/types').StopPattern): Promise<boolean>;
  deleteStopPattern(id: string): Promise<boolean>;
}

export interface IModelManagementPort {
  saveModel(model: import('../../core/types').LanguageModel): Promise<boolean>;
  deleteModel(id: string): Promise<boolean>;
  toggleModelLoad(modelId: string): Promise<void>;
  getRunningModels(): Record<string, { isRunning: boolean; port?: number }>;
}

export interface IBudgetStrategyManagementPort {
  saveStrategy(strategy: import('../../core/types').BudgetStrategy): Promise<boolean>;
  deleteStrategy(id: string): Promise<boolean>;
}

export interface IProfileManagementPort {
  saveProfile(profile: import('../../core/types').Profile): Promise<boolean>;
  deleteProfile(id: string): Promise<boolean>;
}

// Output ports (infrastructure implements these)
export interface ILanguageModelEnginePort {
  generateStream(
    body: unknown,
    abortController: AbortController,
    callbacks?: import('../../infrastructure/models').StreamCallbacks,
    context?: import('../../infrastructure/models').LanguageModelContext
  ): Promise<{ text: string; isCompleted: boolean }>;
  countTokens(text: string, context?: import('../../infrastructure/models').LanguageModelContext): Promise<number>;
}

export interface ITextToSpeechEnginePort {
  generateSpeech(text: string, voiceUrl?: string): Promise<Blob | null>;
}

export interface IStoragePort {
  // Character operations
  loadCharacterManifest(): Promise<string[]>;
  loadCharacter(id: string): Promise<import('../../core/types').Character | null>;
  saveCharacter(character: import('../../core/types').Character): Promise<void>;
  deleteCharacter(id: string): Promise<void>;
  
  // Context operations
  loadContextManifest(): Promise<string[]>;
  loadContext(id: string): Promise<import('../../core/types').Context | null>;
  saveContext(context: import('../../core/types').Context): Promise<void>;
  deleteContext(id: string): Promise<void>;
  
  // Chat data operations
  loadChatDataManifest(): Promise<string[]>;
  loadChatData(id: string): Promise<import('../../core/types').ChatData | null>;
  saveChatData(chatData: import('../../core/types').ChatData): Promise<void>;
  deleteChatData(id: string): Promise<void>;
  
  // Message operations
  loadChatMessages(chatDataId: string): Promise<import('../../core/types').ChatMessage[]>;
  saveChatMessage(chatDataId: string, message: import('../../core/types').ChatMessage): Promise<void>;
  deleteChatMessage(chatDataId: string, messageId: string): Promise<void>;
  
  // Image operations
  getCharacterImageUrl(characterId: string): Promise<string | null>;
  getCharacterVoiceUrl(characterId: string): Promise<string | null>;
  
  // Action operations
  loadInterjectableActions(): Promise<import('../../core/types').InterjectableAction[]>;
  saveInterjectableActions(actions: import('../../core/types').InterjectableAction[]): Promise<void>;
}

export interface ILinkFetcherPort {
  fetchMultipleContextUrls(
    urls: string[],
    options: {
      useBase64Encoding: boolean;
      includeLinkImages: boolean;
      maximumLinkDepth: number;
      linkFetchMode: 'full' | 'summary' | 'extract';
      limitLinksToSubdirectory: boolean;
      fetchCacheTimeToLiveMs?: number;
    }
  ): Promise<{ text: string; images: string[] }>;
  clearCache(): void;
}
