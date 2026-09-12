// src/services/LanguageModelEngine.ts
import { localAddress } from "../configurations";
import { cloudBackends, cloudEndpoints, cloudTokenizeEndpoints } from "../languageModelInformation";
import type { LanguageModel } from "../types";

export interface TokenStats {
  fullText: string;
  msPerToken: number;
  tokensPerSecond: number;
  timeToFirstToken: number;
}

export interface StreamCallbacks {
    onToken?: (state: StreamState) => void | Promise<void>;
    onFinish?: (result: { promptTokens?: number; completionTokens?: number; cacheMiss?: boolean }) => void;
}

export interface StreamState {
    fullText: string;
    msPerToken: number;
    tokensPerSecond: number;
    timeToFirstToken: number;
    promptTokens?: number;
    completionTokens?: number;
    cacheMiss?: boolean;
}

export interface StreamResult {
  text: string;
  isCompleted: boolean;
  msPerToken?: number;
  timeToFirstToken?: number;
  completionTokens?: number;
}

function endsWithStopPattern(text: string, stopPatterns: string[]): boolean {
  for (const pattern of stopPatterns) {
    if (pattern && text.endsWith(pattern)) return true;
  }
  return false;
}

interface ResolvedParams {
  temperature?: number;
  top_p?: number;
  maxTokens?: number;
  stop?: string[];
  extraParams?: Record<string, unknown>;
}

interface ResolvedRequest {
  url: string;
  headers: HeadersInit;
  body: string;
}

const STOP_UNSUPPORTED_BACKENDS = new Set(['Google']);
const NO_TOKENIZE_BACKENDS = new Set(['OpenRouter']);

interface TokenCacheEntry {
  count: number;
  timestamp: number;
}

const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;
const TOKEN_CACHE_MAX_SIZE = 500;

// ─── Raw API response shapes ────────────────────────────────────────

interface OpenAIMessage {
    role: string;
    content: string;
}

interface OpenAIChoiceDelta {
    content?: string;
}

interface OpenAIChoice {
    delta?: OpenAIChoiceDelta;
    message?: { content?: string };
}

interface OpenAIStreamChunk {
    choices?: OpenAIChoice[];
    content?: string;
    text?: string;
}

interface OpenAICompletionResponse {
    choices?: OpenAIChoice[];
    content?: string;
}

interface TokenizeResponse {
    tokens?: unknown[];
}

interface GoogleTokenizeResponse {
    totalTokens?: number;
}

interface AnthropicTokenizeResponse {
    input_tokens?: number;
}

interface MinimaxTokenizeResponse {
    input_tokens?: number;
}

interface KimiTokenizeResponse {
    data?: { total_tokens?: number };
    total_tokens?: number;
}

interface GLMTokenizeResponse {
    usage?: { tokens?: number };
    tokens?: number;
}

interface CohereTokenizeResponse {
    tokens?: unknown[];
    token_count?: number;
}

interface AI21TokenizeResponse {
    tokens?: unknown[];
    count?: number;
}

interface NovelAITokenizeResponse {
    tokens?: unknown[];
    count?: number;
}

interface CloudErrorData {
    error?: { message?: string };
}

export class LanguageModelEngine {

  // ─── Model State ──────────────────────────────────────────────────

  private model: LanguageModel | null = null;
  private runtimePort: number | undefined = undefined;
  private runningModels: Record<string, { isRunning: boolean; port?: number }> = {};

  /**
   * Set the active model. Resolves runtime port internally from stored running models.
   * This is the single entry point for telling the engine which model to use.
   */
  setContext(model: LanguageModel): void {
    this.model = model;
    const running = model.id ? this.runningModels[model.id] : undefined;
    this.runtimePort = running?.port
      ?? (model.parameters as Record<string, unknown>)?._runtimePort as number | undefined;
  }

  getContext(): LanguageModel | null {
    return this.model;
  }

