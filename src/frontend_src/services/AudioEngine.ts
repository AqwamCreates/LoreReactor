// frontend-src/services/AudioEngine.ts
import type { AudioTrack, InteractionData, PromptBlock, Location, RegularExpressionTrigger, Character, ChatMessage, WhisperMessage } from '../types';
import { getUniversalMessageFilterFlags } from '../utilities/promptLogic';
import { getAudioTrackUrl } from '../storages/serverStorage';
import { mediaCache } from './MediaCache';
import { MultiplayerEvents } from './MultiplayerEvents';
import { getLocalMessageHistory } from '../utilities/timelineLogic';
import { findLatestMessage } from '../utilities/messageLogic';

interface ActiveTrackState {
    track: AudioTrack;
    source: AudioBufferSourceNode | null;
    gainNode: GainNode;
    targetVolume: number;
    isPlaying: boolean;
}

/**
 * Tests if any trigger in the array matches the given search space.
 */
function doesAnyTriggerMatch(triggers: RegularExpressionTrigger[] | undefined, searchSpace: string): boolean {
    if (!triggers || triggers.length === 0) return false;
    for (const trigger of triggers) {
        if (!trigger.trigger.trim()) continue;
        try {
            const regex = new RegExp(trigger.trigger, 'i');
            if (regex.test(searchSpace)) return true;
        } catch { /* invalid regex, skip */ }
    }
    return false;
}

export class AudioEngine {
    private context: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private activeTracks: Map<string, ActiveTrackState> = new Map();
    private bufferCache: Map<string, AudioBuffer> = new Map();
    private globalVolumeOverride = -1;
    private animationFrameId: number | null = null;
    private previousLocationIds: Map<string, string | undefined> = new Map();
    private mediaUnsubscribe: (() => void) | null = null;

    constructor() {
        this.mediaUnsubscribe = MultiplayerEvents.on('mediaCacheUpdated', () => {
            for (const [trackId, state] of this.activeTracks.entries()) {
                if (!state.isPlaying) {
                    void this.loadBuffer(state.track.id, state.track.filename).then(buffer => {
                        if (!buffer || !this.activeTracks.has(trackId)) return;
                        this.playTrackBuffer(state, buffer);
                    });
                }
            }
        });
    }

    private ensureContext(): AudioContext {
        if (!this.context) {
            this.context = new AudioContext();
            this.masterGain = this.context.createGain();
            this.masterGain.connect(this.context.destination);
            this.masterGain.gain.value = 1;
        }
        if (this.context.state === 'suspended') {
            void this.context.resume();
        }
        return this.context;
    }

    initialize(): void {
        this.ensureContext();
    }

    setGlobalVolume(volume: number): void {
        this.globalVolumeOverride = volume;
        for (const state of this.activeTracks.values()) {
            const effectiveVolume = volume >= 0 ? volume : state.track.volume;
            state.targetVolume = effectiveVolume;
        }
    }

    private getEffectiveVolume(track: AudioTrack): number {
        if (this.globalVolumeOverride >= 0) return this.globalVolumeOverride;
        return track.volume;
    }

    private async loadBuffer(audioTrackId: string, filename: string): Promise<AudioBuffer | null> {
        const cacheKey = `${audioTrackId}:${filename}`;
        const cached = this.bufferCache.get(cacheKey);
        if (cached) return cached;

        try {
            let targetUrl: string | null = null;
            if (filename.startsWith('data:') || filename.startsWith('http://') || filename.startsWith('https://')) {
                targetUrl = filename;
            }

            if (!targetUrl) {
                const fromMediaCache = mediaCache.get(cacheKey) || mediaCache.get(filename);
                if (fromMediaCache) {
                    targetUrl = fromMediaCache;
                }
            }

            if (!targetUrl) {
                targetUrl = getAudioTrackUrl(audioTrackId, filename);
            }

            if (!targetUrl) return null;

            const response = await fetch(targetUrl);
            if (!response.ok) {
                MultiplayerEvents.emit('requestMediaAsset', {
                    assetType: 'audio',
                    pathOrFilename: targetUrl || filename,
                });
                return null;
            }

            const arrayBuffer = await response.arrayBuffer();
            const context = this.ensureContext();
            const buffer = await context.decodeAudioData(arrayBuffer);

            this.bufferCache.set(cacheKey, buffer);
            return buffer;
        } catch (e) {
            MultiplayerEvents.emit('requestMediaAsset', {
                assetType: 'audio',
                pathOrFilename: filename,
            });
            console.warn(`Failed to load audio buffer for ${filename}:`, e);
            return null;
        }
    }

