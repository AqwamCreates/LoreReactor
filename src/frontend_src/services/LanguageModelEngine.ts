// src/frontend_src/services/LanguageModelEngine.ts
import { localAddress } from "../../configurations";
import { cloudBackends, cloudEndpoints, cloudTokenizeEndpoints, localBackends, openAiCompatibleLocalBackends } from "../dictionaries/languageModelInformation";
import type { backend, cloudBackend, LanguageModel, localBackend } from "../types";
import { getCachingStrategy } from "./ProviderCacheStrategy";
import type { OpenAIMessage as CacheOpenAIMessage } from "./ProviderCacheStrategy";

export interface TokenStats {
  fullText: string;
  msPerToken: number;
  tokensPerSecond: number;
  timeToFirstToken: number;
}

export interface StreamCallbacks {
    onToken?: (state: StreamState) => void | Promise<void>;
    onFinish?: (result: { promptTokens?: number; completionTokens?: number; cachedTokens?: number }) => void;
}

export interface StreamState {
    fullText: string;
    msPerToken: number;
    tokensPerSecond: number;
    timeToFirstToken: number;
    promptTokens?: number;
    completionTokens?: number;
    cachedTokens?: number;
}

export interface StreamResult {
  text: string;
  isCompleted: boolean;
  msPerToken?: number;
  timeToFirstToken?: number;
  completionTokens?: number;
  cachedTokens?: number;
  promptTokens?: number;
}

interface ImagePayload {
  data: string;
  id: number;
}

