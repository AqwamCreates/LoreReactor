// src/services/LanguageModelEngine.ts
import { localAddress } from "../configurations";
import { cloudBackends, cloudEndpoints, cloudTokenizeEndpoints } from "../languageModelInformation";

export interface TokenStats {
  fullText: string;
  msPerToken: number;
  tokensPerSecond: number;
  timeToFirstToken: number;
}

export interface StreamCallbacks {
  onToken: (stats: TokenStats) => void;
}

export interface StreamResult {
  text: string;
  isCompleted: boolean;
}

export interface LanguageModelContext {
  apiKey?: string;
  backend?: string;
  modelPath?: string;
  runtimePort?: number;
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

// ✅ Backends that don't support the `stop` parameter in OpenAI-compatible format
const STOP_UNSUPPORTED_BACKENDS = new Set(['Google']);

  /**
   * Backends known to lack a tokenize endpoint. We skip network calls
   * for these entirely and always return the char-length estimate.
   * Add any backend here whose /tokenize returns 404 or doesn't exist.
   */

const NO_TOKENIZE_BACKENDS = new Set(['OpenRouter',]);

/** Cache entry for token count results. */
interface TokenCacheEntry {
  count: number;
  timestamp: number;
}

/** Maximum age of a cache entry before it's considered stale (5 minutes). */
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

/** Maximum number of entries to prevent unbounded memory growth. */
const TOKEN_CACHE_MAX_SIZE = 500;

export class LanguageModelEngine {

  // ─── Token Count Cache ────────────────────────────────────────────

  /**
   * Private cache mapping a composite key (text fingerprint + model context identifier)
   * to the resolved token count. Prevents redundant network calls when the same
   * text is counted repeatedly across renders.
   */
  private _tokenCache: Map<string, TokenCacheEntry> = new Map();

  /**
   * Tracks backends whose tokenize endpoints have returned errors.
   * Once a backend fails, we skip network calls entirely and use estimates.
   * Key format: "backend:modelPath" or "local:runtimePort".
   */
  private _failedTokenizeBackends: Set<string> = new Set();

  /** Whether the cache contents have changed since last access. */
  private _hasTokenCountChanged = false;

  /**
   * In-flight tokenize requests keyed by backend failure key.
   * Concurrent calls for the same backend share a single promise,
   * preventing duplicate network requests during race conditions.
   */
  private _inFlightTokenize: Map<string, Promise<number>> = new Map();

  /** Returns true if the token cache has been modified since the last call to this getter. Resets the flag on read. */
  get hasTokenCountChanged(): boolean {
    const changed = this._hasTokenCountChanged;
    this._hasTokenCountChanged = false;
    return changed;
  }

  /** Builds a stable cache key from text and optional model context. */
  private buildCacheKey(text: string, modelContext?: LanguageModelContext): string {
    const ctxPart = modelContext
      ? `${modelContext.runtimePort ?? ''}:${modelContext.backend ?? ''}:${modelContext.modelPath ?? ''}`
      : 'estimate';
    const textFingerprint = `${text.length}:${text.slice(0, 32)}:${text.slice(-32)}`;
    return `${ctxPart}|${textFingerprint}`;
  }

  /** Builds a failure-tracking key from model context. */
  private buildBackendFailureKey(modelContext?: LanguageModelContext): string | null {
    if (!modelContext) return null;
    if (modelContext.runtimePort) return `local:${modelContext.runtimePort}`;
    if (modelContext.backend) return `${modelContext.backend}:${modelContext.modelPath ?? ''}`;
    return null;
  }

  /** Retrieves a cached token count if the entry exists and is not stale. */
  private getCachedTokenCount(key: string): number | null {
    const entry = this._tokenCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > TOKEN_CACHE_TTL_MS) {
      this._tokenCache.delete(key);
      return null;
    }
    return entry.count;
  }

