// src/services/LargeLanguageModelInferenceEngine.ts

export interface TokenStats {
  fullText: string;
  msPerToken: number;
  tokensPerSecond: number;
}

export interface StreamCallbacks {
  onToken: (stats: TokenStats) => void;
}

// Define known cloud endpoints
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
  // 'Other' is handled dynamically via the model path (used as URL)
};

export class LargeLanguageModelInferenceEngine {
  
  async generateStream(
    requestBody: any, 
    abortController: AbortController, 
    callbacks?: StreamCallbacks,
    modelContext?: { apiKey?: string; backend?: string; modelPath?: string }
  ): Promise<string> {
    
    const { apiKey, backend, modelPath } = modelContext || {};
    
    // Determine if this is a cloud request
    const isCloud = !!apiKey && backend && [
      'OpenAI', 'DeepSeek', 'Qwen', 'Kimi', 'Mistral', 'Groq', 'OpenRouter', 'Inworld', 'Other'
    ].includes(backend);

    let url = '/api/completion';
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    let body = JSON.stringify(requestBody);

    // ✅ 1. Handle Cloud Backends
    if (isCloud && apiKey) {
      
      // --- Determine URL ---
      if (backend === 'Other') {
        // ✅ For "Other", the Model Path IS the Custom URL
        if (!modelPath) {
          throw new Error("Custom URL (Model Path) is required for 'Other' backend.");
        }
        url = modelPath; 
      } else {
        // Use predefined endpoint for known providers
        const defaultUrl = CLOUD_ENDPOINTS[backend];
        if (!defaultUrl) {
          throw new Error(`Unsupported cloud backend: ${backend}`);
        }
        // Allow overriding default URL via parameters if needed
        url = requestBody.api_url || defaultUrl;
      }

      // Set Cloud Headers
      // ✅ Special Handling for Inworld (Basic Auth) vs Others (Bearer)
      if (backend === 'Inworld') {
        headers.Authorization = `Basic ${apiKey}`;
      } else {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      // --- Determine Model Name & Transform Request ---
      // Priority: 1. Explicit override in params, 2. Model Path (for known providers), 3. Fallback
      let payloadModelName = 'default-model';
      
      if (requestBody.parameters?.model_name) {
        payloadModelName = requestBody.parameters.model_name;
      } else if (backend !== 'Other' && modelPath) {
        // For known providers, use the Model Path input as the model name
        payloadModelName = modelPath;
      }

      if (requestBody.prompt && !requestBody.messages) {
        const messages = [
          { role: "user", content: requestBody.prompt }
        ];
        
        body = JSON.stringify({
          model: payloadModelName, 
          messages: messages,
          stream: true,
          temperature: requestBody.temperature,
          top_p: requestBody.top_p,
          max_tokens: requestBody.n_predict || requestBody.max_tokens,
          stop: requestBody.stop,
          ...requestBody.extra_cloud_params 
        });
      } else if (requestBody.messages) {
          body = JSON.stringify({
          model: payloadModelName,
          ...requestBody,
          stream: true
        });
      }
    }

    // ✅ 2. Execute Fetch
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
            
            if (jsonStr.trim() === '[DONE]') {
              return fullContent.trim();
            }

            try {
              const json = JSON.parse(jsonStr);
              
              let token = "";
              
              // OpenAI / DeepSeek / Qwen / Kimi / Mistral / Groq / OpenRouter / Inworld
              if (json.choices?.[0]?.delta?.content !== undefined) {
                token = json.choices[0].delta.content;
              } 
              // Llama.cpp / Ollama / Legacy
              else if (json.content !== undefined) {
                token = json.content;
              }
              // Fallback
              else if (json.text !== undefined) {
                token = json.text;
              }

              if (token) {
                const now = performance.now();
                
                if (tokenCount === 0) {
                  firstTokenTime = now;
                }
                const lastTokenTime = now;
                tokenCount++;

                fullContent += token;

                const totalTime = lastTokenTime - firstTokenTime;
                const msPerToken = tokenCount > 0 ? totalTime / tokenCount : 0;
                const tokensPerSecond = totalTime > 0 ? (tokenCount / totalTime) * 1000 : 0;

                if (callbacks?.onToken) {
                  callbacks.onToken({
                    fullText: fullContent,
                    msPerToken,
                    tokensPerSecond
                  });
                }
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return fullContent.trim();
      }
      throw error;
    }

    return fullContent.trim();
  }
}