interface ResolvedParams {
  temperature?: number;
  top_p?: number;
  maxTokens?: number;
  stop?: string[];
  extraParams?: Record<string, unknown>;
  sessionId?: string;
  messages?: CacheOpenAIMessage[];
  imageData?: ImagePayload[];
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

interface OpenAIChoiceDelta {
    content?: string;
}

interface OpenAIChoice {
    delta?: OpenAIChoiceDelta;
    message?: { content?: string };
    finish_reason?: string | null;
}

interface OpenAIUsage {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: {
        cached_tokens?: number;
    };
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
}

interface OpenAIStreamChunk {
    type?: string;
    choices?: OpenAIChoice[];
    content?: string | unknown[];
    text?: string;
    usage?: OpenAIUsage;
    message?: {
        usage?: OpenAIUsage;
        content?: unknown[];
    };
    delta?: {
        text?: string;
        content?: string;
        stop_reason?: string | null;
    };
}

interface OpenAICompletionResponse {
    choices?: OpenAIChoice[];
    content?: string | unknown[];
    usage?: OpenAIUsage;
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

export type PeerInferenceHandler = (
  modelId: string,
  prompt: any,
  onToken: (token: string) => void,
  signal?: AbortSignal
) => Promise<boolean>;

// ─── Multimodal Message Helper ──────────────────────────────────────

function extractMessageText(content: string | unknown[]): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && (part as Record<string, unknown>).type === 'text') {
          return String((part as Record<string, unknown>).text || '');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function attachImagesToMessages(
  incomingMessages: CacheOpenAIMessage[] | undefined,
  prompt: string,
  imageData?: ImagePayload[],
): CacheOpenAIMessage[] {
  const finalMessages: CacheOpenAIMessage[] = incomingMessages && incomingMessages.length > 0
    ? incomingMessages.map((m) => ({
        ...m,
        content: Array.isArray(m.content) ? [...m.content] : m.content,
      }))
    : [{ role: 'user', content: prompt }];

  if (!imageData || imageData.length === 0) {
    return finalMessages;
  }

  let targetUserMsg = [...finalMessages].reverse().find((m) => m.role === 'user');
  if (!targetUserMsg) {
    targetUserMsg = { role: 'user', content: '' };
    finalMessages.push(targetUserMsg);
  }

  const imageParts = imageData.map((img) => {
    const raw = img.data;
    const url = raw.startsWith('data:') || raw.startsWith('http://') || raw.startsWith('https://')
      ? raw
      : `data:image/png;base64,${raw}`;
    return {
      type: 'image_url',
      image_url: { url },
    };
  });

  if (typeof targetUserMsg.content === 'string') {
    targetUserMsg.content = targetUserMsg.content
      ? [{ type: 'text', text: targetUserMsg.content }, ...imageParts]
      : imageParts;
  } else if (Array.isArray(targetUserMsg.content)) {
    targetUserMsg.content = [...targetUserMsg.content, ...imageParts];
  }

  return finalMessages;
}

// ─── Error Handling Helper ──────────────────────────────────────────

async function parseErrorResponse(response: Response, url: string, requestBody: string): Promise<string> {
  let rawText: string;
  try {
    rawText = await response.text();
  } catch {
    rawText = '(Unable to read response body)';
  }

  let parsedPayload: unknown = requestBody;
  try {
    parsedPayload = JSON.parse(requestBody);
  } catch {
    /* keep as raw string if JSON parsing fails */
  }

  // Log full error details directly to DevTools console
  console.error(`[LanguageModelEngine] Request failed: ${response.status} ${response.statusText}`, {
    url,
    requestPayload: parsedPayload,
    rawResponseBody: rawText,
  });

  let extractedMessage = rawText;
  try {
    const json = JSON.parse(rawText);
    if (typeof json === 'string') {
      extractedMessage = json;
    } else if (typeof json?.error === 'string') {
      extractedMessage = json.error;
    } else if (json?.error?.message && typeof json.error.message === 'string') {
      extractedMessage = json.error.message;
    } else if (typeof json?.detail === 'string') {
      extractedMessage = json.detail;
    } else if (Array.isArray(json?.detail)) {
      extractedMessage = json.detail
        .map((d: any) => (d && typeof d === 'object' && d.msg ? d.msg : JSON.stringify(d)))
        .join('; ');
    } else if (typeof json?.message === 'string') {
      extractedMessage = json.message;
    } else if (Array.isArray(json?.errors)) {
      extractedMessage = json.errors
        .map((e: any) => (typeof e === 'string' ? e : e?.message || JSON.stringify(e)))
        .join('; ');
    } else if (json && typeof json === 'object') {
      extractedMessage = JSON.stringify(json);
    }
  } catch {
    // rawText is already string/HTML
  }

  const statusText = response.statusText ? ` (${response.statusText})` : '';
  return `API Error ${response.status}${statusText}: ${extractedMessage || 'Unknown error'}`;
}

export class LanguageModelEngine {

  // ─── Model State ──────────────────────────────────────────────────

  private model: LanguageModel | null = null;
  private runtimePort: number | undefined = undefined;
  private runningLanguageModels: Record<string, { isRunning: boolean; port?: number }> = {};
  private peerInferenceHandler?: PeerInferenceHandler;

  setContext(model: LanguageModel): void {
    this.model = model;
    const running = model.id ? this.runningLanguageModels[model.id] : undefined;
    this.runtimePort = running?.port
      ?? (model.parameters as Record<string, unknown>)?._runtimePort as number | undefined;
  }

  getContext(): LanguageModel | null {
    return this.model;
  }

  getSelectedModelId(): string | null {
    return this.model?.id ?? null;
  }

  setRunningModels(runningLanguageModels: Record<string, { isRunning: boolean; port?: number }>): void {
    this.runningLanguageModels = runningLanguageModels;
    if (this.model) {
      const running = this.model.id ? this.runningLanguageModels[this.model.id] : undefined;
      this.runtimePort = running?.port
        ?? (this.model.parameters as Record<string, unknown>)?._runtimePort as number | undefined;
    }
  }

  setPeerInferenceHandler(handler?: PeerInferenceHandler): void {
    this.peerInferenceHandler = handler;
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
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }
    return `${ctxPart}|${text.length}:${hash}`;
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
    backendName: backend,
    modelPath: string | undefined,
    prompt: string,
    stream: boolean,
    params: ResolvedParams,
    sessionId?: string,
    incomingMessages?: CacheOpenAIMessage[],
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

    if (apiKey) {
      if (backendName === 'Inworld') {
        (headers as Record<string, string>).Authorization = `Basic ${apiKey}`;
      } else if (backendName === 'Anthropic') {
        (headers as Record<string, string>)['x-api-key'] = apiKey;
      } else {
        (headers as Record<string, string>).Authorization = `Bearer ${apiKey}`;
      }
    }

    const payloadModelName = modelPath || 'default-model';
    const messagesWithImages = attachImagesToMessages(incomingMessages, prompt, params.imageData);

    const bodyObj: Record<string, unknown> = {
      model: payloadModelName,
      messages: messagesWithImages,
      stream,
      temperature: params.temperature,
      top_p: params.top_p,
      max_tokens: params.maxTokens || 4096,
      ...params.extraParams,
    };

    if (localBackends.includes(backendName as localBackend)) {
      bodyObj.cache_prompt = true;
    }

    if (backendName === 'Anthropic') {
      if (params.stop && params.stop.length > 0) {
        bodyObj.stop_sequences = params.stop;
      }
    } else if (!STOP_UNSUPPORTED_BACKENDS.has(backendName) && params.stop && params.stop.length > 0) {
      bodyObj.stop = params.stop;
    }

    // Apply Provider Caching Strategy
    const cacheStrategy = getCachingStrategy(backendName);
    const cacheResult = cacheStrategy.apply({
      backendName,
      modelPath,
      sessionId,
      messages: messagesWithImages,
      apiKey,
    });

    if (cacheResult.headers) Object.assign(headers, cacheResult.headers);
    if (cacheResult.bodyPatch) Object.assign(bodyObj, cacheResult.bodyPatch);
    if (cacheResult.messages) bodyObj.messages = cacheResult.messages;

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

    let localPrompt = prompt;
    if (params.imageData && params.imageData.length > 0) {
      const missingMarkers = params.imageData
        .map((img) => `[img-${img.id}]`)
        .filter((marker) => !localPrompt.includes(marker));
      if (missingMarkers.length > 0) {
        localPrompt = `${missingMarkers.join('')}\n${localPrompt}`;
      }
    }

    const bodyObj: Record<string, unknown> = {
      prompt: localPrompt,
      n_predict: params.maxTokens,
      temperature: params.temperature,
      top_p: params.top_p,
      stop: params.stop,
      stream,
    };

    if (params.imageData && params.imageData.length > 0) {
      bodyObj.image_data = params.imageData.map((img) => ({
        id: img.id,
        data: img.data.replace(/^data:[^;]+;base64,/, ''),
      }));
    }

    const body = JSON.stringify(bodyObj);

    return { url, headers, body };
  }

  private buildLocalOpenAIRequest(
    port: number | undefined,
    modelPath: string | undefined,
    prompt: string,
    stream: boolean,
    params: ResolvedParams,
  ): ResolvedRequest {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };

    const baseUrl = port
      ? `${localAddress}:${port}`
      : `${localAddress}:8000`;

    const url = `${baseUrl}/v1/chat/completions`;
    const messagesWithImages = attachImagesToMessages(params.messages, prompt, params.imageData);

    const bodyObj: Record<string, unknown> = {
      model: modelPath || 'default',
      messages: messagesWithImages,
      stream,
      temperature: params.temperature,
      top_p: params.top_p,
      max_tokens: params.maxTokens,
      ...params.extraParams,
    };

    if (params.stop && params.stop.length > 0) {
      bodyObj.stop = params.stop;
    }

    const body = JSON.stringify(bodyObj);

    return { url, headers, body };
  }

