// frontend_src/services/StreamingVoiceTracker.ts
import { StreamingVoicePlayer } from './StreamingVoicePlayer';
import { textToSpeechEngine, fetchVoiceReference, type TextToSpeechContext } from './TextToSpeechEngine';
import { extractNarratableText } from '../utilities/voiceTextExtractor';
import { useSessionStore } from '../hooks/useSessionStore';
import type { Character } from '../types';

export class StreamingVoiceTracker {
    private buffer: string = '';
    private lastCleanLength: number = 0;
    private player: StreamingVoicePlayer;
    private character: Character;
    private isActive: boolean = false;
    private referenceBase64: string | null = null;
    private pendingPromises: Promise<void>[] = [];

    constructor(character: Character) {
        this.character = character;
        this.player = new StreamingVoicePlayer();
    }

    async start() {
        if (!this.character.voice?.voiceFilename || !this.character.voice?.textContent) return;

        this.referenceBase64 = await fetchVoiceReference(this.character);
        if (!this.referenceBase64) return;

        await this.player.init();
        this.isActive = true;
    }

    feed(text: string) {
        if (!this.isActive) return;

        // ✅ Read profile dynamically from current session
        const profile = useSessionStore.getState().interactionData?.profile;
        const narrateTexts = profile?.narrateTexts;
        
        if (!narrateTexts) return;

        const cleanText = extractNarratableText(text, narrateTexts);
        if (cleanText.length <= this.lastCleanLength) return;

        const newText = cleanText.slice(this.lastCleanLength);
        this.buffer += newText;
        this.lastCleanLength = cleanText.length;

        const boundaryRegex = /([.!?]+\s+|\n+)/g;
        let match;

        while ((match = boundaryRegex.exec(this.buffer)) !== null) {
            const sentenceEnd = match.index + match[1].length;
            const sentence = this.buffer.substring(0, sentenceEnd).trim();

            if (sentence.length > 0) {
                this.triggerVoiceGeneration(sentence);
            }

            this.buffer = this.buffer.substring(sentenceEnd);
            boundaryRegex.lastIndex = 0;
        }
    }

    private triggerVoiceGeneration(sentence: string) {
        const base64 = this.referenceBase64;
        const transcript = this.character.voice?.textContent;
        const language = this.character.voice?.language;
        
        if (!base64 || !transcript) return;

        // ✅ Read device preference dynamically from current session
        const profile = useSessionStore.getState().interactionData?.profile;
        const context: TextToSpeechContext = {
            devicePreference: profile?.textToSpeechDeviceType ?? 'auto'
        };

        const promise = (async () => {
            try {
                const blob = await textToSpeechEngine.synthesize(
                    sentence,
                    base64,
                    transcript,
                    language,
                    context
                );

                if (blob && this.isActive) {
                    const arrayBuffer = await blob.arrayBuffer();
                    await this.player.enqueue(arrayBuffer);
                }
            } catch (e) {
                console.warn("[StreamingVoiceTracker] Generation failed for sentence:", e);
            }
        })();

        this.pendingPromises.push(promise);
    }

    async flushAndStop() {
        if (this.buffer.trim().length > 0 && this.isActive) {
            this.triggerVoiceGeneration(this.buffer.trim());
        }

        await Promise.all(this.pendingPromises);

        setTimeout(() => {
            this.player.stop();
            this.isActive = false;
        }, 500);
    }

    stopImmediate() {
        this.isActive = false;
        this.player.stop();
    }
}