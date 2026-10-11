import { StreamingVoicePlayer } from './StreamingVoicePlayer';
import { textToSpeechEngine, fetchVoiceReference, type TextToSpeechContext } from './TextToSpeechEngine';
import { extractNarratableText } from '../utilities/voiceTextExtractor';
import { useSessionStore } from '../hooks/useSessionStore';
import type { Character } from '../types';

interface SentenceJob {
    sequenceNumber: number;
    text: string;
    promise: Promise<void>;
    completed: boolean;
}

export class StreamingVoiceTracker {
    private buffer: string = '';
    private lastCleanLength: number = 0;
    private player: StreamingVoicePlayer;
    private character: Character;
    private isActive: boolean = false;
    private referenceBase64: string | null = null;
    
    // ✅ NEW: Ordered queue system
    private sequenceCounter: number = 0;
    private nextEnqueueSequence: number = 0;
    private jobs: Map<number, SentenceJob> = new Map();

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

        const profile = useSessionStore.getState().interactionData?.profile;
        const narrateTexts = profile?.narrateTexts;
        
        if (!narrateTexts) return;

        const cleanText = extractNarratableText(text, narrateTexts);
        if (cleanText.length <= this.lastCleanLength) return;

        const newText = cleanText.slice(this.lastCleanLength);
        this.buffer += newText;
        this.lastCleanLength = cleanText.length;

        // ✅ FIX: Better sentence boundary detection
        const boundaryRegex = /([.!?]+)(?:\s+|$)/g;
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

        const profile = useSessionStore.getState().interactionData?.profile;
        const context: TextToSpeechContext = {
            devicePreference: profile?.textToSpeechDeviceType ?? 'auto'
        };

        // ✅ Assign sequence number for ordering
        const sequenceNumber = this.sequenceCounter++;
        
        const job: SentenceJob = {
            sequenceNumber,
            text: sentence,
            completed: false,
            promise: (async () => {
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
                        job.completed = true;
                        
                        // ✅ Enqueue in order
                        await this.enqueueInOrder(sequenceNumber, arrayBuffer);
                    }
                } catch (e) {
                    console.warn("[StreamingVoiceTracker] Generation failed for sentence:", e);
                    job.completed = true;
                    await this.processQueue();
                }
            })()
        };

        this.jobs.set(sequenceNumber, job);
    }

    // ✅ NEW: Ensures sentences are enqueued in sequence order
        private async enqueueInOrder(sequenceNumber: number, audioBuffer: ArrayBuffer) {
        const waitStart = Date.now();
        
        // Wait until it's this sentence's turn
        while (this.nextEnqueueSequence < sequenceNumber && this.isActive) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        const waitTime = Date.now() - waitStart;
        console.log(`[StreamingVoiceTracker] Sentence ${sequenceNumber} waited ${waitTime}ms before enqueue`);
        
        // Enqueue this sentence
        if (this.isActive) {
            await this.player.enqueue(audioBuffer);
            console.log(`[StreamingVoiceTracker] Sentence ${sequenceNumber} enqueued`);
        }
        
        // Mark as processed
        this.nextEnqueueSequence++;
        this.jobs.delete(sequenceNumber);
        
        // Process any queued sentences that are now ready
        await this.processQueue();
    }

    // ✅ NEW: Process completed sentences in order
    private async processQueue() {
        while (this.jobs.has(this.nextEnqueueSequence)) {
            const job = this.jobs.get(this.nextEnqueueSequence)!;
            if (job.completed) {
                this.nextEnqueueSequence++;
                this.jobs.delete(job.sequenceNumber);
            } else {
                break; // Wait for this sentence to complete
            }
        }
    }

    async flushAndStop() {
        if (this.buffer.trim().length > 0 && this.isActive) {
            this.triggerVoiceGeneration(this.buffer.trim());
        }

        // Wait for all jobs to complete
        const allPromises = Array.from(this.jobs.values()).map(job => job.promise);
        await Promise.all(allPromises);

        setTimeout(() => {
            this.player.stop();
            this.isActive = false;
        }, 500);
    }

    stopImmediate() {
        this.isActive = false;
        this.player.stop();
        this.jobs.clear();
        this.sequenceCounter = 0;
        this.nextEnqueueSequence = 0;
    }
}