  private resolveRequest(
    prompt: string,
    stream: boolean,
    params: ResolvedParams,
    existingText?: string,
  ): ResolvedRequest {
    let finalPrompt = prompt;
    if (existingText && existingText.length > 0) {
      const alreadyEmbedded = prompt.endsWith(existingText) || prompt.endsWith(`${existingText} `);
      if (!alreadyEmbedded) {
        finalPrompt = `${prompt}${existingText}`;
      }
    }

    const apiKey = this.model?.apiKey;
    const backendName = this.model?.backend;
    const modelPath = this.model?.model;

    if (apiKey && backendName && cloudBackends.includes(backendName as cloudBackend)) {
      return this.buildCloudRequest(
        apiKey, backendName, modelPath, finalPrompt, stream, params,
        params.sessionId,
        params.messages,
      );
    }

    if (backendName && openAiCompatibleLocalBackends.has(backendName)) {
      return this.buildLocalOpenAIRequest(this.runtimePort, modelPath, finalPrompt, stream, params);
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
    sessionId?: string;
    messages?: CacheOpenAIMessage[];
    imageData?: ImagePayload[];
  } {
    let prompt = (requestBody.prompt as string) || '';
    let messages: CacheOpenAIMessage[] | undefined;

    if (requestBody.messages && Array.isArray(requestBody.messages)) {
      messages = requestBody.messages as CacheOpenAIMessage[];
      if (!prompt) {
        prompt = messages
          .map((m) => extractMessageText(m.content))
          .filter((text) => text.length > 0)
          .join('\n');
      }
    }

    return {
      prompt,
      temperature: requestBody.temperature as number | undefined,
      top_p: requestBody.top_p as number | undefined,
      maxTokens: (requestBody.n_predict as number) || (requestBody.max_tokens as number),
      stop: requestBody.stop as string[] | undefined,
      extraParams: requestBody.extra_cloud_params as Record<string, unknown> | undefined,
      sessionId: requestBody.session_id as string | undefined,
      messages,
      imageData: Array.isArray(requestBody.image_data)
        ? (requestBody.image_data as ImagePayload[])
        : undefined,
    };
  }

  private extractContent(data: OpenAICompletionResponse): string | null {
    if (data.choices?.[0]?.message?.content !== undefined) {
      const content = data.choices[0].message.content;
      return content && content.length > 0 ? content : null;
    }
    if (data.content !== undefined) {
      if (typeof data.content === 'string') {
        return data.content.length > 0 ? data.content : null;
      }
      if (Array.isArray(data.content)) {
        const text = extractMessageText(data.content);
        return text && text.length > 0 ? text : null;
      }
    }
    return null;
  }

  private extractUsage(data: OpenAICompletionResponse | OpenAIStreamChunk): { promptTokens?: number; completionTokens?: number; cachedTokens?: number } {
    const usage = data.usage || (data as any).message?.usage;
    if (!usage) return {};

    const promptTokens = usage.prompt_tokens ?? usage.input_tokens;
    const completionTokens = usage.completion_tokens ?? usage.output_tokens;
    
    let cachedTokens = usage.prompt_tokens_details?.cached_tokens;
    if (cachedTokens === undefined) {
      cachedTokens = usage.cache_read_input_tokens;
    }

    return {
      promptTokens,
      completionTokens,
      cachedTokens,
    };
  }

  // ─── Token Counting ──────────────────────────────────────────────

  async countTokens(text: string): Promise<number> {
    if (!text || text.length === 0) return 0;
    const estimatedTokens = Math.ceil(text.length / 4);

    const cacheKey = this.buildCacheKey(text);
    const cached = this.getCachedTokenCount(cacheKey);
    if (cached !== null) return cached;

    // Deduplicate in-flight requests per specific text cache key
    if (this.inFlightTokenize.has(cacheKey)) {
      return this.inFlightTokenize.get(cacheKey)!;
    }

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

    // Local Tokenization
    if (this.runtimePort) {
      const localKey = `local:${this.runtimePort}`;

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
          this.inFlightTokenize.delete(cacheKey);
        }
      })();