  /** Stores a token count in the cache, evicting oldest entries if at capacity. */
  private setCachedTokenCount(key: string, count: number): void {
    if (this._tokenCache.size >= TOKEN_CACHE_MAX_SIZE && !this._tokenCache.has(key)) {
      const oldestKey = this._tokenCache.keys().next().value;
      if (oldestKey !== undefined) this._tokenCache.delete(oldestKey);
    }
    this._tokenCache.set(key, { count, timestamp: Date.now() });
    this._hasTokenCountChanged = true;
  }

  /** Clears the entire token cache, failure set, and in-flight map. Call when switching models or invalidating state. */
  clearTokenCache(): void {
    this._tokenCache.clear();
    this._failedTokenizeBackends.clear();
    this._inFlightTokenize.clear();
    this._hasTokenCountChanged = true;
  }

  // ─── Request Building (split by transport type) ──────────────────

  private buildCloudRequest(
    apiKey: string,
    backend: string,
    modelPath: string | undefined,
    prompt: string,
    stream: boolean,
    params: ResolvedParams,
  ): ResolvedRequest {
    let url: string;
    const headers: HeadersInit = { 'Content-Type': 'application/json' };

    if (backend === 'Other') {
      if (!modelPath) throw new Error("Custom URL (Model Path) is required for 'Other' backend.");
      url = modelPath;
    } else {
      const defaultUrl = cloudEndpoints[backend];
      if (!defaultUrl) throw new Error(`Unsupported cloud backend: ${backend}`);
      url = defaultUrl;
    }

    if (backend === 'Inworld') {
      headers.Authorization = `Basic ${apiKey}`;
    } else {
      headers.Authorization = `Bearer ${apiKey}`;
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

    if (!STOP_UNSUPPORTED_BACKENDS.has(backend) && params.stop && params.stop.length > 0) {
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
    modelContext?: LanguageModelContext,
    params?: ResolvedParams,
    existingText?: string,
  ): ResolvedRequest {
    const finalPrompt = existingText && existingText.trim().length > 0
      ? `${prompt}${existingText}`
      : prompt;

    const resolvedParams: ResolvedParams = params || {};
    const { apiKey, backend, modelPath, runtimePort } = modelContext || {};

    if (apiKey && backend && cloudBackends.includes(backend)) {
      return this.buildCloudRequest(apiKey, backend, modelPath, finalPrompt, stream, resolvedParams);
    }

    return this.buildLocalRequest(runtimePort, finalPrompt, stream, resolvedParams);
  }

  // ─── Response Parsing ────────────────────────────────────────────

  private extractFromRequestBody(requestBody: any): {
    prompt: string;
    temperature?: number;
    top_p?: number;
    maxTokens?: number;
    stop?: string[];
    extraParams?: Record<string, unknown>;
  } {
    let prompt = requestBody.prompt || '';
    if (!prompt && requestBody.messages) {
      const lastUserMsg = [...requestBody.messages].reverse().find((m: any) => m.role === 'user');
      prompt = lastUserMsg?.content || '';
    }

    return {
      prompt,
      temperature: requestBody.temperature,
      top_p: requestBody.top_p,
      maxTokens: requestBody.n_predict || requestBody.max_tokens,
      stop: requestBody.stop,
      extraParams: requestBody.extra_cloud_params,
    };
  }

  private extractContent(data: any): string | null {
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

  async countTokens(text: string, modelContext?: LanguageModelContext): Promise<number> {
    const estimatedTokens = Math.ceil(text.length / 4);

    // ✅ Check token cache first
    const cacheKey = this.buildCacheKey(text, modelContext);
    const cached = this.getCachedTokenCount(cacheKey);
    if (cached !== null) return cached;

    // ✅ If this backend previously failed, skip straight to estimate
    const failureKey = this.buildBackendFailureKey(modelContext);
    if (failureKey && this._failedTokenizeBackends.has(failureKey)) {
      this.setCachedTokenCount(cacheKey, estimatedTokens);
      return estimatedTokens;
    }

    // ✅ Skip network call entirely for backends known to lack a tokenize endpoint
    if (modelContext?.backend && NO_TOKENIZE_BACKENDS.has(modelContext.backend)) {
      this.setCachedTokenCount(cacheKey, estimatedTokens);
      return estimatedTokens;
    }

    if (!modelContext) {
      this.setCachedTokenCount(cacheKey, estimatedTokens);
      return estimatedTokens;
    }

    const { runtimePort, backend, apiKey, modelPath } = modelContext;

    // ✅ Local models: use llama.cpp /tokenize endpoint
    if (runtimePort) {
      const localKey = `local:${runtimePort}`;

      if (this._inFlightTokenize.has(localKey)) {
        await this._inFlightTokenize.get(localKey);
        const recheck = this.getCachedTokenCount(cacheKey);
        if (recheck !== null) return recheck;
        this.setCachedTokenCount(cacheKey, estimatedTokens);
        return estimatedTokens;
      }

      const fetchPromise = (async (): Promise<number> => {
        try {
          const res = await fetch(`${localAddress}:${runtimePort}/tokenize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: text }),
          });
          if (!res.ok) {
            if (res.status === 404 || res.status >= 500) {
              this._failedTokenizeBackends.add(localKey);
            }
            return estimatedTokens;
          }
          const data = await res.json();
          return data.tokens?.length ?? estimatedTokens;
        } catch {
          this._failedTokenizeBackends.add(localKey);
          return estimatedTokens;
        } finally {
          this._inFlightTokenize.delete(localKey);
        }
      })();

      this._inFlightTokenize.set(localKey, fetchPromise);
      const count = await fetchPromise;
      this.setCachedTokenCount(cacheKey, count);
      return count;
    }

    // ✅ Cloud models: try provider-specific tokenize endpoint
    if (backend && apiKey && cloudTokenizeEndpoints[backend]) {
      const cloudKey = `${backend}:${modelPath ?? ''}`;

      if (this._inFlightTokenize.has(cloudKey)) {
        await this._inFlightTokenize.get(cloudKey);
        const recheck = this.getCachedTokenCount(cacheKey);
        if (recheck !== null) return recheck;
        this.setCachedTokenCount(cacheKey, estimatedTokens);
        return estimatedTokens;
      }

      const fetchPromise = (async (): Promise<number> => {
        try {
          const templateUrl = cloudTokenizeEndpoints[backend];
          const headers: HeadersInit = { 'Content-Type': 'application/json' };
          let url = templateUrl;
          let body: string;

          switch (backend) {
            case 'Google': {
              const modelName = modelPath || 'gemini-2.5-flash';
              url = templateUrl.replace('{model}', modelName) + `?key=${apiKey}`;
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
              // OpenRouter has no tokenize endpoint — should never reach here
              // due to NO_TOKENIZE_BACKENDS check above, but guard defensively
              return estimatedTokens;
            }
            default:
              return estimatedTokens;
          }

          const res = await fetch(url, { method: 'POST', headers, body });
          if (!res.ok) {
            if (res.status === 404 || res.status >= 500) {
              this._failedTokenizeBackends.add(cloudKey);
            }
            return estimatedTokens;
          }
          const data = await res.json();

          switch (backend) {
            case 'Google': return data.totalTokens ?? estimatedTokens;
            case 'Anthropic': return data.input_tokens ?? estimatedTokens;
            case 'Minimax': return data.input_tokens ?? estimatedTokens;
            case 'Kimi': return data.data?.total_tokens ?? data.total_tokens ?? estimatedTokens;
            case 'GLM': return data.usage?.tokens ?? data.tokens ?? estimatedTokens;
            case 'Cohere': return data.tokens?.length ?? data.token_count ?? estimatedTokens;
            case 'AI21': return data.tokens?.length ?? data.count ?? estimatedTokens;
            case 'NovelAI': return data.tokens?.length ?? data.count ?? estimatedTokens;
            case 'OpenRouter': return estimatedTokens;
            default: return estimatedTokens;
          }
        } catch {
          this._failedTokenizeBackends.add(cloudKey);
          return estimatedTokens;
        } finally {
          this._inFlightTokenize.delete(cloudKey);
        }
      })();

      this._inFlightTokenize.set(cloudKey, fetchPromise);
      const count = await fetchPromise;
      this.setCachedTokenCount(cacheKey, count);
      return count;
    }

    this.setCachedTokenCount(cacheKey, estimatedTokens);
    return estimatedTokens;
  }

  // ─── Non-Streaming Completion ────────────────────────────────────

  async generateCompletion(
    requestBody: any,
    modelContext?: LanguageModelContext,
  ): Promise<StreamResult> {
    const { prompt, temperature, top_p, maxTokens, stop, extraParams } = this.extractFromRequestBody(requestBody);
    const stopPatterns: string[] = Array.isArray(stop) ? stop : [];

    try {
      const { url, headers, body } = this.resolveRequest(prompt, false, modelContext, {
        maxTokens: maxTokens ?? 512,
        temperature: temperature ?? 0.3,
        stop,
        extraParams,
      });

      const res = await fetch(url, { method: 'POST', headers, body });
      if (!res.ok) return { text: '', isCompleted: false };

      const data = await res.json();
      const text = this.extractContent(data) || '';

      return { text, isCompleted: endsWithStopPattern(text, stopPatterns) };
    } catch (e) {
      console.warn('generateCompletion failed:', e);
      return { text: '', isCompleted: false };
    }
  }

  // ─── Streaming Generation ────────────────────────────────────────

  async generateStream(
    requestBody: any,
    abortController: AbortController,
    callbacks?: StreamCallbacks,
    modelContext?: LanguageModelContext,
    maxParagraphs?: number,
    existingText?: string,
  ): Promise<StreamResult> {
    const paragraphLimit = (maxParagraphs && maxParagraphs > 0) ? maxParagraphs : 0;
    const { prompt, temperature, top_p, maxTokens, stop, extraParams } = this.extractFromRequestBody(requestBody);
    const stopPatterns: string[] = Array.isArray(stop) ? stop : [];

    const { url, headers, body } = this.resolveRequest(prompt, true, modelContext, {
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
        const errData = await response.json();
        if (errData.error?.message) errorMsg = `API Error: ${errData.error.message}`;
      } catch { /* ignore parse errors */ }
      throw new Error(errorMsg);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder("utf-8");
    let fullContent = existingText || "";
    let firstTokenTime = 0;
    let newnumberOfTokens = 0;
    let paragraphCount = 0;
    let hasReceivedNonWhitespace = false;
    let ttftReported = false;

    if (existingText && existingText.trim().length > 0) {
      paragraphCount = (existingText.match(/\n\n/g) || []).length;
    }

    try {
      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          return { text: fullContent.trim(), isCompleted: endsWithStopPattern(fullContent.trim(), stopPatterns) };
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6);
          if (jsonStr.trim() === '[DONE]') {
            return { text: fullContent.trim(), isCompleted: endsWithStopPattern(fullContent.trim(), stopPatterns) };
          }

          try {
            const json = JSON.parse(jsonStr);
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
            if (newnumberOfTokens === 0) firstTokenTime = now;
            newnumberOfTokens++;
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
                return { text: fullContent.trim(), isCompleted: true };
              }
            }

            const totalTime = now - firstTokenTime;
            const msPerToken = newnumberOfTokens > 0 ? totalTime / newnumberOfTokens : 0;
            const tokensPerSecond = totalTime > 0 ? (newnumberOfTokens / totalTime) * 1000 : 0;

            const timeToFirstToken = !ttftReported ? now - requestStartTime : 0;
            if (!ttftReported) ttftReported = true;

            if (callbacks?.onToken) {
              callbacks.onToken({ fullText: fullContent, msPerToken, tokensPerSecond, timeToFirstToken });
            }
          } catch { /* Ignore individual SSE parse errors */ }
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return { text: fullContent.trim(), isCompleted: false };
      }
      throw error;
    }
  }
}