  getSelectedModelId(): string | null {
    return this.model?.id ?? null;
  }

  /**
   * Update running models state so setContext can resolve runtime ports.
   * Call this whenever running models change.
   */
  setRunningModels(runningModels: Record<string, { isRunning: boolean; port?: number }>): void {
    this.runningModels = runningModels;
    // Re-resolve runtime port if a model is already set
    if (this.model) {
      const running = this.model.id ? this.runningModels[this.model.id] : undefined;
      this.runtimePort = running?.port
        ?? (this.model.parameters as Record<string, unknown>)?._runtimePort as number | undefined;
    }
  }

  // ─── Token Count Cache ────────────────────────────────────────────

  private tokenCache: Map<string, TokenCacheEntry> = new Map();
  private failedTokenizeBackends: Set<string> = new Set();
  private hasTokenCountChangedFlag = false;
  private inFlightTokenize: Map<string, Promise<number>> = new Map();

  get hasTokenCountChanged(): boolean {
    const changed = this.hasTokenCountChangedFlag;
    this.hasTokenCountChangedFlag = false;
    return changed;
  }

  private buildCacheKey(text: string): string {
    const ctxPart = `${this.runtimePort ?? ''}:${this.model?.backend ?? ''}:${this.model?.model ?? ''}`;
    const textFingerprint = `${text.length}:${text.slice(0, 32)}:${text.slice(-32)}`;
    return `${ctxPart}|${textFingerprint}`;
  }

  private buildBackendFailureKey(): string | null {
    if (this.runtimePort) return `local:${this.runtimePort}`;
    if (this.model?.backend) return `${this.model.backend}:${this.model.model ?? ''}`;
    return null;
  }