    private playTrackBuffer(state: ActiveTrackState, buffer: AudioBuffer): void {
        if (state.isPlaying) return;

        const context = this.ensureContext();
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = state.track.loop;
        source.connect(state.gainNode);
        source.start(0);

        state.source = source;
        state.isPlaying = true;

        const fadeDuration = Math.max(0.01, state.track.startFadeDurationMs / 1000);
        state.gainNode.gain.setValueAtTime(0, context.currentTime);
        state.gainNode.gain.linearRampToValueAtTime(state.targetVolume, context.currentTime + fadeDuration);

        source.onended = () => {
            if (!state.track.loop && this.activeTracks.has(state.track.id)) {
                this.stopTrack(state.track.id);
            }
        };
    }

    startTrack(track: AudioTrack): void {
        if (this.activeTracks.has(track.id)) return;

        const context = this.ensureContext();
        const gainNode = context.createGain();
        gainNode.connect(this.masterGain!);
        gainNode.gain.value = 0;

        const state: ActiveTrackState = {
            track,
            source: null,
            gainNode,
            targetVolume: this.getEffectiveVolume(track),
            isPlaying: false,
        };

        this.activeTracks.set(track.id, state);

        void this.loadBuffer(track.id, track.filename).then(buffer => {
            if (!buffer || !this.activeTracks.has(track.id)) return;
            this.playTrackBuffer(state, buffer);
        });
    }

    stopTrack(trackId: string): void {
        const state = this.activeTracks.get(trackId);
        if (!state) return;

        const context = this.context;
        if (!context) {
            this.activeTracks.delete(trackId);
            return;
        }

        const fadeDuration = Math.max(0.01, state.track.endFadeDurationMs / 1000);
        state.gainNode.gain.setValueAtTime(state.gainNode.gain.value, context.currentTime);
        state.gainNode.gain.linearRampToValueAtTime(0, context.currentTime + fadeDuration);

        setTimeout(() => {
            try {
                state.source?.stop();
            } catch { /* already stopped */ }
            state.gainNode.disconnect();
            this.activeTracks.delete(trackId);
        }, fadeDuration * 1000 + 50);
    }

    // ✅ FIX: Added localProtagonistId parameter to evaluate audio from the local user's perspective
    evaluate(interactionData: InteractionData, allPromptBlocks: PromptBlock[] = [], localProtagonistId?: string | null): void {
        const tracks = interactionData.audioTracks || [];
        const locations = interactionData.locations || [];
        
        // Use the explicitly passed localProtagonistId for perspective-specific audio triggers,
        // falling back to the session's primary protagonist if not provided.
        const activeProtagonistId = localProtagonistId ?? interactionData.protagonistIds?.[0];
        const protagonist = activeProtagonistId 
            ? interactionData.participants?.find(p => p.id === activeProtagonistId) 
            : undefined;

        this.checkLocationEnterTriggers(interactionData, tracks, locations);

        if (tracks.length === 0) {
            for (const id of [...this.activeTracks.keys()]) {
                this.stopTrack(id);
            }
            return;
        }

        // Pass character to get character-specific location
        const currentLocationId = protagonist ? this.getCurrentLocationId(interactionData, protagonist) : undefined;
        const currentContextIds = new Set((interactionData.contexts || []).map(c => c.id));

        // Pass character to get character-specific visible message text (respects whispers)
        const latestMessageText = protagonist ? this.getLatestVisibleMessageText(interactionData, protagonist, allPromptBlocks) : '';

        const shouldBeActive = new Set<string>();

        for (const track of tracks) {
            let active = false;

            if (latestMessageText && doesAnyTriggerMatch(track.regularExpressionActivationTriggers, latestMessageText)) {
                active = true;
            }

            if (active && latestMessageText && doesAnyTriggerMatch(track.regularExpressionDeactivationTriggers, latestMessageText)) {
                active = false;
            }

            if (!active && latestMessageText && doesAnyTriggerMatch(track.regularExpressionExclusionActivationTriggers, latestMessageText)) {
                if (!doesAnyTriggerMatch(track.regularExpressionExclusionDeactivationTriggers, latestMessageText)) {
                    active = false;
                }
            }

            if (!active && track.locationBindings.length > 0 && currentLocationId) {
                if (track.locationBindings.includes(currentLocationId)) active = true;
            }

            if (!active && track.contextBindings.length > 0) {
                for (const ctxId of track.contextBindings) {
                    if (currentContextIds.has(ctxId)) { active = true; break; }
                }
            }

            const hasTriggers = (track.regularExpressionActivationTriggers?.length ?? 0) > 0;
            const hasBindings = track.locationBindings.length > 0 || track.contextBindings.length > 0;
            if (!hasTriggers && !hasBindings) {
                active = true;
            }

            if (active) shouldBeActive.add(track.id);
        }

        for (const trackId of shouldBeActive) {
            if (!this.activeTracks.has(trackId)) {
                const track = tracks.find(t => t.id === trackId);
                if (track) this.startTrack(track);
            }
        }

        for (const [trackId] of this.activeTracks) {
            if (!shouldBeActive.has(trackId)) this.stopTrack(trackId);
        }

        for (const [trackId, state] of this.activeTracks) {
            const track = tracks.find(t => t.id === trackId);
            if (track) state.targetVolume = this.getEffectiveVolume(track);
        }
    }

