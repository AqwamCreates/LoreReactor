// src/services/LargeLanguageModelInferenceEngine.ts

import { localAddress } from "../configurations";

export interface TokenStats {
  fullText: string;
  msPerToken: number;
  tokensPerSecond: number;
}

export interface StreamCallbacks {
  onToken: (stats: TokenStats) => void;
}

export interface LanguageModelContext {
  apiKey?: string;
  backend?: string;
  modelPath?: string;
  runtimePort?: number;
}

const CLOUD_ENDPOINTS: Record<string, string> = {
  'DeepSeek': 'https://api.deepseek.com/chat/completions',
  'Qwen': 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  'Kimi': 'https://api.moonshot.ai/v1/chat/completions',
  'GLM': 'https://api.z.ai/api/paas/v4/chat/completions',
  'MiMo': 'https://api.xiaomimimo.com/v1/chat/completions',
  'OpenAI': 'https://api.openai.com/v1/chat/completions',
  'Mistral': 'https://api.mistral.ai/v1/chat/completions',
  'Groq': 'https://api.groq.com/openai/v1/chat/completions',
  'YandexGPT': 'https://ai.api.cloud.yandex.net/v1/chat/completions',
  'OpenRouter': 'https://openrouter.ai/api/v1/chat/completions',
  'Inworld': 'https://api.inworld.ai/v1/chat/completions',
};

const CLOUD_BACKENDS = [
  'OpenAI', 'DeepSeek', 'Qwen', 'Kimi', 'Mistral', 'Groq', 'OpenRouter', 'Inworld', 'Other'
];

