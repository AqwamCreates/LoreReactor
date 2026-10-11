// frontend_src/services/StreamingVoiceTracker.ts
import { StreamingVoicePlayer } from './StreamingVoicePlayer';
import { textToSpeechEngine, fetchVoiceReference, type TextToSpeechContext } from './TextToSpeechEngine';
import { extractNarratableText } from '../utilities/voiceTextExtractor';
import { useSessionStore } from '../hooks/useSessionStore';
import type { Character } from '../types';

interface PendingJob {
    sequenceId: number;
    sentence: string;
}

export class StreamingVoiceTracker {
    private buffer: string = '';
    private lastCleanLength: number = 0;
    private player: StreamingVoicePlayer;
    private character: Character;
    private isActive: boolean = false;
    private referenceBase64: string | null = null;
    
    // Strict sequence tracking
    private nextSequenceId: number = 0;
    private nextPlaySequenceId: number = 0;
    
    // Temporary storage for out-of-order network responses
    private completedAudioBuffers: Map<number, ArrayBuffer> = new Map();
    private inFlightPromises: Promise<void>[] = [];

    // ✅ CONCURRENCY CONTROL: Prevents GPU OOM crashes on 6GB VRAM cards
    private readonly MAX_CONCURRENT_REQUESTS = 2;
    private activeRequests: number = 0;
    private pendingSentences: PendingJob[] = [];

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
        this.nextSequenceId = 0;
        this.nextPlaySequenceId = 0;
        this.completedAudioBuffers.clear();
        this.inFlightPromises = [];
        this.activeRequests = 0;
        this.pendingSentences = [];
    }

    feed(text: string) {
        if (!this.isActive) return;

        const profile = useSessionStore.getState().interactionData?.profile;
        const narrateTexts = profile?.narrateTexts;
        
        if (!narrateTexts) return;

        const cleanText = extractNarratableText(text, narrateTexts);
        if (cleanText.length <= this.lastCleanLength) return;

        const newText = cleanText.slice(this.lastCleanLength);
        this.buffer += newText;
        this.lastCleanLength = cleanText.length;

        const boundaryRegex = /([.!?]+)(?:\s+|$)/g;
        let match;

        while ((match = boundaryRegex.exec(this.buffer)) !== null) {
            const sentenceEnd = match.index + match[1].length;
            const sentence = this.buffer.substring(0, sentenceEnd).trim();

            if (sentence.length > 0) {
                this.queueSentence(sentence);
            }

            this.buffer = this.buffer.substring(sentenceEnd);
            boundaryRegex.lastIndex = 0;
        }
    }

    private queueSentence(sentence: string) {
        const currentSequenceId = this.nextSequenceId++;
        this.pendingSentences.push({ sequenceId: currentSequenceId, sentence });
        this.processPendingQueue();
    }

    private processPendingQueue() {
        while (this.pendingSentences.length > 0 && this.activeRequests < this.MAX_CONCURRENT_REQUESTS && this.isActive) {
            const job = this.pendingSentences.shift()!;
            this.activeRequests++;
            
            const promise = this.executeSynthesis(job.sequenceId, job.sentence);
            this.inFlightPromises.push(promise);
            
            promise.finally(() => {
                this.activeRequests--;
                this.processPendingQueue();
            });
        }
    }

    private async executeSynthesis(sequenceId: number, sentence: string) {
        const base64 = this.referenceBase64;
        const transcript = this.character.voice?.textContent;
        const language = this.character.voice?.language;
        
        if (!base64 || !transcript) {
            this.completedAudioBuffers.set(sequenceId, new ArrayBuffer(0));
            this.processPlaybackQueue();
            return;
        }

        const profile = useSessionStore.getState().interactionData?.profile;
        const context: TextToSpeechContext = {
            devicePreference: profile?.textToSpeechDeviceType ?? 'auto'
        };

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
                this.completedAudioBuffers.set(sequenceId, arrayBuffer);
            } else {
                this.completedAudioBuffers.set(sequenceId, new ArrayBuffer(0));
            }
        } catch (e) {
            console.warn(`[StreamingVoiceTracker] Generation failed for Sequence ID ${sequenceId}:`, e);
            this.completedAudioBuffers.set(sequenceId, new ArrayBuffer(0));
        } finally {
            this.processPlaybackQueue();
        }
    }

    // Checks the Map sequentially and feeds the Audio Player strictly in order
    private processPlaybackQueue() {
        while (this.completedAudioBuffers.has(this.nextPlaySequenceId)) {
            const audioBuffer = this.completedAudioBuffers.get(this.nextPlaySequenceId)!;
            this.completedAudioBuffers.delete(this.nextPlaySequenceId);
            this.nextPlaySequenceId++;
            
            if (audioBuffer.byteLength > 0 && this.isActive) {
                this.player.enqueue(audioBuffer);
            }
        }
    }

    async flushAndStop() {
        if (this.buffer.trim().length > 0 && this.isActive) {
            this.queueSentence(this.buffer.trim());
        }

        // ✅ FIX: Wait until the ENTIRE queue is drained (both pending and active)
        while (this.pendingSentences.length > 0 || this.activeRequests > 0) {
            if (this.inFlightPromises.length > 0) {
                await Promise.allSettled(this.inFlightPromises);
                this.inFlightPromises = []; // Clear settled promises to prevent memory leak
            } else {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
        
        // Push any remaining completed audio to the player
        this.processPlaybackQueue();

        // Wait for the Web Audio API to finish scheduling/playing before destroying the context
        await new Promise(resolve => setTimeout(resolve, 500));
        
        this.player.stop();
        this.isActive = false;
    }

    stopImmediate() {
        this.isActive = false;
        this.player.stop();
        this.completedAudioBuffers.clear();
        this.inFlightPromises = [];
        this.pendingSentences = [];
        this.activeRequests = 0;
    }
}