    private checkLocationEnterTriggers(
        interactionData: InteractionData,
        tracks: AudioTrack[],
        locations: Location[],
    ): void {
        if (tracks.length === 0 || locations.length === 0) return;

        const participants = interactionData.participants || [];

        for (const participant of participants) {
            // Uses findLatestMessage (character-scoped) to get the specific character's current locationId
            const latest = findLatestMessage(interactionData, participant);
            const currentLocId = latest?.locationId;
            const previousLocId = this.previousLocationIds.get(participant.id);

            const hasTransitioned = previousLocId !== undefined && currentLocId !== undefined && currentLocId !== previousLocId;
            const firstAssignment = previousLocId === undefined && currentLocId !== undefined;

            if ((hasTransitioned || firstAssignment) && currentLocId) {
                const location = locations.find(l => l.id === currentLocId);
                if (location?.playAudioTrackOnEnterWeights) {
                    const sampledTrackId = this.sampleWeightedTrack(location.playAudioTrackOnEnterWeights);
                    if (sampledTrackId) {
                        const track = tracks.find(t => t.id === sampledTrackId);
                        if (track && !this.activeTracks.has(track.id)) {
                            this.startTrack(track);
                        }
                    }
                }
            }

            this.previousLocationIds.set(participant.id, currentLocId);
        }
    }

    private sampleWeightedTrack(weights: Record<string, number>): string | null {
        const entries = Object.entries(weights);
        if (entries.length === 0) return null;

        const totalWeight = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
        if (totalWeight <= 0) return null;

        let roll = Math.random() * totalWeight;
        for (const [trackId, weight] of entries) {
            roll -= Math.max(0, weight);
            if (roll <= 0) return trackId;
        }

        return entries[entries.length - 1][0];
    }

    private getCurrentLocationId(interactionData: InteractionData, character: Character): string | undefined {
        const latest = findLatestMessage(interactionData, character);
        return latest?.locationId;
    }

    private getLatestVisibleMessageText(
        interactionData: InteractionData,
        character: Character,
        allPromptBlocks: PromptBlock[],
    ): string {
        const localHistory = getLocalMessageHistory(interactionData, character, ['chat', 'whisper']) as (ChatMessage | WhisperMessage)[];
        if (localHistory.length === 0) return '';

        const filterFlags = getUniversalMessageFilterFlags(
            localHistory,
            interactionData.contexts || [],
            interactionData.locations || [],
            allPromptBlocks,
        );

        for (let i = localHistory.length - 1; i >= 0; i--) {
            const msg = localHistory[i];
            if (!filterFlags[i] && 'textContent' in msg && msg.textContent) {
                return msg.textContent;
            }
        }
        return '';
    }

    private tickVolumes(): void {
        if (!this.context) return;
        for (const state of this.activeTracks.values()) {
            if (!state.isPlaying) continue;
            const current = state.gainNode.gain.value;
            const target = state.targetVolume;
            const diff = target - current;
            if (Math.abs(diff) < 0.001) {
                state.gainNode.gain.value = target;
            } else {
                state.gainNode.gain.value = current + diff * 0.1;
            }
        }
        this.animationFrameId = requestAnimationFrame(() => this.tickVolumes());
    }

    startVolumeTicker(): void {
        if (this.animationFrameId !== null) return;
        this.tickVolumes();
    }

    stopVolumeTicker(): void {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    stopAll(): void {
        for (const id of [...this.activeTracks.keys()]) {
            this.stopTrack(id);
        }
        this.stopVolumeTicker();
    }

    destroy(): void {
        this.stopAll();
        if (this.mediaUnsubscribe) {
            this.mediaUnsubscribe();
            this.mediaUnsubscribe = null;
        }
        this.bufferCache.clear();
        this.previousLocationIds.clear();
        if (this.context) {
            void this.context.close();
            this.context = null;
            this.masterGain = null;
        }
    }
}

let instance: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
    if (!instance) instance = new AudioEngine();
    return instance;
}

export function destroyAudioEngine(): void {
    if (instance) {
        instance.destroy();
        instance = null;
    }
}