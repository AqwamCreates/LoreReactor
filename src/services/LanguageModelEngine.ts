// src/services/LanguageModelEngine.ts

import { localAddress } from "../configurations";

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

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function endsWithStopPattern(text: string, stopPatterns: string[]): boolean {
  for (const pattern of stopPatterns) {
    if (pattern && text.endsWith(pattern)) return true;
  }
  return false;
}

export class LanguageModelEngine {

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
    },
    existingText?: string
  ): { url: string; headers: HeadersInit; body: string } {
    const { apiKey, backend, modelPath, runtimePort } = modelContext || {};
    const isCloud = !!apiKey && backend && CLOUD_BACKENDS.includes(backend);

    const finalPrompt = existingText && existingText.trim().length > 0
      ? `${prompt}${existingText}`
      : prompt;

    let url: string;
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    let body: string;

    if (isCloud && apiKey) {
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
        messages: [{ role: "user", content: finalPrompt }],
        stream,
        temperature: params?.temperature,
        top_p: params?.top_p,
        max_tokens: params?.maxTokens,
        stop: params?.stop,
        ...params?.extraParams,
      });

    } else if (runtimePort) {
      url = `${localAddress}:${runtimePort}/completion`;

      body = JSON.stringify({
        prompt: finalPrompt,
        n_predict: params?.maxTokens,
        temperature: params?.temperature,
        top_p: params?.top_p,
        stop: params?.stop,
        stream,
      });

    } else {
      url = '/api/completion';

      body = JSON.stringify({
        prompt: finalPrompt,
        n_predict: params?.maxTokens,
        temperature: params?.temperature,
        top_p: params?.top_p,
        stop: params?.stop,
        stream,
      });
    }

    return { url, headers, body };
  }

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

  // ✅ Accepts same requestBody as generateStream.
  // Image data is already in the body from prepareRequestBody.
  async generateCompletion(
    requestBody: any,
    modelContext?: LanguageModelContext
  ): Promise<StreamResult> {
    const { prompt, temperature, top_p, maxTokens, stop, extraParams } = this.extractFromRequestBody(requestBody);
    const stopPatterns: string[] = Array.isArray(stop) ? stop : [];

    try {
      const { url, headers } = this.resolveRequest(prompt, false, modelContext, {
        maxTokens: maxTokens ?? 512,
        temperature: temperature ?? 0.3,
        stop,
        extraParams,
      });

      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(requestBody) });
      if (!res.ok) return { text: '', isCompleted: false };

      const data = await res.json();
      const text = this.extractContent(data) || '';

      return { text, isCompleted: endsWithStopPattern(text, stopPatterns) };
    } catch (e) {
      console.warn('generateCompletion failed:', e);
      return { text: '', isCompleted: false };
    }
  }

  async countTokens(text: string, modelContext?: LanguageModelContext): Promise<number> {
    const { runtimePort } = modelContext || {};

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

  // ✅ Uses same extractFromRequestBody as generateCompletion.
  async generateStream(
    requestBody: any,
    abortController: AbortController,
    callbacks?: StreamCallbacks,
    modelContext?: LanguageModelContext,
    maxParagraphs?: number,
    existingText?: string
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
      } catch {}
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
          if (line.startsWith('data: ')) {
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

              if (token) {
                if (!hasReceivedNonWhitespace && !existingText) {
                  const trimmed = token.trimStart();
                  if (trimmed.length === 0) continue;
                  token = trimmed;
                  hasReceivedNonWhitespace = true;
                } else {
                  hasReceivedNonWhitespace = true;
                }

                const now = performance.now();
                if (newTokenCount === 0) firstTokenTime = now;
                newTokenCount++;
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
                const msPerToken = newTokenCount > 0 ? totalTime / newTokenCount : 0;
                const tokensPerSecond = totalTime > 0 ? (newTokenCount / totalTime) * 1000 : 0;

                if (callbacks?.onToken) {
                  callbacks.onToken({ fullText: fullContent, msPerToken, tokensPerSecond });
                }
              }
            } catch (e) { /* Ignore parse errors */ }
          }
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