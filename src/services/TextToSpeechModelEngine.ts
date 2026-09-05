// src/services/TextToSpeechModelInferenceEngine.ts

export interface TextToSpeedLanguageModelContext {
  serverUrl?: string;   // e.g., "http://localhost:7860"
  apiKey?: string;      // For cloud TTS APIs (future)
  backend?: 'Qwen3-TTS' | 'Browser' | 'Other';
}

export interface TextToSpeedSynthesizeOptions {
  voice?: string;       // Voice label (uploaded file prefix or built-in speaker name)
  language?: string;    // Language hint (for future multi-backend support)
}

export class TextToSpeechModelEngine {

  /**
   * ✅ Synthesizes speech from text using the configured TTS backend.
   * Returns an audio Blob (WAV format) or null on failure.
   */
  async synthesize(
    text: string,
    modelContext?: TextToSpeedLanguageModelContext,
    options?: TextToSpeedSynthesizeOptions
  ): Promise<Blob | null> {
    const { serverUrl } = modelContext || {};
    const { voice } = options || {};

    // --- Qwen3-TTS Server Backend ---
    if (serverUrl) {
      try {
        const params = new URLSearchParams();
        params.set('text', text);
        if (voice) params.set('voice', voice);

        const url = `${serverUrl}/synthesize_speech/?${params.toString()}`;

        const res = await fetch(url);
        if (!res.ok) {
          console.warn(`TTS synthesis failed: ${res.status}`);
          return null;
        }

        return await res.blob();
      } catch (e) {
        console.warn('TTS synthesis failed:', e);
        return null;
      }
    }

    // --- Browser Web Speech API Fallback ---
    return this.synthesizeBrowser(text, voice);
  }

  /**
   * ✅ Uploads a reference audio file to the TTS server for voice cloning.
   * Returns true on success.
   */
  async uploadVoice(
    label: string,
    file: File,
    modelContext?: TextToSpeedLanguageModelContext
  ): Promise<boolean> {
    const { serverUrl } = modelContext || {};
    if (!serverUrl) return false;

    try {
      const formData = new FormData();
      formData.append('audio_file_label', label);
      formData.append('file', file);

      const res = await fetch(`${serverUrl}/upload_audio/`, {
        method: 'POST',
        body: formData,
      });

      return res.ok;
    } catch (e) {
      console.warn('TTS voice upload failed:', e);
      return false;
    }
  }

  /**
   * ✅ Converts the voice of an existing audio file to a target speaker.
   * Returns an audio Blob or null on failure.
   */
  async changeVoice(
    audioFile: File,
    targetVoice: string,
    modelContext?: TextToSpeedLanguageModelContext
  ): Promise<Blob | null> {
    const { serverUrl } = modelContext || {};
    if (!serverUrl) return null;

    try {
      const formData = new FormData();
      formData.append('reference_speaker', targetVoice);
      formData.append('file', audioFile);

      const res = await fetch(`${serverUrl}/change_voice/`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) return null;
      return await res.blob();
    } catch (e) {
      console.warn('TTS voice conversion failed:', e);
      return null;
    }
  }

  /**
   * ✅ Checks if the TTS server is reachable.
   */
  async isServerAvailable(modelContext?: TextToSpeedLanguageModelContext): Promise<boolean> {
    const { serverUrl } = modelContext || {};
    if (!serverUrl) return false;

    try {
      const res = await fetch(`${serverUrl}/base_tts/?text=ping`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * ✅ Browser Web Speech API fallback when no server is configured.
   */
  private synthesizeBrowser(
    text: string,
    voiceName?: string,
  ): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        resolve(null);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);

      // Try to match requested voice
      if (voiceName) {
        const voices = window.speechSynthesis.getVoices();
        const match = voices.find(v =>
          v.name.toLowerCase().includes(voiceName.toLowerCase())
        );
        if (match) utterance.voice = match;
      }

      // Web Speech API doesn't natively return audio blobs.
      // We use an AudioContext + MediaRecorder workaround where available,
      // but for now just speak directly and return null (no blob).
      // Future: use MediaStream capture for blob output.
      utterance.onend = () => resolve(null);
      utterance.onerror = () => resolve(null);

      window.speechSynthesis.speak(utterance);
    });
  }
}