  private getCachedTokenCount(key: string): number | null {
    const entry = this.tokenCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > TOKEN_CACHE_TTL_MS) {
      this.tokenCache.delete(key);
      return null;
    }
    return entry.count;
  }

  private setCachedTokenCount(key: string, count: number): void {
    if (this.tokenCache.size >= TOKEN_CACHE_MAX_SIZE && !this.tokenCache.has(key)) {
      const oldestKey = this.tokenCache.keys().next().value;
      if (oldestKey !== undefined) this.tokenCache.delete(oldestKey);
    }
    this.tokenCache.set(key, { count, timestamp: Date.now() });
    this.hasTokenCountChangedFlag = true;
  }

  clearTokenCache(): void {
    this.tokenCache.clear();
    this.failedTokenizeBackends.clear();
    this.inFlightTokenize.clear();
    this.hasTokenCountChangedFlag = true;
  }

  // ─── Request Building ─────────────────────────────────────────────

  private buildCloudRequest(
    apiKey: string,
    backendName: string,
    modelPath: string | undefined,
    prompt: string,
    stream: boolean,
    params: ResolvedParams,
  ): ResolvedRequest {
    let url: string;
    const headers: HeadersInit = { 'Content-Type': 'application/json' };

    if (backendName === 'Other') {
      if (!modelPath) throw new Error("Custom URL (Model Path) is required for 'Other' backend.");
      url = modelPath;
    } else {
      const defaultUrl = cloudEndpoints[backendName];
      if (!defaultUrl) throw new Error(`Unsupported cloud backend: ${backendName}`);
      url = defaultUrl;
    }

    if (backendName === 'Inworld') {
      (headers as Record<string, string>).Authorization = `Basic ${apiKey}`;
    } else {
      (headers as Record<string, string>).Authorization = `Bearer ${apiKey}`;
    }

    const payloadModelName = modelPath || 'default-model';

    const bodyObj: Record<string, unknown> = {
      model: payloadModelName,
      messages: [{ role: "user", content: prompt }],
      stream,
      temperature: params.temperature,
      top_p: params.top_p,
      max_tokens: params.maxTokens,
      ...params.extraParams,
    };

    if (!STOP_UNSUPPORTED_BACKENDS.has(backendName) && params.stop && params.stop.length > 0) {
      bodyObj.stop = params.stop;
    }

    const body = JSON.stringify(bodyObj);

    return { url, headers, body };
  }

  private buildLocalRequest(
    port: number | undefined,
    prompt: string,
    stream: boolean,
    params: ResolvedParams,
  ): ResolvedRequest {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };

    const url = port
      ? `${localAddress}:${port}/completion`
      : '/api/completion';

    const body = JSON.stringify({
      prompt,
      n_predict: params.maxTokens,
      temperature: params.temperature,
      top_p: params.top_p,
      stop: params.stop,
      stream,
    });

    return { url, headers, body };
  }

  private resolveRequest(
    prompt: string,
    stream: boolean,
    params: ResolvedParams,
    existingText?: string,
  ): ResolvedRequest {
    const finalPrompt = existingText && existingText.trim().length > 0
      ? `${prompt}${existingText}`
      : prompt;

    const apiKey = this.model?.apiKey;
    const backendName = this.model?.backend;
    const modelPath = this.model?.model;

    if (apiKey && backendName && cloudBackends.includes(backendName)) {
      return this.buildCloudRequest(apiKey, backendName, modelPath, finalPrompt, stream, params);
    }

    return this.buildLocalRequest(this.runtimePort, finalPrompt, stream, params);
  }

  // ─── Response Parsing ────────────────────────────────────────────

  private extractFromRequestBody(requestBody: Record<string, unknown>): {
    prompt: string;
    temperature?: number;
    top_p?: number;
    maxTokens?: number;
    stop?: string[];
    extraParams?: Record<string, unknown>;
  } {
    let prompt = (requestBody.prompt as string) || '';
    if (!prompt && requestBody.messages) {
      const messages = requestBody.messages as OpenAIMessage[];
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
      prompt = lastUserMsg?.content || '';
    }

    return {
      prompt,
      temperature: requestBody.temperature as number | undefined,
      top_p: requestBody.top_p as number | undefined,
      maxTokens: (requestBody.n_predict as number) || (requestBody.max_tokens as number),
      stop: requestBody.stop as string[] | undefined,
      extraParams: requestBody.extra_cloud_params as Record<string, unknown> | undefined,
    };
  }

  private extractContent(data: OpenAICompletionResponse): string | null {
    if (data.choices?.[0]?.message?.content !== undefined) {
      const content = data.choices[0].message.content?.trim();
      return content && content.length > 0 ? content : null;
    }
    if (data.content !== undefined) {
      const content = data.content?.trim();
      return content && content.length > 0 ? content : null;
    }
    return null;
  }

  // ─── Token Counting ──────────────────────────────────────────────

  async countTokens(text: string): Promise<number> {
    const estimatedTokens = Math.ceil(text.length / 4);

    const cacheKey = this.buildCacheKey(text);
    const cached = this.getCachedTokenCount(cacheKey);
    if (cached !== null) return cached;

    const failureKey = this.buildBackendFailureKey();
    if (failureKey && this.failedTokenizeBackends.has(failureKey)) {
      this.setCachedTokenCount(cacheKey, estimatedTokens);
      return estimatedTokens;
    }

    const backendName = this.model?.backend;
    if (backendName && NO_TOKENIZE_BACKENDS.has(backendName)) {
      this.setCachedTokenCount(cacheKey, estimatedTokens);
      return estimatedTokens;
    }

    const apiKey = this.model?.apiKey;
    if (!apiKey && !this.runtimePort) {
      this.setCachedTokenCount(cacheKey, estimatedTokens);
      return estimatedTokens;
    }

    const modelPath = this.model?.model;

    if (this.runtimePort) {
      const localKey = `local:${this.runtimePort}`;

      if (this.inFlightTokenize.has(localKey)) {
        await this.inFlightTokenize.get(localKey);
        const recheck = this.getCachedTokenCount(cacheKey);
        if (recheck !== null) return recheck;
        this.setCachedTokenCount(cacheKey, estimatedTokens);
        return estimatedTokens;
      }

      const fetchPromise = (async (): Promise<number> => {
        try {
          const response = await fetch(`${localAddress}:${this.runtimePort}/tokenize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: text }),
          });
          if (!response.ok) {
            if (response.status === 404 || response.status >= 500) {
              this.failedTokenizeBackends.add(localKey);
            }
            return estimatedTokens;
          }
          const data = await response.json() as TokenizeResponse;
          return data.tokens?.length ?? estimatedTokens;
        } catch {
          this.failedTokenizeBackends.add(localKey);
          return estimatedTokens;
        } finally {
          this.inFlightTokenize.delete(localKey);
        }
      })();

      this.inFlightTokenize.set(localKey, fetchPromise);
      const count = await fetchPromise;
      this.setCachedTokenCount(cacheKey, count);
      return count;
    }

    if (backendName && apiKey && cloudTokenizeEndpoints[backendName]) {
      const cloudKey = `${backendName}:${modelPath ?? ''}`;

      if (this.inFlightTokenize.has(cloudKey)) {
        await this.inFlightTokenize.get(cloudKey);
        const recheck = this.getCachedTokenCount(cacheKey);
        if (recheck !== null) return recheck;
        this.setCachedTokenCount(cacheKey, estimatedTokens);
        return estimatedTokens;
      }

      const fetchPromise = (async (): Promise<number> => {
        try {
          const templateUrl = cloudTokenizeEndpoints[backendName];
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          let url = templateUrl;
          let body: string;

          switch (backendName) {
            case 'Google': {
              const modelName = modelPath || 'gemini-2.5-flash';
              url = `${templateUrl.replace('{model}', modelName)}?key=${apiKey}`;
              body = JSON.stringify({ contents: [{ parts: [{ text }] }] });
              break;
            }
            case 'Anthropic': {
              headers['x-api-key'] = apiKey;
              headers['anthropic-version'] = '2023-06-01';
              body = JSON.stringify({
                model: modelPath || 'claude-sonnet-4-20250514',
                messages: [{ role: 'user', content: text }],
              });
              break;
            }
            case 'Minimax': {
              headers.Authorization = `Bearer ${apiKey}`;
              body = JSON.stringify({ model: modelPath || 'MiniMax-M3', input: text });
              break;
            }
            case 'Kimi': {
              headers.Authorization = `Bearer ${apiKey}`;
              body = JSON.stringify({
                model: modelPath || 'moonshot-v1-8k',
                messages: [{ role: 'user', content: text }],
              });
              break;
            }
            case 'GLM': {
              headers.Authorization = `Bearer ${apiKey}`;
              body = JSON.stringify({ model: modelPath || 'glm-4-flash', prompt: text });
              break;
            }
            case 'Cohere': {
              headers.Authorization = `Bearer ${apiKey}`;
              body = JSON.stringify({ text, model: modelPath || 'command-r-plus' });
              break;
            }
            case 'AI21': {
              headers.Authorization = `Bearer ${apiKey}`;
              body = JSON.stringify({ text });
              break;
            }
            case 'NovelAI': {
              headers.Authorization = `Bearer ${apiKey}`;
              body = JSON.stringify({ text, model: modelPath || 'clio-v1' });
              break;
            }
            case 'OpenRouter': {
              return estimatedTokens;
            }
            default:
              return estimatedTokens;
          }

          const response = await fetch(url, { method: 'POST', headers, body });
          if (!response.ok) {
            if (response.status === 404 || response.status >= 500) {
              this.failedTokenizeBackends.add(cloudKey);
            }
            return estimatedTokens;
          }
          const data = await response.json();

          switch (backendName) {
            case 'Google': return (data as GoogleTokenizeResponse).totalTokens ?? estimatedTokens;
            case 'Anthropic': return (data as AnthropicTokenizeResponse).input_tokens ?? estimatedTokens;
            case 'Minimax': return (data as MinimaxTokenizeResponse).input_tokens ?? estimatedTokens;
            case 'Kimi': return (data as KimiTokenizeResponse).data?.total_tokens ?? (data as KimiTokenizeResponse).total_tokens ?? estimatedTokens;
            case 'GLM': return (data as GLMTokenizeResponse).usage?.tokens ?? (data as GLMTokenizeResponse).tokens ?? estimatedTokens;
            case 'Cohere': return (data as CohereTokenizeResponse).tokens?.length ?? (data as CohereTokenizeResponse).token_count ?? estimatedTokens;
            case 'AI21': return (data as AI21TokenizeResponse).tokens?.length ?? (data as AI21TokenizeResponse).count ?? estimatedTokens;
            case 'NovelAI': return (data as NovelAITokenizeResponse).tokens?.length ?? (data as NovelAITokenizeResponse).count ?? estimatedTokens;
            default: return estimatedTokens;
          }
        } catch {
          this.failedTokenizeBackends.add(cloudKey);
          return estimatedTokens;
        } finally {
          this.inFlightTokenize.delete(cloudKey);
        }
      })();

      this.inFlightTokenize.set(cloudKey, fetchPromise);
      const count = await fetchPromise;
      this.setCachedTokenCount(cacheKey, count);
      return count;
    }

    this.setCachedTokenCount(cacheKey, estimatedTokens);
    return estimatedTokens;
  }

  // ─── Non-Streaming Completion ────────────────────────────────────

  async generateCompletion(
    requestBody: Record<string, unknown>,
  ): Promise<StreamResult> {
    const { prompt, temperature, top_p, maxTokens, stop, extraParams } = this.extractFromRequestBody(requestBody);
    const stopPatterns: string[] = Array.isArray(stop) ? stop : [];

    try {
      const { url, headers, body } = this.resolveRequest(prompt, false, {
        maxTokens: maxTokens ?? 512,
        temperature: temperature ?? 0.3,
        top_p: top_p,
        stop,
        extraParams,
      });

      const response = await fetch(url, { method: 'POST', headers, body });
      if (!response.ok) return { text: '', isCompleted: false };

      const data = await response.json() as OpenAICompletionResponse;
      const text = this.extractContent(data) || '';

      return { text, isCompleted: endsWithStopPattern(text, stopPatterns) };
    } catch (e) {
      console.warn('generateCompletion failed:', e);
      return { text: '', isCompleted: false };
    }
  }

  // ─── Streaming Generation ────────────────────────────────────────

  async generateStream(
    requestBody: Record<string, unknown>,
    abortController: AbortController,
    callbacks?: StreamCallbacks,
    maxParagraphs?: number,
    existingText?: string,
  ): Promise<StreamResult> {
    const paragraphLimit = (maxParagraphs && maxParagraphs > 0) ? maxParagraphs : 0;
    const { prompt, temperature, top_p, maxTokens, stop, extraParams } = this.extractFromRequestBody(requestBody);
    const stopPatterns: string[] = Array.isArray(stop) ? stop : [];

    const { url, headers, body } = this.resolveRequest(prompt, true, {
      temperature,
      top_p,
      maxTokens,
      stop,
      extraParams,
    }, existingText);

    const requestStartTime = performance.now();

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: abortController.signal,
    });

    if (!response.ok) {
      if (abortController.signal.aborted) return { text: '', isCompleted: false };
      let errorMsg = `API Error: ${response.status}`;
      try {
        const errData = await response.json() as CloudErrorData;
        if (errData.error?.message) errorMsg = `API Error: ${errData.error.message}`;
      } catch { /* ignore parse errors */ }
      throw new Error(errorMsg);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder("utf-8");
    let fullContent = existingText || "";
    let firstTokenTime = 0;
    let newNumberOfTokens = 0;
    let paragraphCount = 0;
    let hasReceivedNonWhitespace = false;
    let ttftReported = false;
    let lastMsPerToken = 0;
    let lastTimeToFirstToken = 0;

    if (existingText && existingText.trim().length > 0) {
      paragraphCount = (existingText.match(/\n\n/g) || []).length;
    }

    try {
      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          return {
            text: fullContent.trim(),
            isCompleted: endsWithStopPattern(fullContent.trim(), stopPatterns),
            msPerToken: lastMsPerToken || undefined,
            timeToFirstToken: lastTimeToFirstToken || undefined,
            completionTokens: newNumberOfTokens || undefined,
          };
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6);
          if (jsonStr.trim() === '[DONE]') {
            return {
              text: fullContent.trim(),
              isCompleted: endsWithStopPattern(fullContent.trim(), stopPatterns),
              msPerToken: lastMsPerToken || undefined,
              timeToFirstToken: lastTimeToFirstToken || undefined,
              completionTokens: newNumberOfTokens || undefined,
            };
          }

          try {
            const json = JSON.parse(jsonStr) as OpenAIStreamChunk;
            let token = "";

            if (json.choices?.[0]?.delta?.content !== undefined) {
              token = json.choices[0].delta.content;
            } else if (json.content !== undefined) {
              token = json.content;
            } else if (json.text !== undefined) {
              token = json.text;
            }

            if (!token) continue;

            if (!hasReceivedNonWhitespace && !existingText) {
              const trimmed = token.trimStart();
              if (trimmed.length === 0) continue;
              token = trimmed;
            }
            hasReceivedNonWhitespace = true;

            const now = performance.now();
            if (newNumberOfTokens === 0) firstTokenTime = now;
            newNumberOfTokens++;
            fullContent += token;

            if (paragraphLimit > 0) {
              const prevLength = fullContent.length - token.length;
              const prevContent = fullContent.substring(0, prevLength);
              const prevParagraphs = (prevContent.match(/\n\n/g) || []).length;
              const currentParagraphs = (fullContent.match(/\n\n/g) || []).length;

              if (currentParagraphs > prevParagraphs) {
                paragraphCount = currentParagraphs;
              }

              if (paragraphCount >= paragraphLimit) {
                abortController.abort();
                return {
                  text: fullContent.trim(),
                  isCompleted: true,
                  msPerToken: lastMsPerToken || undefined,
                  timeToFirstToken: lastTimeToFirstToken || undefined,
                  completionTokens: newNumberOfTokens || undefined,
                };
              }
            }

            const totalTime = now - firstTokenTime;
            const msPerToken = newNumberOfTokens > 0 ? totalTime / newNumberOfTokens : 0;
            const tokensPerSecond = totalTime > 0 ? (newNumberOfTokens / totalTime) * 1000 : 0;

            const timeToFirstToken = !ttftReported ? now - requestStartTime : 0;
            if (!ttftReported) ttftReported = true;

            lastMsPerToken = msPerToken;
            lastTimeToFirstToken = timeToFirstToken;

            if (callbacks?.onToken) {
              callbacks.onToken({ fullText: fullContent, msPerToken, tokensPerSecond, timeToFirstToken });
            }
          } catch { /* Ignore individual SSE parse errors */ }
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return {
          text: fullContent.trim(),
          isCompleted: false,
          msPerToken: lastMsPerToken || undefined,
          timeToFirstToken: lastTimeToFirstToken || undefined,
          completionTokens: newNumberOfTokens || undefined,
        };
      }
      throw error;
    }
  }
}

// ─── Singleton Accessor ──────────────────────────────────────────────

let instance: LanguageModelEngine | null = null;

export function getLanguageModelEngine(): LanguageModelEngine {
    if (instance) return instance;
    const engine = new LanguageModelEngine();
    instance = engine;
    return engine;
}

export function reset(): void {
    if (instance) {
        instance.clearTokenCache();
    }
    instance = null;
}