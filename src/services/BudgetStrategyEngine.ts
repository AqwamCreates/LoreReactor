// src/services/BudgetStrategyEngine.ts
import type { BudgetStrategy, ChatData, Character } from '../types';
import { LanguageModelEngine, type StreamCallbacks, type TokenStats } from './LanguageModelEngine';
import { prepareRequestBody } from '../hooks/chatLogic';
import { getCharacterImageUrl } from '../hooks/storage';

export class BudgetStrategyEngine {
  private strategy: BudgetStrategy;
  private baseEngine: LanguageModelEngine;
  public currentCost: number = 0;
  public totalTokensGenerated: number = 0;

  constructor(strategy: BudgetStrategy) {
    this.strategy = strategy;
    this.baseEngine = new LanguageModelEngine();
  }

  /**
   * Decides which model to use based on the strategy rules.
   */
  private selectModel(): { model: any, type: 'online' | 'local' } {
    const { onlineModel, localModel, switchProbabilty, maximumBudget } = this.strategy;

    // 1. Hard Budget Cap: If we exceeded the budget, force Local (Free)
    if (this.currentCost >= maximumBudget) {
      return { model: localModel, type: 'local' };
    }

    // 2. Probabilistic Switch
    if (Math.random() * 100 < switchProbabilty) {
      return { model: onlineModel, type: 'online' };
    }

    // 3. Default to Local
    return { model: localModel, type: 'local' };
  }

  /**
   * Unified generateStream that respects the Budget Strategy.
   */
  async generateStream(
    chatData: ChatData,
    character: Character,
    abortController: AbortController,
    callbacks?: StreamCallbacks,
    userImageBase64s?: string[]
  ): Promise<string> {
    
    let selection = this.selectModel();
    let attemptCount = 0;
    const maxAttempts = 2; // Allow one fallback retry

    while (attemptCount < maxAttempts && !abortController.signal.aborted) {
      const selectedModel = selection.model;

      try {
        // Prepare Image for Character
        let charImageBase64: string | null = null;
        if (character.image) {
          const url = getCharacterImageUrl(character.image);
          if (url) {
            try {
              const response = await fetch(url);
              const blob = await response.blob();
              charImageBase64 = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
              });
            } catch (e) { console.warn("Failed to load char image", e); }
          }
        }

        // Prepare Request
        const requestBody = await prepareRequestBody(chatData, character, charImageBase64, userImageBase64s);
        
        const modelContext = {
          apiKey: selectedModel.apiKey,
          backend: selectedModel.backend,
          modelPath: selectedModel.model
        };

        // Wrap callbacks to track stats
        const wrappedCallbacks: StreamCallbacks | undefined = callbacks ? {
          onToken: (stats: TokenStats) => {
            this.totalTokensGenerated++;
            callbacks.onToken(stats);
          }
        } : undefined;

        // Execute Generation
        const result = await this.baseEngine.generateStream(
          requestBody,
          abortController,
          wrappedCallbacks,
          modelContext
        );

        // Update Cost (Simplified estimation if engine doesn't return exact cost yet)
        // In a real scenario, you'd parse the 'usage' object from the API response.
        // For now, we assume a small cost increment per successful request for cloud models.
        if (selection.type === 'online') {
           // Placeholder: You should integrate real cost calculation from API usage stats
           // Example: this.currentCost += (estimatedTokens * pricePerToken);
           this.currentCost += 0.001; 
        }

        return result;

      } catch (error) {
        const err = error as Error;
        console.warn(`Model ${selectedModel.name} failed:`, err.message);

        // Fallback Logic: Only if current was Local AND fallback is enabled
        if (selection.type === 'local' && this.strategy.fallbackOnLocalFailure && attemptCount === 0) {
          console.log("Local model failed/timed out. Falling back to Online model...");
          selection = { model: this.strategy.onlineModel, type: 'online' };
          attemptCount++;
          continue; // Retry loop
        }

        // If Online fails or no fallback allowed, throw
        throw error;
      }
    }

    throw new Error("All models failed according to budget strategy.");
  }
}