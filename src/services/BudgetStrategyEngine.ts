// src/services/BudgetStrategyEngine.ts
import type { BudgetStrategy, ChatData, Character, LanguageModel } from '../types';
import { LanguageModelEngine, type StreamCallbacks, type TokenStats } from './LanguageModelEngine';
import { prepareRequestBody } from '../hooks/chatLogic';
import { getCharacterImageUrl } from '../hooks/storage';

interface ModelSelectionResult {
  model: LanguageModel;
  type: 'online' | 'local';
  reason: 'budget_cap' | 'probability' | 'context_size' | 'complexity' | 'default';
}

export class BudgetStrategyEngine {
  private strategy: BudgetStrategy;
  private baseEngine: LanguageModelEngine;
  
  public currentCost = 0;
  public totalTokensGenerated = 0;
  public totalPromptTokens = 0;

  constructor(strategy: BudgetStrategy) {
    this.strategy = strategy;
    this.baseEngine = new LanguageModelEngine();
  }

  /**
   * Decides which model to use based on the strategy rules.
   * Priority: 
   * 1. Hard Budget Cap
   * 2. Context Size Threshold
   * 3. Complexity Score Threshold (if provided)
   * 4. Probabilistic Switch
   * 5. Default to Local
   */
  private selectModel(promptTokenCount: number, complexityScore?: number): ModelSelectionResult {
    const { 
      onlineModel, 
      localModel, 
      switchProbabilty, 
      maximumBudget, 
      switchOnContextSize, 
      switchOnComplexityScore 
    } = this.strategy;

    // 1. Hard Budget Cap: If we exceeded the budget, force Local (Free)
    if (this.currentCost >= maximumBudget) {
      return { model: localModel, type: 'local', reason: 'budget_cap' };
    }

    // 2. Context Size Threshold: If prompt is too large for local (or defined threshold), go Online
    if (switchOnContextSize > 0 && promptTokenCount > switchOnContextSize) {
      return { model: onlineModel, type: 'online', reason: 'context_size' };
    }

    // 3. Complexity Score Threshold: If task is complex, go Online
    if (switchOnComplexityScore > 0 && (complexityScore ?? 0) >= switchOnComplexityScore) {
      return { model: onlineModel, type: 'online', reason: 'complexity' };
    }

    // 4. Probabilistic Switch
    if (Math.random() * 100 < switchProbabilty) {
      return { model: onlineModel, type: 'online', reason: 'probability' };
    }

    // 5. Default to Local
    return { model: localModel, type: 'local', reason: 'default' };
  }

  /**
   * Calculates cost based on model pricing and token usage.
   */
  private calculateCost(model: LanguageModel, promptTokens: number, completionTokens: number): number {
    const cacheHitRatio = 0; // Simplified: assume 0 for now unless engine reports cache hits specifically per request
    // In a real scenario, you'd pass cache hit info from the engine. 
    // For now, we treat all prompt tokens as misses for safety, or split if known.
    
    const promptCost = (promptTokens / 1_000_000) * (model.cacheMissCostPerOneMillionOfTokens || 0);
    const completionCost = (completionTokens / 1_000_000) * (model.outputGenerationCostPerOneMillionOfTokens || 0);
    
    return promptCost + completionCost;
  }

