// src/services/HybridEngine.ts
import type { ChatData, Character, BudgetStrategy } from '../types';
import { LanguageModelEngine } from './LanguageModelEngine';
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
  private baseEngine: LanguageModelEngine;
  private activeStrategy: BudgetStrategy | null = null;
  private currentBudgetSpent: number = 0;

  constructor() {
    this.baseEngine = new LanguageModelEngine();
  }

  public setStrategy(strategy: BudgetStrategy | null) {
    this.activeStrategy = strategy;
    if (!strategy) this.currentBudgetSpent = 0;
  }

  public async generateStream(
    chatData: ChatData,
    character: Character,
    controller: AbortController,
    options: StreamOptions
  ): Promise<string> {
    // 1. Determine which model to use based on Strategy
    let targetModel = this.activeStrategy?.localModel ?? null;
    
    if (this.activeStrategy) {
      // TODO: Implement your switching logic here
      // Example: if (contextSize > strategy.switchOnContextSize) targetModel = strategy.onlineModel;
      // Example: if (Math.random() * 100 < strategy.switchProbabilty) targetModel = strategy.onlineModel;
      
      // For now, defaulting to local if no specific logic triggered
      targetModel = this.activeStrategy.localModel; 
    }

    // 2. Prepare Request for the specific target model
    const requestBody = await prepareRequestBody(chatData, character, targetModel);

    // 3. Execute via Base Engine
    const callbacks = {
      onToken: options.onToken ?? (() => {}),
      onFinish: options.onFinish ?? (() => {}),
    };

    return this.baseEngine.generateStream(requestBody, controller, callbacks);
  }
}

export const hybridEngine = new HybridEngine();