/**
 * Synchronous estimation fallback when async isn't available.
 * Uses ~4 chars per token as a rough average for most models.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class LanguageModelEngine {

  /**
   * ✅ Single source of truth for resolving URL, headers, and body.
   * Used by both generateStream and generateCompletion.
   */
  private resolveRequest(
    prompt: string,
    stream: boolean,
    modelContext?: LanguageModelContext,
    params?: {
      temperature?: number;
      top_p?: number;
      maxTokens?: number;
      stop?: string[];
      extraParams?: Record<string, unknown>;
    }
  ): { url: string; headers: HeadersInit; body: string } {
    const { apiKey, backend, modelPath, runtimePort } = modelContext || {};
    const isCloud = !!apiKey && backend && CLOUD_BACKENDS.includes(backend);

    let url: string;
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    let body: string;

    if (isCloud && apiKey) {
      // --- Cloud Backend ---
      if (backend === 'Other') {
        if (!modelPath) throw new Error("Custom URL (Model Path) is required for 'Other' backend.");
        url = modelPath;
      } else {
        const defaultUrl = CLOUD_ENDPOINTS[backend];
        if (!defaultUrl) throw new Error(`Unsupported cloud backend: ${backend}`);
        url = defaultUrl;
      }

      if (backend === 'Inworld') {
        headers.Authorization = `Basic ${apiKey}`;
      } else {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      const payloadModelName = modelPath || 'default-model';

      body = JSON.stringify({
        model: payloadModelName,
        messages: [{ role: "user", content: prompt }],
        stream,
        temperature: params?.temperature,
        top_p: params?.top_p,
        max_tokens: params?.maxTokens,
        stop: params?.stop,
        ...params?.extraParams,
      });

    } else if (runtimePort) {
      // --- Local llama-server ---
      url = `${localAddress}:${runtimePort}/completion`;

      body = JSON.stringify({
        prompt,
        n_predict: params?.maxTokens,
        temperature: params?.temperature,
        top_p: params?.top_p,
        stop: params?.stop,
        stream,
      });

    } else {
      // --- Fallback: Vite proxy ---
      url = '/api/completion';

      body = JSON.stringify({
        prompt,
        n_predict: params?.maxTokens,
        temperature: params?.temperature,
        top_p: params?.top_p,
        stop: params?.stop,
        stream,
      });
    }

    return { url, headers, body };
  }

  /**
   * ✅ Extracts text content from either OpenAI-compatible or llama.cpp response format.
   */
  private extractContent(data: any): string | null {
    // OpenAI-compatible format (cloud + some local wrappers)
    if (data.choices?.[0]?.message?.content !== undefined) {
      const content = data.choices[0].message.content?.trim();
      return content && content.length > 0 ? content : null;
    }
    // llama.cpp native completion format
    if (data.content !== undefined) {
      const content = data.content?.trim();
      return content && content.length > 0 ? content : null;
    }
    return null;
  }

  /**
   * ✅ Non-streaming completion for internal use (summarization, compression).
   */
  async generateCompletion(
    prompt: string,
    modelContext?: LanguageModelContext,
    options: {
      maxTokens?: number;
      temperature?: number;
      stop?: string[];
    } = {}
  ): Promise<string | null> {
    const { maxTokens = 512, temperature = 0.3, stop } = options;

    try {
      const { url, headers, body } = this.resolveRequest(prompt, false, modelContext, {
        maxTokens,
        temperature,
        stop,
      });

      const res = await fetch(url, { method: 'POST', headers, body });
      if (!res.ok) return null;

      const data = await res.json();
      return this.extractContent(data);
    } catch (e) {
      console.warn('generateCompletion failed:', e);
      return null;
    }
  }

  /**
   * ✅ Counts tokens using llama-server's /tokenize endpoint.
   * Falls back to character-based estimation if unavailable.
   * Only works for local models — cloud APIs don't expose /tokenize.
   */
  async countTokens(text: string, modelContext?: LanguageModelContext): Promise<number> {
    const { runtimePort } = modelContext || {};

    // Cloud models or no port → fall back to estimation
    if (!runtimePort) return estimateTokens(text);

    try {
      const res = await fetch(`${localAddress}:${runtimePort}/tokenize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });

      if (!res.ok) return estimateTokens(text);

      const data = await res.json();
      return data.tokens?.length ?? estimateTokens(text);
    } catch {
      return estimateTokens(text);
    }
  }

  /**
   * ✅ Streaming generation for chat responses.
   */
  async generateStream(
    requestBody: any,
    abortController: AbortController,
    callbacks?: StreamCallbacks,
    modelContext?: LanguageModelContext,
    maxParagraphs?: number
  ): Promise<string> {
    const paragraphLimit = (maxParagraphs && maxParagraphs > 0) ? maxParagraphs : 0;

    // Extract prompt from requestBody — handle both native and messages format
    let prompt = requestBody.prompt || '';
    if (!prompt && requestBody.messages) {
      const lastUserMsg = [...requestBody.messages].reverse().find((m: any) => m.role === 'user');
      prompt = lastUserMsg?.content || '';
    }

    const { url, headers, body } = this.resolveRequest(prompt, true, modelContext, {
      temperature: requestBody.temperature,
      top_p: requestBody.top_p,
      maxTokens: requestBody.n_predict || requestBody.max_tokens,
      stop: requestBody.stop,
      extraParams: requestBody.extra_cloud_params,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: abortController.signal,
    });

    if (!response.ok) {
      if (abortController.signal.aborted) throw new Error('Aborted');
      let errorMsg = `API Error: ${response.status}`;
      try {
        const errData = await response.json();
        if (errData.error?.message) errorMsg = `API Error: ${errData.error.message}`;
      } catch {}
      throw new Error(errorMsg);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder("utf-8");
    let fullContent = "";
    let firstTokenTime = 0;
    let tokenCount = 0;
    let paragraphCount = 0;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            if (jsonStr.trim() === '[DONE]') return fullContent.trim();

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

              if (token) {
                const now = performance.now();
                if (tokenCount === 0) firstTokenTime = now;
                tokenCount++;
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
                    return fullContent.trim();
                  }
                }

                const totalTime = now - firstTokenTime;
                const msPerToken = tokenCount > 0 ? totalTime / tokenCount : 0;
                const tokensPerSecond = totalTime > 0 ? (tokenCount / totalTime) * 1000 : 0;

                if (callbacks?.onToken) {
                  callbacks.onToken({ fullText: fullContent, msPerToken, tokensPerSecond });
                }
              }
            } catch (e) { /* Ignore parse errors */ }
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return fullContent.trim();
      throw error;
    }

    return fullContent.trim();
  }
}