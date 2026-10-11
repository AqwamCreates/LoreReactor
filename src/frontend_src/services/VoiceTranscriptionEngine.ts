// frontend_src/services/VoiceTranscriptionEngine.ts
import { speechToTextEngine } from './SpeechToTextEngine';
import { uploadCharacterVoice, loadRawCharacter, saveRawCharacter } from '../storages/serverStorage';

class VoiceTranscriptionEngine {
    private queue: Array<{characterId: string; file: File; resolve: (s: boolean) => void; reject: (e: any) => void}> = [];
    private isProcessing = false;

    async enqueueTranscription(characterId: string, file: File): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.queue.push({ characterId, file, resolve, reject });
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
                
                // 2. Transcribe locally using Whisper (Auto-detects language)
                const transcript = await speechToTextEngine.transcribeFile(task.file);
                
                // 3. Update the character's voice data with the filename and transcript
                const character = await loadRawCharacter(task.characterId);
                if (character) {
                    character.voice = {
                        voiceFilename: filename,
                        textContent: transcript || ''
                    };
                    await saveRawCharacter(character);
                }
                
                task.resolve(true);
            } catch (err) {
                console.error('[VoiceTranscriptionEngine] Transcription/Upload failed:', err);
                task.reject(err);
            }
        }
        this.isProcessing = false;
    }

    isReady(): boolean { return true; }
    isUsingWebGpu(): boolean { return false; }
    getError(): string | null { return null; }
}

export const voiceTranscriptionEngine = new VoiceTranscriptionEngine();