  /**
   * Unified generateStream that respects the Budget Strategy.
   * Implements fallback logic if local fails and online is allowed.
   */
  async generateStream(
    chatData: ChatData,
    character: Character,
    abortController: AbortController,
    callbacks?: StreamCallbacks,
    complexityScore?: number // Optional hint for complexity
  ): Promise<string> {
    
    // We need an initial prompt estimate to make the selection decision.
    // We'll build the request body first to count tokens if possible, or estimate.
    // Note: This requires a slight refactor to get token count BEFORE streaming starts.
    // For now, we do a "dry run" estimation or assume default behavior if count isn't available immediately.
    
    let attemptCount = 0;
    const maxAttempts = this.strategy.fallbackOnLocalFailure ? 2 : 1;
    let lastError: Error | null = null;

    // Prepare Image for Character once

    while (attemptCount < maxAttempts && !abortController.signal.aborted) {
      try {
        // 1. Prepare Request Body (needed for token estimation and sending)
        const requestBody = await prepareRequestBody(chatData, character);
        
        // 2. Estimate Prompt Tokens (using local engine if available, else char count)
        // We need a temporary context to count. If using online model, we might not have port.
        // Fallback to estimation if counting fails.
        let promptTokenCount = 0;
        if (this.strategy.localModel.parameters?._runtimePort) {
           promptTokenCount = await this.baseEngine.countTokens(requestBody.prompt, { 
             runtimePort: this.strategy.localModel.parameters._runtimePort 
           });
        } else {
           // Fallback estimation
           promptTokenCount = Math.ceil(requestBody.prompt.length / 4);
        }

        // 3. Select Model based on current state and rules
        const selection = this.selectModel(promptTokenCount, complexityScore);
        const selectedModel = selection.model;

        console.log(`Selected ${selection.type} model (${selectedModel.name}) due to: ${selection.reason}`);

        const modelContext = {
          apiKey: selectedModel.apiKey,
          backend: selectedModel.backend,
          modelPath: selectedModel.model,
          runtimePort: selectedModel.parameters?._runtimePort as number | undefined
        };

        // Track stats for this specific request
        let requestPromptTokens = 0;
        let requestCompletionTokens = 0;

        // Wrap callbacks to track tokens and update costs in real-time if possible
        // Note: Accurate cost usually happens AFTER stream finishes when we have total tokens.
        const wrappedCallbacks: StreamCallbacks | undefined = callbacks ? {
          onToken: (stats: TokenStats) => {
            // We can't know exact cost per token until we know if it's cache hit/miss fully,
            // but we can track volume.
            callbacks.onToken(stats);
          }
        } : undefined;

        // 4. Execute Generation
        const result = await this.baseEngine.generateStream(
          requestBody,
          abortController,
          wrappedCallbacks,
          modelContext
        );

        // 5. Post-Generation Cost Calculation
        // The baseEngine doesn't return usage stats in the string result directly in current impl.
        // We must estimate completion tokens from the result string.
        requestCompletionTokens = Math.ceil(result.length / 4); 
        requestPromptTokens = promptTokenCount; // Use the pre-calculated one

        if (selection.type === 'online') {
          const cost = this.calculateCost(selectedModel, requestPromptTokens, requestCompletionTokens);
          this.currentCost += cost;
          this.totalTokensGenerated += requestCompletionTokens;
          this.totalPromptTokens += requestPromptTokens;
          console.log(`Added $${cost.toFixed(6)} to budget. Total: $${this.currentCost.toFixed(4)}`);
        } else {
          // Local models are free in this logic, but we still track tokens
          this.totalTokensGenerated += requestCompletionTokens;
          this.totalPromptTokens += requestPromptTokens;
        }

        return result;

      } catch (error) {
        const err = error as Error;
        lastError = err;
        console.warn(`Model attempt ${attemptCount + 1} failed:`, err.message);

        // Fallback Logic: Only if current was Local AND fallback is enabled AND we haven't retried yet
        const wasLocalAttempt = attemptCount === 0; // First attempt is usually local by default logic unless forced
        
        // Check if we actually tried local. If probability forced online first, we shouldn't fallback to local necessarily
        // unless the strategy implies online is primary fallback. 
        // Standard pattern: Try Local -> Fail -> Try Online.
        
        if (wasLocalAttempt && this.strategy.fallbackOnLocalFailure) {
          console.log("Local model failed. Retrying with Online model...");
          attemptCount++;
          continue; // Retry loop with Online model selected next iteration
        }

        // If Online fails, or fallback disabled, break and throw
        break;
      }
    }

    throw lastError || new Error("All models failed according to budget strategy.");
  }
}