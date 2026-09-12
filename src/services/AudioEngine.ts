// src/services/AudioEngine.ts
import type { AudioTrack, InteractionData, ChatMessage, PromptBlock, Location } from '../types';
import { localURL } from '../configurations';
import { getUniversalMessageFilterFlags } from '../hooks/chatLogic';

interface ActiveTrackState {
    track: AudioTrack;
    source: AudioBufferSourceNode | null;
    gainNode: GainNode;
    targetVolume: number;
    isPlaying: boolean;
}

export class AudioEngine {
    private context: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private activeTracks: Map<string, ActiveTrackState> = new Map();
    private bufferCache: Map<string, AudioBuffer> = new Map();
    private globalVolumeOverride = -1;
    private animationFrameId: number | null = null;
    private previousLocationIds: Map<string, number | undefined> = new Map();

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

    private getAudioUrl(filename: string): string {
        const cleanPath = '/user_data/audio_tracks';
        return `${localURL}${cleanPath}/${filename}`;
    }

    private async loadBuffer(filename: string): Promise<AudioBuffer | null> {
        const cached = this.bufferCache.get(filename);
        if (cached) return cached;

        try {
            const url = this.getAudioUrl(filename);
            const response = await fetch(url);
            if (!response.ok) return null;
            const arrayBuffer = await response.arrayBuffer();
            const context = this.ensureContext();
            const buffer = await context.decodeAudioData(arrayBuffer);
            this.bufferCache.set(filename, buffer);
            return buffer;
        } catch (e) {
            console.warn(`Failed to load audio buffer for ${filename}:`, e);
            return null;
        }
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

        void this.loadBuffer(track.filename).then(buffer => {
            if (!buffer || !this.activeTracks.has(track.id)) return;

            const source = context.createBufferSource();
            source.buffer = buffer;
            source.loop = track.loop;
            source.connect(gainNode);
            source.start(0);

            state.source = source;
            state.isPlaying = true;

            const fadeDuration = Math.max(0.01, track.startFadeDurationMs / 1000);
            gainNode.gain.setValueAtTime(0, context.currentTime);
            gainNode.gain.linearRampToValueAtTime(state.targetVolume, context.currentTime + fadeDuration);

            source.onended = () => {
                if (!track.loop && this.activeTracks.has(track.id)) {
                    this.stopTrack(track.id);
                }
            };
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

    evaluate(interactionData: InteractionData, allPromptBlocks: PromptBlock[] = []): void {
        const tracks = interactionData.audioTracks || [];
        const locations = interactionData.locations || [];

        this.checkLocationEnterTriggers(interactionData, tracks, locations);

        if (tracks.length === 0) {
            for (const id of [...this.activeTracks.keys()]) {
                this.stopTrack(id);
            }
            return;
        }

        const currentLocationId = this.getCurrentLocationId(interactionData);
        const currentContextIds = new Set((interactionData.contexts || []).map(c => c.id));

        const latestMessageText = this.getLatestVisibleMessageText(interactionData, allPromptBlocks);

        const shouldBeActive = new Set<string>();

        for (const track of tracks) {
            let active = false;

            if (track.regularExpressionActivationTrigger && latestMessageText) {
                try {
                    const regex = new RegExp(track.regularExpressionActivationTrigger, 'i');
                    if (regex.test(latestMessageText)) active = true;
                } catch { /* invalid regex */ }
            }

            if (active && track.regularExpressionDeactivationTrigger && latestMessageText) {
                try {
                    const regex = new RegExp(track.regularExpressionDeactivationTrigger, 'i');
                    if (regex.test(latestMessageText)) active = false;
                } catch { /* invalid regex */ }
            }

            if (!active && track.locationBindings.length > 0 && currentLocationId) {
                if (track.locationBindings.includes(currentLocationId)) active = true;
            }

            if (!active && track.contextBindings.length > 0) {
                for (const ctxId of track.contextBindings) {
                    if (currentContextIds.has(ctxId)) { active = true; break; }
                }
            }

            if (!track.regularExpressionActivationTrigger &&
                track.locationBindings.length === 0 &&
                track.contextBindings.length === 0) {
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
        const history = interactionData.interactionHistory;

        for (const participant of participants) {
            let currentLocIdx: number | undefined;
            for (let i = history.length - 1; i >= 0; i--) {
                if (history[i].character.id === participant.id && history[i].locationIndex !== undefined) {
                    currentLocIdx = history[i].locationIndex;
                    break;
                }
            }

            const previousLocIdx = this.previousLocationIds.get(participant.id);

            const hasTransitioned = previousLocIdx !== undefined && currentLocIdx !== undefined && currentLocIdx !== previousLocIdx;
            const firstAssignment = previousLocIdx === undefined && currentLocIdx !== undefined;

            if ((hasTransitioned || firstAssignment) && currentLocIdx !== undefined) {
                const location = locations[currentLocIdx];
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

            this.previousLocationIds.set(participant.id, currentLocIdx);
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

    private getCurrentLocationId(interactionData: InteractionData): string | undefined {
        const history = interactionData.interactionHistory;
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            if (msg.locationIndex !== undefined && interactionData.locations) {
                const loc = interactionData.locations[msg.locationIndex];
                if (loc) return loc.id;
            }
        }
        return undefined;
    }

    private getLatestVisibleMessageText(
        interactionData: InteractionData,
        allPromptBlocks: PromptBlock[],
    ): string {
        const history = interactionData.interactionHistory;
        const chatMessages = history.filter((m): m is ChatMessage => m.messageType === 'chat');
        if (chatMessages.length === 0) return '';

        const filterFlags = getUniversalMessageFilterFlags(
            chatMessages,
            interactionData.contexts || [],
            interactionData.locations || [],
            allPromptBlocks,
        );

        for (let i = chatMessages.length - 1; i >= 0; i--) {
            if (!filterFlags[i] && chatMessages[i].textContent) {
                return chatMessages[i].textContent;
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