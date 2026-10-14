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
    private sentenceAccumulator: string = '';
    private lastCleanLength: number = 0;
    private player: StreamingVoicePlayer;
    private character: Character;
    private isActive: boolean = false;
    private isKilled: boolean = false;
    private isFlushing: boolean = false;
    private hasVoiceConfigured: boolean = false;
    private startPromise: Promise<boolean> | null = null;
    private referenceBase64: string | null = null;
    
    // Strict sequence tracking for in-order playback
    private nextSequenceId: number = 0;
    private nextPlaySequenceId: number = 0;
    
    // Storage for completed audio buffers (handles out-of-order network responses)
    private completedAudioBuffers: Map<number, ArrayBuffer> = new Map();
    private inFlightPromises: Promise<void>[] = [];

    // Concurrency control to avoid GPU/VRAM thrashing
    private readonly MAX_CONCURRENT_REQUESTS = 2;

    // ─── Asymmetric Pipelining Thresholds (Worst-case 15 frames/s guarantee) ───
    // Chunk 1: Pacesetter (~50 chars / ~55 frames) -> ~2.3s TTFA, generates ~4.0s of audio buffer
    private readonly INITIAL_CHUNK_MIN_CHARS = 50;
    // Chunk 2+: Runway Builder (~75 chars / ~70 frames) -> generates ~5.6s audio, builds surplus cushion
    private readonly STEADY_CHUNK_MIN_CHARS = 75;

    private isFirstChunkSent: boolean = false;
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

    resetPass(): void {
        this.lastCleanLength = 0;
        this.isFirstChunkSent = false;
        this.buffer = '';
        this.sentenceAccumulator = '';
    }

    seed(text: string): void {
        if (!text) return;
        const profile = useSessionStore.getState().interactionData?.profile;
        const narrateTexts = profile?.narrateTexts;
        
        const effectiveNarrateTexts = (narrateTexts && Object.keys(narrateTexts).length > 0)
            ? narrateTexts 
            : { normal: true, quoted: true, bolded: true, italicized: true, parenthesized: true, bracketed: true, braced: true } as Record<textType, boolean>;

        const cleanText = extractNarratableText(text, effectiveNarrateTexts);
        this.lastCleanLength = cleanText.length;
    }

    feed(text: string): void {
        if (this.isKilled || this.isFlushing || !this.hasVoiceConfigured) return;

        const profile = useSessionStore.getState().interactionData?.profile;
        const narrateTexts = profile?.narrateTexts;
        
        const effectiveNarrateTexts = (narrateTexts && Object.keys(narrateTexts).length > 0)
            ? narrateTexts 
            : { normal: true, quoted: true, bolded: true, italicized: true, parenthesized: true, bracketed: true, braced: true } as Record<textType, boolean>;

        const cleanText = extractNarratableText(text, effectiveNarrateTexts);

        // ✅ FIX: Guard against temporary length shrinkage (e.g. trailing whitespace trim,
        // abrupt provider cutoff, unclosed quotes). Never reset lastCleanLength to 0 unless
        // the text was genuinely reset to an empty string.
        if (cleanText.length < this.lastCleanLength) {
            if (cleanText.length === 0) {
                this.lastCleanLength = 0;
            }
            return;
        }

        if (cleanText.length <= this.lastCleanLength) return;

        const newText = cleanText.slice(this.lastCleanLength);
        this.buffer += newText;
        this.lastCleanLength = cleanText.length;

        // Context-aware boundary matcher:
        // 1. Single period (ignores ..., .., and spaced . . .)
        // 2. [!?！？]+ and Asian full stop 。
        // 3. Ellipses (… / ‥ / ... / . . .) ONLY when followed by a capital letter
        const boundaryRegex = /(?:((?<!\.\s*)\.(?!\s*\.)|[!?！？]+|。)|([…‥]|(?:\.\s*){2,})\s+(?=[A-ZÀ-ÖØ-ßА-Я]))(?:\s+|$)/gu;
        let match: RegExpExecArray | null;

        while ((match = boundaryRegex.exec(this.buffer)) !== null) {
            const punctuation = match[1] || match[2] || '';
            const sentenceEnd = match.index + punctuation.length;
            const rawSentence = this.buffer.substring(0, sentenceEnd).trim();
            this.buffer = this.buffer.substring(sentenceEnd);
            boundaryRegex.lastIndex = 0;

            if (!rawSentence) continue;

            // Micro-sentence consolidation: combine short phrases
            if (this.sentenceAccumulator) {
                this.sentenceAccumulator += ' ' + rawSentence;
            } else {
                this.sentenceAccumulator = rawSentence;
            }

            // Asymmetric dynamic threshold: fast start for Chunk 1, deep buffer for Chunk 2+
            const targetMinLength = this.isFirstChunkSent
                ? this.STEADY_CHUNK_MIN_CHARS
                : this.INITIAL_CHUNK_MIN_CHARS;

            if (this.sentenceAccumulator.length >= targetMinLength) {
                this.queueSentence(this.sentenceAccumulator.trim());
                this.sentenceAccumulator = '';
                this.isFirstChunkSent = true;
            }
        }
    }

    private queueSentence(sentence: string): void {
        if (this.isKilled || !this.hasVoiceConfigured || !sentence.trim()) return;
        const currentSequenceId = this.nextSequenceId++;
        this.pendingSentences.push({ sequenceId: currentSequenceId, sentence: sentence.trim() });
        this.processPendingQueue();
    }

    private processPendingQueue(): void {
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

    private async executeSynthesis(sequenceId: number, sentence: string): Promise<void> {
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

    private processPlaybackQueue(): void {
        while (this.completedAudioBuffers.has(this.nextPlaySequenceId)) {
            const audioBuffer = this.completedAudioBuffers.get(this.nextPlaySequenceId)!;
            this.completedAudioBuffers.delete(this.nextPlaySequenceId);
            this.nextPlaySequenceId++;
            
            if (audioBuffer.byteLength > 0 && !this.isKilled) {
                this.player.enqueue(audioBuffer);
            }
        }
    }

    /**
     * Called when text generation completes.
     * Flushes remaining buffered fragments into the queue and drains in background without cutoff.
     */
    async flushAndStop(): Promise<void> {
        this.isFlushing = true;

        if (this.startPromise) {
            await this.startPromise;
        }

        if (!this.hasVoiceConfigured || !this.isActive) {
            this.pendingSentences = [];
            this.buffer = '';
            this.sentenceAccumulator = '';
            this.isActive = false;
            this.isFirstChunkSent = false;
            return;
        }

        // Flush any remaining text (including trailing phrases and ending ellipses of any style)
        let remaining = this.sentenceAccumulator;
        if (this.buffer.trim().length > 0) {
            remaining = (remaining ? remaining + ' ' : '') + this.buffer.trim();
        }

        if (remaining.trim().length > 0) {
            this.queueSentence(remaining.trim());
            this.sentenceAccumulator = '';
            this.buffer = '';
        }

        this.processPendingQueue();

        // Drain in background until completely finished (no premature cutoff)
        while (this.pendingSentences.length > 0 || this.activeRequests > 0) {
            if (this.isKilled) break;
            if (this.inFlightPromises.length > 0) {
                await Promise.allSettled([...this.inFlightPromises]);
            } else {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
        
        this.processPlaybackQueue();
        this.isActive = false;
        this.isFirstChunkSent = false;
    }

    stopImmediate(): void {
        this.isKilled = true;
        this.isActive = false;
        this.hasVoiceConfigured = false;
        this.isFirstChunkSent = false;
        this.player.stop();
        this.completedAudioBuffers.clear();
        this.inFlightPromises = [];
        this.pendingSentences = [];
        this.activeRequests = 0;
        this.buffer = '';
        this.sentenceAccumulator = '';
    }
}