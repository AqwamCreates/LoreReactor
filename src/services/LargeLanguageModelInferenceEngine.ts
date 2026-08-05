export interface TokenStats {
  fullText: string;
  msPerToken: number;
  tokensPerSecond: number;
}

export interface StreamCallbacks {
  onToken: (stats: TokenStats) => void;
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

export class LargeLanguageModelInferenceEngine {
  
  async generateStream(
    requestBody: any, 
    abortController: AbortController, 
    callbacks?: StreamCallbacks,
    modelContext?: { apiKey?: string; backend?: string; modelPath?: string; runtimePort?: number }
  ): Promise<string> {
    
    const { apiKey, backend, modelPath, runtimePort } = modelContext || {};
    
    const isCloud = !!apiKey && backend && [
      'OpenAI', 'DeepSeek', 'Qwen', 'Kimi', 'Mistral', 'Groq', 'OpenRouter', 'Inworld', 'Other'
    ].includes(backend);

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
        url = requestBody.api_url || defaultUrl;
      }

      if (backend === 'Inworld') {
        headers.Authorization = `Basic ${apiKey}`;
      } else {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      let payloadModelName = 'default-model';
      if (requestBody.parameters?.model_name) {
        payloadModelName = requestBody.parameters.model_name;
      } else if (backend !== 'Other' && modelPath) {
        payloadModelName = modelPath;
      }

      if (requestBody.prompt && !requestBody.messages) {
        body = JSON.stringify({
          model: payloadModelName,
          messages: [{ role: "user", content: requestBody.prompt }],
          stream: true,
          temperature: requestBody.temperature,
          top_p: requestBody.top_p,
          max_tokens: requestBody.n_predict || requestBody.max_tokens,
          stop: requestBody.stop,
          ...requestBody.extra_cloud_params
        });
      } else if (requestBody.messages) {
        body = JSON.stringify({ model: payloadModelName, ...requestBody, stream: true });
      } else {
        body = JSON.stringify(requestBody);
      }

    } else if (runtimePort) {
      // ✅ LOCAL MODEL: Direct connection to llama-server /completion
      url = `http://127.0.0.1:${runtimePort}/completion`;
      
      // Ensure body is in llama.cpp native completion format
      if (requestBody.messages && !requestBody.prompt) {
        const lastUserMsg = [...requestBody.messages].reverse().find((m: any) => m.role === 'user');
        requestBody.prompt = lastUserMsg?.content || '';
        delete requestBody.messages;
        delete requestBody.model;
      }
      
      requestBody.stream = true;
      body = JSON.stringify(requestBody);

    } else {
      // Fallback: Vite proxy
      url = '/api/completion';
      body = JSON.stringify(requestBody);
    }

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