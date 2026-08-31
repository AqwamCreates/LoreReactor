// src/services/LanguageModelEngine.ts
import { localAddress } from "../configurations";
import { cloudBackends, cloudEndpoints } from "../cloudLanguageModelInformation";

export interface TokenStats {
  fullText: string;
  msPerToken: number;
  tokensPerSecond: number;
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

export class LanguageModelEngine {

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

    const body = JSON.stringify({
      model: payloadModelName,
      messages: [{ role: "user", content: prompt }],
      stream,
      temperature: params.temperature,
      top_p: params.top_p,
      max_tokens: params.maxTokens,
      stop: params.stop,
      ...params.extraParams,
    });

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

    if (!modelContext) return estimatedTokens;

    const { runtimePort } = modelContext;
    if (!runtimePort) return estimatedTokens;

    try {
      const res = await fetch(`${localAddress}:${runtimePort}/tokenize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });

      if (!res.ok) return estimatedTokens;

      const data = await res.json();
      return data.tokens?.length ?? estimatedTokens;
    } catch {
      return estimatedTokens;
    }
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
    let newTokenCount = 0;
    let paragraphCount = 0;
    let hasReceivedNonWhitespace = false;

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

            // Strip leading whitespace from first real token
            if (!hasReceivedNonWhitespace && !existingText) {
              const trimmed = token.trimStart();
              if (trimmed.length === 0) continue;
              token = trimmed;
            }
            hasReceivedNonWhitespace = true;

            const now = performance.now();
            if (newTokenCount === 0) firstTokenTime = now;
            newTokenCount++;
            fullContent += token;

            // Paragraph limit enforcement
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

            // Speed stats
            const totalTime = now - firstTokenTime;
            const msPerToken = newTokenCount > 0 ? totalTime / newTokenCount : 0;
            const tokensPerSecond = totalTime > 0 ? (newTokenCount / totalTime) * 1000 : 0;

            if (callbacks?.onToken) {
              callbacks.onToken({ fullText: fullContent, msPerToken, tokensPerSecond });
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