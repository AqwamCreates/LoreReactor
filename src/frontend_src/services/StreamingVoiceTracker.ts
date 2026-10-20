// src/frontend_src/services/StreamingVoiceTracker.ts
import { StreamingVoicePlayer } from './StreamingVoicePlayer';
import { textToSpeechEngine, fetchVoiceReference } from './TextToSpeechEngine';
import { extractNarratableText, type NarratableSegment } from '../utilities/voiceTextExtractor';
import { useSessionStore } from '../hooks/useSessionStore';
import type { Character, Sampler, deviceType, textType } from '../types';

interface PendingJob {
    sequenceId: number;
    sentence: string;
    textType: textType;
}

export class StreamingVoiceTracker {
    private buffer = '';
    private sentenceAccumulator = '';
    private pendingSegmentType: textType = 'normal';
    private processedSegments: NarratableSegment[] = [];
    
    private player: StreamingVoicePlayer;
    private character: Character;
    private allCharacters: Character[];
    
    private isActive = false;
    private isKilled = false;
    private isFlushing = false;
    private hasVoiceConfigured = false;
    private startPromise: Promise<boolean> | null = null;
    
    private voiceReferences: Map<string, string> = new Map();
    
    // Strict sequence tracking for in-order playback
    private nextSequenceId = 0;
    private nextPlaySequenceId = 0;
    
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

    private isFirstChunkSent = false;
    private activeRequests = 0;
    private pendingSentences: PendingJob[] = [];

    constructor(character: Character, allCharacters: Character[] = []) {
        this.character = character;
        this.allCharacters = allCharacters;
        this.player = new StreamingVoicePlayer();
        this.hasVoiceConfigured = Boolean(character?.voice?.voiceFilename && character?.voice?.textContent);
    }

