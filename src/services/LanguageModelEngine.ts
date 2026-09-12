// src/services/LanguageModelEngine.ts
import { localAddress } from "../configurations";
import { cloudBackends, cloudEndpoints, cloudTokenizeEndpoints } from "../languageModelInformation";
import type { backend } from "../types";

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

export interface LanguageModelContext {
  apiKey?: string;
  backend?: backend;
  modelPath?: string;
  runtimePort?: number;
}

function endsWithStop_pattern(text: string, stop_patterns: string[]): boolean {
  for (const pattern of stop_patterns) {
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

const STOPUNSUPPORTEDBACKENDS = new Set(['Google']);

const NOTOKENIZEBACKENDS = new Set(['OpenRouter']);

interface TokenCacheEntry {
  count: number;
  timestamp: number;
}

const TOKENCACHETTLMS = 5 * 60 * 1000;
const TOKENCACHEMAXSIZE = 500;

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
    inputtokens?: number;
}

interface MinimaxTokenizeResponse {
    inputtokens?: number;
}

interface KimiTokenizeResponse {
    data?: { totaltokens?: number };
    totaltokens?: number;
}

interface GLMTokenizeResponse {
    usage?: { tokens?: number };
    tokens?: number;
}

interface CohereTokenizeResponse {
    tokens?: unknown[];
    tokencount?: number;
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

  // ─── Context State ────────────────────────────────────────────────

  private context: LanguageModelContext = {};

  setContext(ctx: LanguageModelContext): void {
    this.context = ctx;
  }

  getContext(): LanguageModelContext {
    return this.context;
  }

  // ─── Token Count Cache ────────────────────────────────────────────

  private tokenCache: Map<string, TokenCacheEntry> = new Map();
  private failedTokenizeBackends: Set<string> = new Set();
  private hasTokenCountChanged = false;
  private inFlightTokenize: Map<string, Promise<number>> = new Map();

  get hasTokenCountChanged(): boolean {
    const changed = this.hasTokenCountChanged;
    this.hasTokenCountChanged = false;
    return changed;
  }

  private buildCacheKey(text: string): string {
    const ctx = this.context;
    const ctxPart = `${ctx.runtimePort ?? ''}:${ctx.backend ?? ''}:${ctx.modelPath ?? ''}`;
    const textFingerprint = `${text.length}:${text.slice(0, 32)}:${text.slice(-32)}`;
    return `${ctxPart}|${textFingerprint}`;
  }

  private buildBackendFailureKey(): string | null {
    const ctx = this.context;
    if (ctx.runtimePort) return `local:${ctx.runtimePort}`;
    if (ctx.backend) return `${ctx.backend}:${ctx.modelPath ?? ''}`;
    return null;
  }

  private getCachedTokenCount(key: string): number | null {
    const entry = this.tokenCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > TOKENCACHETTLMS) {
      this.tokenCache.delete(key);
      return null;
    }
    return entry.count;
  }

  private setCachedTokenCount(key: string, count: number): void {
    if (this.tokenCache.size >= TOKENCACHEMAXSIZE && !this.tokenCache.has(key)) {
      const oldestKey = this.tokenCache.keys().next().value;
      if (oldestKey !== undefined) this.tokenCache.delete(oldestKey);
    }
    this.tokenCache.set(key, { count, timestamp: Date.now() });
    this.hasTokenCountChanged = true;
  }

  clearTokenCache(): void {
    this.tokenCache.clear();
    this.failedTokenizeBackends.clear();
    this.inFlightTokenize.clear();
    this.hasTokenCountChanged = true;
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
      maxtokens: params.maxTokens,
      ...params.extraParams,
    };

    if (!STOPUNSUPPORTEDBACKENDS.has(backendName) && params.stop && params.stop.length > 0) {
      bodyObj.stop = params.stop;
    }

    const body = JSON.stringify(bodyObj);

    return { url, headers, body };
  }

  private buildLocalRequest(
    runtimePort: number | undefined,
    prompt: string,
    stream: boolean,
    params: ResolvedParams,
  ): ResolvedRequest {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };

    const url = runtimePort
      ? `${localAddress}:${runtimePort}/completion`
      : '/api/completion';

    const body = JSON.stringify({
      prompt,
      npredict: params.maxTokens,
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

    const { apiKey, backend: backendName, modelPath, runtimePort } = this.context;

    if (apiKey && backendName && cloudBackends.includes(backendName)) {
      return this.buildCloudRequest(apiKey, backendName, modelPath, finalPrompt, stream, params);
    }

    return this.buildLocalRequest(runtimePort, finalPrompt, stream, params);
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
      maxTokens: (requestBody.npredict as number) || (requestBody.maxtokens as number),
      stop: requestBody.stop as string[] | undefined,
      extraParams: requestBody.extracloudparams as Record<string, unknown> | undefined,
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
    const ctx = this.context;

    const cacheKey = this.buildCacheKey(text);
    const cached = this.getCachedTokenCount(cacheKey);
    if (cached !== null) return cached;

    const failureKey = this.buildBackendFailureKey();
    if (failureKey && this.failedTokenizeBackends.has(failureKey)) {
      this.setCachedTokenCount(cacheKey, estimatedTokens);
      return estimatedTokens;
    }

    if (ctx.backend && NOTOKENIZEBACKENDS.has(ctx.backend)) {
      this.setCachedTokenCount(cacheKey, estimatedTokens);
      return estimatedTokens;
    }

    if (!ctx.apiKey && !ctx.runtimePort) {
      this.setCachedTokenCount(cacheKey, estimatedTokens);
      return estimatedTokens;
    }

    const { runtimePort, backend: backendName, apiKey, modelPath } = ctx;

    if (runtimePort) {
      const localKey = `local:${runtimePort}`;

      if (this.inFlightTokenize.has(localKey)) {
        await this.inFlightTokenize.get(localKey);
        const recheck = this.getCachedTokenCount(cacheKey);
        if (recheck !== null) return recheck;
        this.setCachedTokenCount(cacheKey, estimatedTokens);
        return estimatedTokens;
      }

      const fetchPromise = (async (): Promise<number> => {
        try {
          const response = await fetch(`${localAddress}:${runtimePort}/tokenize`, {
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
            case 'Anthropic': return (data as AnthropicTokenizeResponse).inputtokens ?? estimatedTokens;
            case 'Minimax': return (data as MinimaxTokenizeResponse).inputtokens ?? estimatedTokens;
            case 'Kimi': return (data as KimiTokenizeResponse).data?.totaltokens ?? (data as KimiTokenizeResponse).totaltokens ?? estimatedTokens;
            case 'GLM': return (data as GLMTokenizeResponse).usage?.tokens ?? (data as GLMTokenizeResponse).tokens ?? estimatedTokens;
            case 'Cohere': return (data as CohereTokenizeResponse).tokens?.length ?? (data as CohereTokenizeResponse).tokencount ?? estimatedTokens;
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
    const stop_patterns: string[] = Array.isArray(stop) ? stop : [];

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

      return { text, isCompleted: endsWithStop_pattern(text, stop_patterns) };
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
    const stop_patterns: string[] = Array.isArray(stop) ? stop : [];

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
            isCompleted: endsWithStop_pattern(fullContent.trim(), stop_patterns),
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
              isCompleted: endsWithStop_pattern(fullContent.trim(), stop_patterns),
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