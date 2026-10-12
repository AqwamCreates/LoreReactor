// frontend_src/services/StreamingVoiceTracker.ts
import { StreamingVoicePlayer } from './StreamingVoicePlayer';
import { textToSpeechEngine, fetchVoiceReference } from './TextToSpeechEngine';
import { extractNarratableText } from '../utilities/voiceTextExtractor';
import { useSessionStore } from '../hooks/useSessionStore';
import type { Character, Sampler, deviceType, textType } from '../types';

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
    private isKilled: boolean = false;
    private isFlushing: boolean = false;
    private hasVoiceConfigured: boolean = false;
    private startPromise: Promise<boolean> | null = null;
    private referenceBase64: string | null = null;
    
    // Strict sequence tracking
    private nextSequenceId: number = 0;
    private nextPlaySequenceId: number = 0;
    
    // Storage for out-of-order network responses
    private completedAudioBuffers: Map<number, ArrayBuffer> = new Map();
    private inFlightPromises: Promise<void>[] = [];

    // Concurrency control to avoid GPU/VRAM thrashing
    private readonly MAX_CONCURRENT_REQUESTS = 2;
    private activeRequests: number = 0;
    private pendingSentences: PendingJob[] = [];

    constructor(character: Character) {
        this.character = character;
        this.player = new StreamingVoicePlayer();
        this.hasVoiceConfigured = Boolean(character?.voice?.voiceFilename && character?.voice?.textContent);
    }

    start(): Promise<boolean> {
        if (!this.hasVoiceConfigured) {
            console.warn('[StreamingVoiceTracker] Character has no voice configured or transcript is missing. TTS disabled.');
            this.isActive = false;
            return Promise.resolve(false);
        }

        this.startPromise = (async () => {
            try {
                this.referenceBase64 = await fetchVoiceReference(this.character);
                if (!this.referenceBase64) {
                    console.warn('[StreamingVoiceTracker] Failed to fetch voice reference audio. TTS disabled.');
                    this.isActive = false;
                    this.hasVoiceConfigured = false;
                    return false;
                }

                await this.player.init();
                this.isActive = true;
                console.log('[StreamingVoiceTracker] Voice initialized. Processing queue...');
                this.processPendingQueue();
                return true;
            } catch (e) {
                console.error('[StreamingVoiceTracker] Voice start failed:', e);
                this.isActive = false;
                this.hasVoiceConfigured = false;
                return false;
            }
        })();

        return this.startPromise;
    }

    feed(text: string) {
        if (this.isKilled || !this.hasVoiceConfigured) return;

        const profile = useSessionStore.getState().interactionData?.profile;
        const narrateTexts = profile?.narrateTexts;
        
        const effectiveNarrateTexts = (narrateTexts && Object.keys(narrateTexts).length > 0)
            ? narrateTexts 
            : { normal: true, quoted: true, bolded: true, italicized: true, parenthesized: true, bracketed: true, braced: true } as Record<textType, boolean>;

        const cleanText = extractNarratableText(text, effectiveNarrateTexts);
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
        if (this.isKilled || !this.hasVoiceConfigured) return;
        const currentSequenceId = this.nextSequenceId++;
        this.pendingSentences.push({ sequenceId: currentSequenceId, sentence });
        this.processPendingQueue();
    }

    private processPendingQueue() {
        if (!this.isActive || this.isKilled) return;

        while (this.pendingSentences.length > 0 && this.activeRequests < this.MAX_CONCURRENT_REQUESTS) {
            const job = this.pendingSentences.shift()!;
            this.activeRequests++;
            
            const promise = this.executeSynthesis(job.sequenceId, job.sentence);
            this.inFlightPromises.push(promise);
            
            promise.finally(() => {
                this.activeRequests--;
                this.inFlightPromises = this.inFlightPromises.filter(p => p !== promise);
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
        const sampler: Sampler | undefined = profile?.characterTextToSpeechModelSampler ?? this.character.textToSpeechModelSampler;
        const devicePreference: deviceType = profile?.textToSpeechDeviceType ?? 'auto';

        try {
            const blob = await textToSpeechEngine.synthesize(
                sentence,
                sampler,
                base64,
                transcript,
                language,
                devicePreference
            );

            if (blob && !this.isKilled) {
                const arrayBuffer = await blob.arrayBuffer();
                this.completedAudioBuffers.set(sequenceId, arrayBuffer);
            } else {
                this.completedAudioBuffers.set(sequenceId, new ArrayBuffer(0));
            }
        } catch (e) {
            console.warn(`[StreamingVoiceTracker] Synthesis failed for sentence #${sequenceId}:`, e);
            this.completedAudioBuffers.set(sequenceId, new ArrayBuffer(0));
        } finally {
            this.processPlaybackQueue();
        }
    }

    private processPlaybackQueue() {
        while (this.completedAudioBuffers.has(this.nextPlaySequenceId)) {
            const audioBuffer = this.completedAudioBuffers.get(this.nextPlaySequenceId)!;
            this.completedAudioBuffers.delete(this.nextPlaySequenceId);
            this.nextPlaySequenceId++;
            
            if (audioBuffer.byteLength > 0 && !this.isKilled) {
                this.player.enqueue(audioBuffer);
            }
        }
    }

    async flushAndStop() {
        this.isFlushing = true;

        // If start was still in-flight, await its completion
        if (this.startPromise) {
            await this.startPromise;
        }

        // If character has no voice, exit immediately without hanging
        if (!this.hasVoiceConfigured || !this.isActive) {
            this.pendingSentences = [];
            this.buffer = '';
            this.isActive = false;
            return;
        }

        // Enqueue any remainder sentence that didn't end with [.!?]
        if (this.buffer.trim().length > 0) {
            this.queueSentence(this.buffer.trim());
            this.buffer = '';
        }

        // Process remaining queue
        this.processPendingQueue();

        // Safety timeout to prevent any deadlock from blocking the UI thread
        const startTime = Date.now();
        while ((this.pendingSentences.length > 0 || this.activeRequests > 0) && (Date.now() - startTime < 15000)) {
            if (this.inFlightPromises.length > 0) {
                await Promise.allSettled([...this.inFlightPromises]);
            } else {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
        
        this.processPlaybackQueue();
        this.isActive = false;
    }

    stopImmediate() {
        this.isKilled = true;
        this.isActive = false;
        this.hasVoiceConfigured = false;
        this.player.stop();
        this.completedAudioBuffers.clear();
        this.inFlightPromises = [];
        this.pendingSentences = [];
        this.activeRequests = 0;
        this.buffer = '';
    }
}