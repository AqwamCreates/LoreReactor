// frontend_src/services/VoiceCloningEngine.ts
import { localURL } from '../../configurations';
import type { deviceType } from '../types';

class VoiceCloningEngine {
    private queue: Array<{characterId: string; file: File; resolve: (s: boolean) => void; reject: (e: any) => void}> = [];
    private isProcessing = false;
    private currentDevicePreference: deviceType = 'auto';

    setDevicePreference(preference: deviceType): void {
        this.currentDevicePreference = preference;
    }

    async enqueueUpload(characterId: string, file: File): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.queue.push({ characterId, file, resolve, reject });
            this.processQueue();
        });
    }

    private fileToBase64(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = error => reject(error);
        });
    }

    private async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const task = this.queue.shift()!;
            try {
                const base64Data = await this.fileToBase64(task.file);

                const response = await fetch(`${localURL}/api/clone-voice`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        characterId: task.characterId,
                        audioBase64: base64Data,
                        device: this.currentDevicePreference
                    })
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({ error: 'Unknown error' }));
                    throw new Error(errData.error || `HTTP ${response.status}`);
                }
                
                task.resolve(true);
            } catch (err) {
                console.error('[VoiceCloningEngine] Backend cloning failed:', err);
                task.reject(err);
            }
        }
        this.isProcessing = false;
    }

    isReady(): boolean { return true; }
    isUsingWebGpu(): boolean { return false; }
    getError(): string | null { return null; }
}

export const voiceCloningEngine = new VoiceCloningEngine();