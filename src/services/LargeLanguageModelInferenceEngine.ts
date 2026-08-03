export interface TokenStats {
  fullText: string;
  msPerToken: number;
  tokensPerSecond: number;
}

export interface StreamCallbacks {
  onToken: (stats: TokenStats) => void;
}

export class LargeLanguageModelInferenceEngine {
  
  async generateStream(
    requestBody: any, 
    abortController: AbortController, 
    callbacks?: StreamCallbacks
  ): Promise<string> {
    
    const response = await fetch('/api/completion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: abortController.signal,
    });

    if (!response.ok) {
      if (abortController.signal.aborted) throw new Error('Aborted');
      throw new Error(`API Error: ${response.status}`);
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
              // Final stats calculation
              return fullContent.trim();
            }

            try {
              const json = JSON.parse(jsonStr);
              const token = json.content || json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || "";
              
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
              console.warn("Parse error", e);
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