      this.inFlightTokenize.set(cacheKey, fetchPromise);
      const count = await fetchPromise;
      this.setCachedTokenCount(cacheKey, count);
      return count;
    }

    // Cloud Tokenization
    if (backendName && apiKey && cloudTokenizeEndpoints[backendName]) {
      const cloudKey = `${backendName}:${modelPath ?? ''}`;

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
              headers['anthropic-dangerous-direct-browser-access'] = 'true';
              body = JSON.stringify({
                model: modelPath || 'claude-3-5-sonnet-20241022',
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
          this.inFlightTokenize.delete(cacheKey);
        }
      })();

      this.inFlightTokenize.set(cacheKey, fetchPromise);
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
    if (this.model?.id?.startsWith('borrowed-') && this.peerInferenceHandler) {
      let accumulated = '';
      const ok = await this.peerInferenceHandler(this.model.id, requestBody, (tok) => {
        accumulated += tok;
      });
      return { text: accumulated, isCompleted: ok };
    }

    const { prompt, temperature, top_p, maxTokens, stop, extraParams, sessionId, messages, imageData } = this.extractFromRequestBody(requestBody);

    try {
      const { url, headers, body } = this.resolveRequest(prompt, false, {
        maxTokens: maxTokens ?? 512,
        temperature: temperature ?? 0.3,
        top_p: top_p,
        stop,
        extraParams,
        sessionId,
        messages,
        imageData,
      });

      const response = await fetch(url, { method: 'POST', headers, body });
      if (!response.ok) {
        const errorMsg = await parseErrorResponse(response, url, body);
        console.warn('[LanguageModelEngine] generateCompletion failed:', errorMsg);
        return { text: '', isCompleted: false };
      }

      const data = await response.json() as OpenAICompletionResponse;
      const text = this.extractContent(data) || '';
      const usage = this.extractUsage(data);

      return { 
        text, 
        isCompleted: true,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        cachedTokens: usage.cachedTokens,
      };
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
    if (this.model?.id?.startsWith('borrowed-') && this.peerInferenceHandler) {
      let fullContent = '';
      const ok = await this.peerInferenceHandler(
        this.model.id,
        requestBody,
        (tok) => {
          if (abortController.signal.aborted) return;
          fullContent += tok;
          void callbacks?.onToken?.({
            fullText: fullContent,
            msPerToken: 0,
            tokensPerSecond: 0,
            timeToFirstToken: 0,
          });
        },
        abortController.signal
      );
      if (callbacks?.onFinish) callbacks.onFinish({});
      return { text: fullContent, isCompleted: ok };
    }

    const isContinuation = !!(existingText && existingText.length > 0);
    const paragraphLimit = (maxParagraphs && maxParagraphs > 0) ? maxParagraphs : 0;
    const { prompt, temperature, top_p, maxTokens, stop, extraParams, sessionId, messages, imageData } = this.extractFromRequestBody(requestBody);

    const { url, headers, body } = this.resolveRequest(prompt, true, {
      temperature,
      top_p,
      maxTokens,
      stop,
      extraParams,
      sessionId,
      messages,
      imageData,
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
      const errorMsg = await parseErrorResponse(response, url, body);
      throw new Error(errorMsg);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder("utf-8");
    let fullContent = "";
    let sseBuffer = "";
    let firstTokenTime = 0;
    let newNumberOfTokens = 0;
    let paragraphCount = 0;
    let hasReceivedNonWhitespace = isContinuation;
    let ttftReported = false;
    let lastMsPerToken = 0;
    let lastTimeToFirstToken = 0;
    let lastFinishReason: string | null | undefined = undefined;
    let finalUsage: { promptTokens?: number; completionTokens?: number; cachedTokens?: number } = {};

    const buildFinishResult = (isCompleted: boolean): StreamResult => {
      if (callbacks?.onFinish) {
        callbacks.onFinish({
          promptTokens: finalUsage.promptTokens,
          completionTokens: finalUsage.completionTokens,
          cachedTokens: finalUsage.cachedTokens,
        });
      }
      return {
        text: fullContent,
        isCompleted,
        msPerToken: lastMsPerToken || undefined,
        timeToFirstToken: lastTimeToFirstToken || undefined,
        completionTokens: finalUsage.completionTokens !== undefined
          ? finalUsage.completionTokens
          : (newNumberOfTokens || undefined),
        promptTokens: finalUsage.promptTokens,
        cachedTokens: finalUsage.cachedTokens,
      };
    };

    const processLine = async (line: string): Promise<'done' | 'paragraph_limit' | 'aborted' | 'continue'> => {
      if (abortController.signal.aborted) return 'aborted';
      if (!line.startsWith('data:')) return 'continue';

      const jsonStr = line.slice(5).trim();
      if (!jsonStr) return 'continue';
      if (jsonStr === '[DONE]') return 'done';

      try {
        const json = JSON.parse(jsonStr) as OpenAIStreamChunk;

        // Anthropic native SSE parsing
        if (json.type === 'message_start' && json.message?.usage) {
          const u = json.message.usage;
          finalUsage.promptTokens = u.input_tokens ?? u.prompt_tokens;
          finalUsage.cachedTokens = u.cache_read_input_tokens;
        } else if (json.type === 'message_delta') {
          if (json.usage?.output_tokens !== undefined || json.usage?.completion_tokens !== undefined) {
            finalUsage.completionTokens = json.usage.output_tokens ?? json.usage.completion_tokens;
          }
          if (json.delta?.stop_reason !== undefined) {
            lastFinishReason = json.delta.stop_reason;
          }
        } else if (json.type === 'message_stop') {
          return 'done';
        }

        if (json.usage) {
          const extracted = this.extractUsage(json);
          finalUsage = { ...finalUsage, ...extracted };
        }

        const finishReason = json.choices?.[0]?.finish_reason;
        if (finishReason !== undefined && finishReason !== null) {
          lastFinishReason = finishReason;
        }

        let token = "";
        if (json.choices?.[0]?.delta?.content !== undefined) {
          token = json.choices[0].delta.content;
        } else if (json.delta?.text !== undefined) {
          token = json.delta.text;
        } else if (json.content !== undefined) {
          token = typeof json.content === 'string' ? json.content : extractMessageText(json.content);
        } else if (json.text !== undefined) {
          token = json.text;
        }

        if (!token) return 'continue';

        if (!hasReceivedNonWhitespace && !isContinuation && fullContent.length === 0) {
          const trimmed = token.replace(/^[\r\n\t]+/, '');
          if (trimmed.length === 0) return 'continue';
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
            return 'paragraph_limit';
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
          await callbacks.onToken({
            fullText: fullContent,
            msPerToken,
            tokensPerSecond,
            timeToFirstToken,
            promptTokens: finalUsage.promptTokens,
            completionTokens: finalUsage.completionTokens,
            cachedTokens: finalUsage.cachedTokens,
          });
        }

        if (abortController.signal.aborted) {
          return 'aborted';
        }
      } catch { /* Ignore individual SSE parse errors */ }

      return 'continue';
    };

    try {
      while (true) {
        if (abortController.signal.aborted) {
          reader.cancel().catch(() => {});
          return buildFinishResult(false);
        }

        const { value, done } = await reader.read();

        if (done) {
          if (abortController.signal.aborted) {
            return buildFinishResult(false);
          }
          sseBuffer += decoder.decode();
          if (sseBuffer) {
            for (const line of sseBuffer.split(/\r?\n/)) {
              if (abortController.signal.aborted) {
                return buildFinishResult(false);
              }
              const status = await processLine(line);
              if (status === 'paragraph_limit') return buildFinishResult(true);
              if (status === 'aborted') return buildFinishResult(false);
              if (status === 'done') return buildFinishResult(lastFinishReason !== 'length');
            }
          }
          return buildFinishResult(lastFinishReason !== 'length');
        }

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split(/\r?\n/);
        sseBuffer = lines.pop() ?? '';

        for (const line of lines) {
          if (abortController.signal.aborted) {
            reader.cancel().catch(() => {});
            return buildFinishResult(false);
          }
          const status = await processLine(line);
          if (status === 'paragraph_limit') return buildFinishResult(true);
          if (status === 'aborted') {
            reader.cancel().catch(() => {});
            return buildFinishResult(false);
          }
          if (status === 'done') return buildFinishResult(lastFinishReason !== 'length');
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError' || abortController.signal.aborted) {
        return buildFinishResult(false);
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