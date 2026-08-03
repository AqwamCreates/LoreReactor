// src/services/HybridEngine.ts
import type { ChatData, Character, BudgetStrategy } from '../types';
import { LargeLanguageModelInferenceEngine } from './LargeLanguageModelInferenceEngine';
import { prepareRequestBody } from '../hooks/chatLogic'; // Assuming you have this helper

interface StreamStats {
  fullText: string;
  msPerToken: number;
}

interface ResponseStats {
  promptTokens: number;
  completionTokens: number;
  cacheMiss: boolean;
  cost: number;
}

interface StreamOptions {
  onToken?: (stats: StreamStats) => void;
  onFinish?: (stats: ResponseStats) => void;
}

export class HybridEngine {
  private baseEngine: LargeLanguageModelInferenceEngine;
  private activeStrategy: BudgetStrategy | null = null;
  private currentBudgetSpent: number = 0;

  constructor() {
    this.baseEngine = new LargeLanguageModelInferenceEngine();
  }

  public setStrategy(strategy: BudgetStrategy | null) {
    this.activeStrategy = strategy;
    if (!strategy) this.currentBudgetSpent = 0;
  }

  public async generateStream(
    chatData: ChatData,
    character: Character,
    imageData: string | null,
    controller: AbortController,
    options: StreamOptions
  ): Promise<string> {
    // 1. Determine which model to use based on Strategy
    let targetModel = character.sampler?.associatedModel || this.getActiveModel();
    
    if (this.activeStrategy) {
      // TODO: Implement your switching logic here
      // Example: if (contextSize > strategy.switchOnContextSize) targetModel = strategy.onlineModel;
      // Example: if (Math.random() * 100 < strategy.switchProbabilty) targetModel = strategy.onlineModel;
      
      // For now, defaulting to local if no specific logic triggered
      targetModel = this.activeStrategy.localModel; 
    }

    // 2. Prepare Request for the specific target model
    const requestBody = await prepareRequestBody(chatData, character, imageData, targetModel);

    // 3. Execute via Base Engine
    return this.baseEngine.generateStream(requestBody, controller, options);
  }

  private getActiveModel() {
    // Fallback logic if no strategy is active
    return null; 
  }
}

export const hybridEngine = new HybridEngine();