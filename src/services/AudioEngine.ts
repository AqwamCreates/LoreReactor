// src/services/AudioEngine.ts
import type { AudioTrack, InteractionData, ChatMessage } from '../types';
import { localURL } from '../configurations';

interface ActiveTrackState {
    track: AudioTrack;
    source: AudioBufferSourceNode | null;
    gainNode: GainNode;
    targetVolume: number;
    isPlaying: boolean;
}

export class AudioEngine {
    private ctx: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private activeTracks: Map<string, ActiveTrackState> = new Map();
    private bufferCache: Map<string, AudioBuffer> = new Map();
    private globalVolumeOverride: number = -1; // -1 = per-track default
    private animationFrameId: number | null = null;
    private lastEvaluatedMessageCount: number = 0;
    private lastActiveLocationId: string | undefined = undefined;
    private lastActiveContextIds: Set<string> = new Set();

    private ensureContext(): AudioContext {
        if (!this.ctx) {
            this.ctx = new AudioContext();
            this.masterGain = this.ctx.createGain();
            this.masterGain.connect(this.ctx.destination);
            this.masterGain.gain.value = 1;
        }
        if (this.ctx.state === 'suspended') {
            void this.ctx.resume();
        }
        return this.ctx;
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
        if (this.bufferCache.has(filename)) {
            return this.bufferCache.get(filename)!;
        }

        try {
            const url = this.getAudioUrl(filename);
            const response = await fetch(url);
            if (!response.ok) return null;
            const arrayBuffer = await response.arrayBuffer();
            const ctx = this.ensureContext();
            const buffer = await ctx.decodeAudioData(arrayBuffer);
            this.bufferCache.set(filename, buffer);
            return buffer;
        } catch (e) {
            console.warn(`Failed to load audio buffer for ${filename}:`, e);
            return null;
        }
    }

    private startTrack(track: AudioTrack): void {
        if (this.activeTracks.has(track.id)) return;

        const ctx = this.ensureContext();
        const gainNode = ctx.createGain();
        gainNode.connect(this.masterGain!);
        gainNode.gain.value = 0; // Start silent for fade-in

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

            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.loop = track.loop;
            source.connect(gainNode);
            source.start(0);

            state.source = source;
            state.isPlaying = true;

            // Fade in
            const fadeDuration = Math.max(0.01, track.startFadeDurationMs / 1000);
            gainNode.gain.setValueAtTime(0, ctx.currentTime);
            gainNode.gain.linearRampToValueAtTime(state.targetVolume, ctx.currentTime + fadeDuration);

            source.onended = () => {
                if (!track.loop && this.activeTracks.has(track.id)) {
                    this.stopTrack(track.id);
                }
            };
        });
    }

    private stopTrack(trackId: string): void {
        const state = this.activeTracks.get(trackId);
        if (!state) return;

        const ctx = this.ctx;
        if (!ctx) {
            this.activeTracks.delete(trackId);
            return;
        }

        // Fade out then disconnect
        const fadeDuration = Math.max(0.01, state.track.endFadeDurationMs / 1000);
        state.gainNode.gain.setValueAtTime(state.gainNode.gain.value, ctx.currentTime);
        state.gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeDuration);

        setTimeout(() => {
            try {
                state.source?.stop();
            } catch { /* already stopped */ }
            state.gainNode.disconnect();
            this.activeTracks.delete(trackId);
        }, fadeDuration * 1000 + 50);
    }

    /**
     * Evaluates which tracks should be active based on current chat state.
     * Call this whenever interaction data changes (new message, location change, etc.).
     */
    evaluate(interactionData: InteractionData): void {
        const tracks = interactionData.audioTracks || [];
        if (tracks.length === 0) {
            // No tracks configured — stop everything
            for (const id of [...this.activeTracks.keys()]) {
                this.stopTrack(id);
            }
            return;
        }

        // Determine current active location
        const currentLocationId = this.getCurrentLocationId(interactionData);
        const currentContextIds = new Set((interactionData.contexts || []).map(c => c.id));

        // Get the latest message text for regex matching
        const latestMessageText = this.getLatestMessageText(interactionData);

        // Evaluate each track
        const shouldBeActive = new Set<string>();

        for (const track of tracks) {
            let active = false;

            // Regex activation trigger
            if (track.regularExpressionActivationTrigger && latestMessageText) {
                try {
                    const regex = new RegExp(track.regularExpressionActivationTrigger, 'i');
                    if (regex.test(latestMessageText)) {
                        active = true;
                    }
                } catch { /* invalid regex, skip */ }
            }

            // Regex deactivation trigger overrides activation
            if (active && track.regularExpressionDeactivationTrigger && latestMessageText) {
                try {
                    const regex = new RegExp(track.regularExpressionDeactivationTrigger, 'i');
                    if (regex.test(latestMessageText)) {
                        active = false;
                    }
                } catch { /* invalid regex, skip */ }
            }

            // Location binding: active if current location matches any binding
            if (!active && track.locationBindings.length > 0 && currentLocationId) {
                if (track.locationBindings.includes(currentLocationId)) {
                    active = true;
                }
            }

            // Context binding: active if any bound context is currently active
            if (!active && track.contextBindings.length > 0) {
                for (const ctxId of track.contextBindings) {
                    if (currentContextIds.has(ctxId)) {
                        active = true;
                        break;
                    }
                }
            }

            // If no triggers or bindings are configured, track is always active
            if (!track.regularExpressionActivationTrigger &&
                track.locationBindings.length === 0 &&
                track.contextBindings.length === 0) {
                active = true;
            }

            if (active) {
                shouldBeActive.add(track.id);
            }
        }

        // Start tracks that should be active but aren't
        for (const trackId of shouldBeActive) {
            if (!this.activeTracks.has(trackId)) {
                const track = tracks.find(t => t.id === trackId);
                if (track) this.startTrack(track);
            }
        }

        // Stop tracks that are active but shouldn't be
        for (const [trackId] of this.activeTracks) {
            if (!shouldBeActive.has(trackId)) {
                this.stopTrack(trackId);
            }
        }

        // Update volumes for active tracks (global override may have changed)
        for (const [trackId, state] of this.activeTracks) {
            const track = tracks.find(t => t.id === trackId);
            if (track) {
                state.targetVolume = this.getEffectiveVolume(track);
            }
        }

        this.lastEvaluatedMessageCount = interactionData.interactionHistory.length;
        this.lastActiveLocationId = currentLocationId;
        this.lastActiveContextIds = currentContextIds;
    }

    private getCurrentLocationId(interactionData: InteractionData): string | undefined {
        // Find the most recent interaction message with a locationIndex
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

    private getLatestMessageText(interactionData: InteractionData): string {
        const history = interactionData.interactionHistory;
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            if (msg.kind === 'chat' && (msg as ChatMessage).textContent) {
                return (msg as ChatMessage).textContent;
            }
        }
        return '';
    }

    /** Smoothly ramp active track gains toward their target volumes. */
    private tickVolumes(): void {
        if (!this.ctx) return;

        for (const state of this.activeTracks.values()) {
            if (!state.isPlaying) continue;
            const current = state.gainNode.gain.value;
            const target = state.targetVolume;
            const diff = target - current;
            if (Math.abs(diff) < 0.001) {
                state.gainNode.gain.value = target;
            } else {
                // Smooth approach: move 10% of the remaining distance per tick (~60fps)
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
        if (this.ctx) {
            void this.ctx.close();
            this.ctx = null;
            this.masterGain = null;
        }
    }
}

// Singleton
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