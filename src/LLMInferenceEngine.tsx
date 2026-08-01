export interface StreamCallbacks {
  onToken: (currentChunk: string) => void;
}

export class LLMInferenceEngine {
  
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
            const token = json.content || json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || "";
            
            if (token) {
              fullContent += token;
              if (callbacks?.onToken) {
                callbacks.onToken(fullContent);
              }
            }
          } catch (e) {
            console.warn("Parse error", e);
          }
        }
      }
    }

    return fullContent.trim();
  }
}