    start(): Promise<boolean> {
        if (!this.hasVoiceConfigured) {
            this.isActive = false;
            return Promise.resolve(false);
        }

        this.startPromise = (async () => {
            try {
                const mainBase64 = await fetchVoiceReference(this.character);
                if (!mainBase64) {
                    console.warn('[StreamingVoiceTracker] Failed to fetch voice reference audio. TTS disabled.');
                    this.isActive = false;
                    this.hasVoiceConfigured = false;
                    return false;
                }
                this.voiceReferences.set(this.character.id, mainBase64);

                const profile = useSessionStore.getState().interactionData?.profile;
                const narrateTextCharacterIds = profile?.narrateTextCharacterIds;
                if (narrateTextCharacterIds) {
                    const idsToFetch = new Set(Object.values(narrateTextCharacterIds).filter(id => id && id !== this.character.id));
                    await Promise.all(Array.from(idsToFetch).map(async (id) => {
                        const char = this.allCharacters.find(c => c.id === id);
                        if (char?.voice?.voiceFilename && char.voice?.textContent) {
                            const b64 = await fetchVoiceReference(char);
                            if (b64) this.voiceReferences.set(id, b64);
                        }
                    }));
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
        this.processedSegments = [];
        this.buffer = '';
        this.sentenceAccumulator = '';
        this.pendingSegmentType = 'normal';
        this.isFirstChunkSent = false;
    }

    seed(text: string): void {
        if (!text) return;
        const profile = useSessionStore.getState().interactionData?.profile;
        const narrateTexts = profile?.narrateTexts;

        const segments = extractNarratableText(text, narrateTexts);
        this.processedSegments = segments;
        
        if (segments.length > 0) {
            this.pendingSegmentType = segments[segments.length - 1].textType;
        }
    }

    feed(text: string): void {
        if (this.isKilled || this.isFlushing || !this.hasVoiceConfigured) return;

        const profile = useSessionStore.getState().interactionData?.profile;
        const narrateTexts = profile?.narrateTexts;

        const newSegments = extractNarratableText(text, narrateTexts);

        let i = 0;
        while (i < this.processedSegments.length && i < newSegments.length) {
            if (this.processedSegments[i].text === newSegments[i].text) {
                i++;
            } else {
                break;
            }
        }
        
        if (i < newSegments.length) {
            if (i < this.processedSegments.length) {
                const oldText = this.processedSegments[i].text;
                const newText = newSegments[i].text;
                const delta = newText.startsWith(oldText) ? newText.slice(oldText.length) : newText;
                
                if (delta.length > 0) {
                    this.processSegmentDelta(delta, newSegments[i].textType);
                }
                
                this.processedSegments[i] = newSegments[i];
                i++;
            }
            
            for (; i < newSegments.length; i++) {
                this.processSegmentDelta(newSegments[i].text, newSegments[i].textType);
                this.processedSegments.push(newSegments[i]);
            }
        }
    }

    private processSegmentDelta(delta: string, type: textType): void {
        if (type !== this.pendingSegmentType && this.sentenceAccumulator.length > 0) {
            this.queueSentence(this.sentenceAccumulator, this.pendingSegmentType);
            this.sentenceAccumulator = '';
        }
        this.pendingSegmentType = type;

        this.buffer += delta;
        
        // Context-aware boundary matcher:
        // 1. Single period (ignores ..., .., and spaced . . .)
        // 2. [!?！？]+ and Asian full stop 。
        // 3. Ellipses (… / ‥ / ... / . . .) ONLY when followed by a capital letter
        const boundaryRegex = /(?:((?<!\.\s*)\.(?!\s*\.)|[!?！？]+|。)|([…‥]|(?:\.\s*){2,})\s+(?=[A-ZÀ-ÖØ-ßА-Я]))(?:\s+|$)/gu;
        let match: RegExpExecArray | null;

        while ((match = boundaryRegex.exec(this.buffer)) !== null) {
            const punctuation = match[1] || match[2] || '';
            const sentenceEnd = match.index + punctuation.length;
            const rawSentence = this.buffer.substring(0, sentenceEnd);
            this.buffer = this.buffer.substring(sentenceEnd);
            boundaryRegex.lastIndex = 0;

            if (!rawSentence) continue;

            // Micro-sentence consolidation: combine short phrases
            if (this.sentenceAccumulator) {
                this.sentenceAccumulator += ` ${rawSentence}`;
            } else {
                this.sentenceAccumulator = rawSentence;
            }

            // Asymmetric dynamic threshold: fast start for Chunk 1, deep buffer for Chunk 2+
            const targetMinLength = this.isFirstChunkSent
                ? this.STEADY_CHUNK_MIN_CHARS
                : this.INITIAL_CHUNK_MIN_CHARS;

            if (this.sentenceAccumulator.length >= targetMinLength) {
                this.queueSentence(this.sentenceAccumulator, this.pendingSegmentType);
                this.sentenceAccumulator = '';
                this.isFirstChunkSent = true;
            }
        }
    }

    private queueSentence(sentence: string, textType: textType): void {
        if (this.isKilled || !this.hasVoiceConfigured || !sentence) return;
        const currentSequenceId = this.nextSequenceId++;
        this.pendingSentences.push({ sequenceId: currentSequenceId, sentence: sentence, textType });
        this.processPendingQueue();
    }

    private processPendingQueue(): void {
        if (!this.isActive || this.isKilled) return;

        while (this.pendingSentences.length > 0 && this.activeRequests < this.MAX_CONCURRENT_REQUESTS) {
            const job = this.pendingSentences.shift()!;
            this.activeRequests++;
            
            const promise = this.executeSynthesis(job.sequenceId, job.sentence, job.textType);
            this.inFlightPromises.push(promise);
            
            promise.finally(() => {
                this.activeRequests--;
                this.inFlightPromises = this.inFlightPromises.filter(p => p !== promise);
                this.processPendingQueue();
            });
        }
    }

    private async executeSynthesis(sequenceId: number, sentence: string, textType: textType): Promise<void> {
        const profile = useSessionStore.getState().interactionData?.profile;
        const narrateTextCharacterIds = profile?.narrateTextCharacterIds;
        
        let targetChar = this.character;
        if (narrateTextCharacterIds && narrateTextCharacterIds[textType]) {
            const overrideId = narrateTextCharacterIds[textType];
            const overrideChar = this.allCharacters.find(c => c.id === overrideId);
            if (overrideChar && overrideChar.voice?.voiceFilename && overrideChar.voice?.textContent) {
                targetChar = overrideChar;
            }
        }

        const base64 = this.voiceReferences.get(targetChar.id);
        const transcript = targetChar.voice?.textContent;
        const language = targetChar.voice?.language;
        
        if (!base64 || !transcript) {
            this.completedAudioBuffers.set(sequenceId, new ArrayBuffer(0));
            this.processPlaybackQueue();
            return;
        }

        const sampler: Sampler | undefined = profile?.characterTextToSpeechModelSampler ?? targetChar.textToSpeechModelSampler;
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
        if (this.buffer.length > 0) {
            remaining = (remaining ? remaining + ' ' : '') + this.buffer;
        }

        if (remaining.length > 0) {
            this.queueSentence(remaining, this.pendingSegmentType);
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

    async waitForPlaybackCompletion(): Promise<void> {
        if (!this.hasVoiceConfigured || !this.isActive) return;

        let remaining = this.sentenceAccumulator;
        if (this.buffer.length > 0) {
            remaining = (remaining ? `${remaining} ` : '') + this.buffer;
        }

        if (remaining.length > 0) {
            this.queueSentence(remaining, this.pendingSegmentType);
            this.sentenceAccumulator = '';
            this.buffer = '';
        }

        this.processPendingQueue();

        // Await all in-flight TTS synthesis requests
        while (this.pendingSentences.length > 0 || this.activeRequests > 0) {
            if (this.isKilled) break;
            if (this.inFlightPromises.length > 0) {
                await Promise.allSettled([...this.inFlightPromises]);
            } else {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
        
        this.processPlaybackQueue();

        // Block until Web Audio playback finishes completely
        await this.player.waitUntilFinished();
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
        this.processedSegments = [];
    }
}