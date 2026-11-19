// src/frontend_src/services/VoiceTranscriptionEngine.ts
import { speechToTextEngine } from './SpeechToTextEngine';
import { uploadCharacterVoice } from '../storages/serverStorage';

export interface TranscriptionResult {
    success: boolean;
    voiceFilename?: string;
    transcript?: string;
    language?: string;
}

class VoiceTranscriptionEngine {
    private queue: Array<{
        characterId: string; 
        file: File;
        language?: string; 
        resolve: (r: TranscriptionResult) => void; 
        reject: (e: any) => void
    }> = [];
    private isProcessing = false;

    async enqueueTranscription(characterId: string, file: File, language?: string): Promise<TranscriptionResult> {
        return new Promise((resolve, reject) => {
            this.queue.push({ characterId, file, language, resolve, reject });
            this.processQueue();
        });
    }

    private async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const task = this.queue.shift()!;
            try {
                // 1. Upload the audio file to the backend storage
                const filename = await uploadCharacterVoice(task.characterId, task.file);
                
                // 2. Transcribe locally using Whisper
                const transcript = await speechToTextEngine.transcribeFile(task.file, task.language);
                
                task.resolve({
                    success: true,
                    voiceFilename: filename,
                    transcript: transcript || '',
                    language: task.language
                });
            } catch (err) {
                console.error('[VoiceTranscriptionEngine] Transcription/Upload failed:', err);
                task.resolve({ success: false }); 
            }
        }
        this.isProcessing = false;
        speechToTextEngine.unloadIfInactive()
    }
}

export const voiceTranscriptionEngine = new VoiceTranscriptionEngine();