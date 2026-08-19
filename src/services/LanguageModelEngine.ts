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

export class LanguageModelEngine {

  /**
   * Resolves URL, headers, and body for all backends.
   * 
   * @param existingText - Partial assistant text to continue from.
   *   Appended directly to the prompt string for ALL backends since
   *   prepareRequestBody builds a flat completion prompt, not a messages array.
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
    },
    existingText?: string
  ): { url: string; headers: HeadersInit; body: string } {
    const { apiKey, backend, modelPath, runtimePort } = modelContext || {};
    const isCloud = !!apiKey && backend && CLOUD_BACKENDS.includes(backend);

    // ✅ Append existing text to prompt for continuation (all backends)
    // The prompt from prepareRequestBody ends with "{Character X: "
    // so appending existing text produces "{Character X: <partial text>"
    // which tells the model to continue from that exact point.
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

      // ✅ Cloud APIs receive the full prompt (with existing text appended) as a single user message.
      // This is correct because prepareRequestBody builds a completion-style prompt,
      // not a conversational messages array. The model sees the entire context including
      // the partial assistant response at the end and continues from there.
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

  async generateCompletion(
    prompt: string,
    modelContext?: LanguageModelContext,
    options: {
      maxTokens?: number;
      temperature?: number;
      stop?: string[];
    } = {},
    imageData?: { data: string; id: number }[]
  ): Promise<string | null> {
    const { maxTokens = 512, temperature = 0.3, stop } = options;

    try {
      const { url, headers, body: bodyStr } = this.resolveRequest(prompt, false, modelContext, {
        maxTokens,
        temperature,
        stop,
      });

      let finalBody = bodyStr;
      if (imageData && imageData.length > 0) {
        const bodyObj = JSON.parse(bodyStr);
        bodyObj.image_data = imageData;
        finalBody = JSON.stringify(bodyObj);
      }

      const res = await fetch(url, { method: 'POST', headers, body: finalBody });
      if (!res.ok) return null;

      const data = await res.json();
      return this.extractContent(data);
    } catch (e) {
      console.warn('generateCompletion failed:', e);
      return null;
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

  async generateStream(
    requestBody: any,
    abortController: AbortController,
    callbacks?: StreamCallbacks,
    modelContext?: LanguageModelContext,
    maxParagraphs?: number,
    existingText?: string
  ): Promise<string> {
    const paragraphLimit = (maxParagraphs && maxParagraphs > 0) ? maxParagraphs : 0;

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
    }, existingText);

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
                if (!hasReceivedNonWhitespace) {
                  const trimmed = token.trimStart();
                  if (trimmed.length === 0) {
                    continue;
                  }
                  token = trimmed;
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
                    return fullContent.trim();
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
      if ((error as Error).name === 'AbortError') return fullContent.trim();
      throw error;
    }

    return fullContent.trim();
  }
}