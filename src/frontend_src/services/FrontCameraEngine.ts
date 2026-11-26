// src/frontend_src/services/FrontCameraEngine.ts

const CAMERA_IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes to save battery
const MAX_BUFFERED_FRAMES = 5;
const DEFAULT_FRAME_MAX_AGE_MS = 15_000;
const MIN_STREAM_INTERVAL_MS = 250;

export type CameraToastFn = (message: string, type: 'error' | 'success' | 'info') => void;

export interface LiveCameraFrame {
    timestamp: number;
    dataUrl: string;
    width: number;
    height: number;
}

class FrontCameraEngine {
    private stream: MediaStream | null = null;
    private video: HTMLVideoElement | null = null;
    private cleanupTimer: ReturnType<typeof setTimeout> | null = null;
    private initPromise: Promise<HTMLVideoElement | null> | null = null;
    private capturePromise: Promise<string | null> | null = null;

    // Full-resolution frame streaming buffer
    private bufferCanvas: HTMLCanvasElement | null = null;
    private bufferCtx: CanvasRenderingContext2D | null = null;
    private frameBuffer: LiveCameraFrame[] = [];
    private streamTimer: ReturnType<typeof setTimeout> | null = null;
    private frameStreamingActive = false;
    private streamEpoch = 0;
    private streamIntervalMs = 1000;
    private activeProtagonistId: string | null = null;

    private keepAliveHolders = new Set<string>();
    private errorListeners = new Set<CameraToastFn>();
    private monitorCameraBlocked = false;

    onError(listener: CameraToastFn): () => void {
        this.errorListeners.add(listener);
        return () => {
            this.errorListeners.delete(listener);
        };
    }

    private emitError(message: string): void {
        for (const listener of this.errorListeners) {
            try {
                listener(message, 'error');
            } catch {
                // ignore listener errors
            }
        }
    }

    private reportCameraError(e: any): void {
        if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
            this.emitError('Camera permission denied. Check browser settings.');
        } else if (e?.name === 'NotFoundError') {
            this.emitError('No camera detected on this device.');
        } else if (e?.name === 'NotReadableError') {
            this.emitError('Camera is in use by another app (e.g., Zoom).');
        } else {
            this.emitError(`Camera error: ${e?.message || 'Unknown error'}`);
        }
    }

    private clearCleanupTimer(): void {
        if (this.cleanupTimer !== null) {
            clearTimeout(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    private scheduleCleanup(): void {
        this.clearCleanupTimer();
        if (this.keepAliveHolders.size > 0) return;

        this.cleanupTimer = setTimeout(() => {
            if (this.keepAliveHolders.size === 0) {
                this.stopStream();
            }
            this.cleanupTimer = null;
        }, CAMERA_IDLE_TIMEOUT_MS);
    }

    private isStreamReusable(): boolean {
        const existingTrack = this.stream?.getVideoTracks()[0];
        return Boolean(
            this.stream &&
            this.stream.active &&
            existingTrack &&
            existingTrack.readyState === 'live' &&
            this.video
        );
    }

    private stopStream(): void {
        this.clearCleanupTimer();
        if (this.stream) {
            for (const track of this.stream.getTracks()) {
                track.onended = null;
                track.stop();
            }
            this.stream = null;
        }
        if (this.video) {
            this.video.srcObject = null;
            this.video.remove();
            this.video = null;
        }
    }

    setKeepAlive(holderId: string, active: boolean): void {
        if (active) {
            this.keepAliveHolders.add(holderId);
            this.monitorCameraBlocked = false;
            this.clearCleanupTimer();
        } else {
            this.keepAliveHolders.delete(holderId);
            this.monitorCameraBlocked = false;
            if (this.keepAliveHolders.size === 0 && this.stream) {
                this.scheduleCleanup();
            }
        }
    }

    setActiveProtagonistId(protagonistId: string | null): void {
        this.activeProtagonistId = protagonistId;
    }

    isOwnedBy(characterId: string): boolean {
        return this.activeProtagonistId === null || this.activeProtagonistId === characterId;
    }

    isFrameStreamingActive(): boolean {
        return this.frameStreamingActive;
    }

    private pushFrameToBuffer(frame: LiveCameraFrame): void {
        this.frameBuffer.push(frame);
        if (this.frameBuffer.length > MAX_BUFFERED_FRAMES) {
            this.frameBuffer.splice(0, this.frameBuffer.length - MAX_BUFFERED_FRAMES);
        }
    }

    /** Captures full native camera resolution frame (zero cropping, zero downscaling) */
    private captureFullCanvasFrame(): LiveCameraFrame | null {
        const video = this.video;
        if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
            return null;
        }

        const track = this.stream?.getVideoTracks()[0];
        const settings = track?.getSettings();
        const width = video.videoWidth || settings?.width || 1920;
        const height = video.videoHeight || settings?.height || 1080;

        if (!this.bufferCanvas && typeof document !== 'undefined') {
            this.bufferCanvas = document.createElement('canvas');
        }
        if (!this.bufferCanvas) return null;

        if (this.bufferCanvas.width !== width || this.bufferCanvas.height !== height) {
            this.bufferCanvas.width = width;
            this.bufferCanvas.height = height;
            this.bufferCtx = this.bufferCanvas.getContext('2d');
        } else if (!this.bufferCtx) {
            this.bufferCtx = this.bufferCanvas.getContext('2d');
        }

        if (!this.bufferCtx) return null;

        this.bufferCtx.drawImage(video, 0, 0, width, height);
        const dataUrl = this.bufferCanvas.toDataURL('image/jpeg', 0.95);

        return {
            timestamp: Date.now(),
            dataUrl,
            width,
            height,
        };
    }

    private scheduleNextStreamTick(epoch: number, delayMs: number): void {
        if (!this.frameStreamingActive || epoch !== this.streamEpoch) return;

        if (this.streamTimer !== null) {
            clearTimeout(this.streamTimer);
            this.streamTimer = null;
        }

        this.streamTimer = setTimeout(() => {
            this.streamTimer = null;
            void this.runStreamTick(epoch);
        }, delayMs);
    }

    private async runStreamTick(epoch: number): Promise<void> {
        if (!this.frameStreamingActive || epoch !== this.streamEpoch) return;

        const tickStart = performance.now();
        try {
            const video = await this.ensureVideoElement(true);
            if (!this.frameStreamingActive || epoch !== this.streamEpoch) return;

            if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
                const frame = this.captureFullCanvasFrame();
                if (frame) {
                    this.pushFrameToBuffer(frame);
                }
            }
        } catch (e) {
            console.warn('[FrontCameraEngine] Frame stream tick error:', e);
        } finally {
            if (this.frameStreamingActive && epoch === this.streamEpoch) {
                const elapsed = performance.now() - tickStart;
                const nextDelay = Math.max(MIN_STREAM_INTERVAL_MS, this.streamIntervalMs - elapsed);
                this.scheduleNextStreamTick(epoch, nextDelay);
            }
        }
    }

    startFrameStreaming(intervalMs = 1000): void {
        const clampedInterval = Math.max(MIN_STREAM_INTERVAL_MS, Math.round(intervalMs));
        if (this.frameStreamingActive && this.streamIntervalMs === clampedInterval) {
            return;
        }

        this.streamIntervalMs = clampedInterval;
        const epoch = ++this.streamEpoch;
        this.frameStreamingActive = true;
        this.setKeepAlive('frame_stream', true);

        if (this.streamTimer !== null) {
            clearTimeout(this.streamTimer);
            this.streamTimer = null;
        }

        this.scheduleNextStreamTick(epoch, 0);
    }

    stopFrameStreaming(): void {
        this.streamEpoch++;
        this.frameStreamingActive = false;

        if (this.streamTimer !== null) {
            clearTimeout(this.streamTimer);
            this.streamTimer = null;
        }

        this.frameBuffer = [];
        this.setKeepAlive('frame_stream', false);
    }

    /**
     * Picks up the latest full-resolution camera frames for a character turn.
     * Captures the exact live frame right now (`T_now`) if the stream is active,
     * paired with an earlier buffered frame so the model can see recent motion/state.
     */
    getTurnFrames(maxFrames = 2, maxAgeMs = DEFAULT_FRAME_MAX_AGE_MS): LiveCameraFrame[] {
        const now = Date.now();

        if (this.isStreamReusable()) {
            const last = this.frameBuffer[this.frameBuffer.length - 1];
            if (!last || now - last.timestamp >= 150) {
                const fresh = this.captureFullCanvasFrame();
                if (fresh) {
                    this.pushFrameToBuffer(fresh);
                }
            }
        }

        const freshNow = Date.now();
        const valid = this.frameBuffer.filter(f => freshNow - f.timestamp <= maxAgeMs);
        if (valid.length === 0 || maxFrames <= 0) return [];
        if (valid.length <= maxFrames) return valid;

        if (maxFrames === 1) {
            return [valid[valid.length - 1]];
        }

        // Pick evenly spaced frames ending with the live frame
        const selected: LiveCameraFrame[] = [];
        const step = (valid.length - 1) / (maxFrames - 1);
        for (let i = 0; i < maxFrames; i++) {
            const idx = Math.round(i * step);
            const candidate = valid[idx];
            if (selected[selected.length - 1] !== candidate) {
                selected.push(candidate);
            }
        }
        return selected;
    }

    getLatestFrame(maxAgeMs = DEFAULT_FRAME_MAX_AGE_MS): LiveCameraFrame | null {
        const frames = this.getTurnFrames(1, maxAgeMs);
        return frames.length > 0 ? frames[0] : null;
    }

    private async ensureVideoElement(isMonitoringCall = false): Promise<HTMLVideoElement | null> {
        if (this.isStreamReusable()) {
            if (!isMonitoringCall) {
                this.scheduleCleanup();
            }
            return this.video;
        }

        if (isMonitoringCall && this.monitorCameraBlocked) {
            return null;
        }

        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = (async (): Promise<HTMLVideoElement | null> => {
            try {
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    if (!isMonitoringCall || !this.monitorCameraBlocked) {
                        this.emitError('Camera API blocked. Ensure you are on localhost or HTTPS.');
                    }
                    if (isMonitoringCall) this.monitorCameraBlocked = true;
                    return null;
                }

                this.stopStream();

                let stream: MediaStream | null = null;

                // ─── CROSS-PLATFORM CONSTRAINT RESOLUTION ───
                try {
                    // 1. Try Mobile Front Camera Constraint
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
                        audio: false,
                    });
                } catch (err: any) {
                    // 2. Fallback for Laptops (OverconstrainedError or NotFoundError)
                    if (err.name === 'OverconstrainedError' || err.name === 'NotFoundError') {
                        stream = await navigator.mediaDevices.getUserMedia({
                            video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
                            audio: false,
                        });
                    } else {
                        throw err;
                    }
                }

                this.stream = stream;

                const videoTrack = stream.getVideoTracks()[0];
                if (videoTrack) {
                    videoTrack.onended = () => {
                        if (this.stream === stream) {
                            this.stopStream();
                        }
                    };
                }

                const video = document.createElement('video');
                video.srcObject = stream;
                video.setAttribute('playsinline', ''); // ⚠️ CRITICAL for iOS Safari
                video.setAttribute('autoplay', '');
                video.muted = true;
                this.video = video;

                // Wait for video playback and first decoded frame
                await new Promise<void>((resolve, reject) => {
                    let settled = false;
                    const timeout = setTimeout(() => {
                        if (settled) return;
                        settled = true;
                        reject(new Error('Video load timeout'));
                    }, 5000);

                    const finishReady = () => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timeout);
                        resolve();
                    };

                    video.onerror = () => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timeout);
                        reject(new Error('Video element error'));
                    };

                    video.onloadedmetadata = () => {
                        video.play()
                            .then(() => {
                                if (video.readyState >= 2 && video.videoWidth > 0) {
                                    finishReady();
                                } else {
                                    video.onloadeddata = () => finishReady();
                                    video.oncanplay = () => finishReady();
                                }
                            })
                            .catch((err) => {
                                if (settled) return;
                                settled = true;
                                clearTimeout(timeout);
                                reject(err);
                            });
                    };
                });

                this.monitorCameraBlocked = false;
                if (!isMonitoringCall) {
                    this.scheduleCleanup();
                }
                return this.video;
            } catch (e: any) {
                console.error('[FrontCameraEngine] Camera initialization failed:', e);
                if (!isMonitoringCall || !this.monitorCameraBlocked) {
                    this.reportCameraError(e);
                }
                if (isMonitoringCall) {
                    this.monitorCameraBlocked = true;
                }
                this.stopStream();
                return null;
            } finally {
                this.initPromise = null;
            }
        })();

        return this.initPromise;
    }

    async getVideoElement(isMonitoringCall = true): Promise<HTMLVideoElement | null> {
        if (this.isStreamReusable()) {
            return this.video;
        }
        return this.ensureVideoElement(isMonitoringCall);
    }

    async captureImage(): Promise<string | null> {
        if (this.capturePromise) {
            return this.capturePromise;
        }

        this.monitorCameraBlocked = false;

        const task = (async (): Promise<string | null> => {
            try {
                const video = await this.ensureVideoElement(false);
                if (!video) return null;

                this.scheduleCleanup();

                const track = this.stream?.getVideoTracks()[0];
                if (!track) throw new Error('No video track found');

                // Strategy A: Native ImageCapture API (Android/Chrome Desktop)
                if ('ImageCapture' in window) {
                    try {
                        const imageCapture = new (window as any).ImageCapture(track);
                        const blob = await imageCapture.takePhoto();
                        const dataUrl = await new Promise<string>((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result as string);
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });
                        const settings = track.getSettings();
                        this.pushFrameToBuffer({
                            timestamp: Date.now(),
                            dataUrl,
                            width: video.videoWidth || settings.width || 1920,
                            height: video.videoHeight || settings.height || 1080,
                        });
                        return dataUrl;
                    } catch (e) {
                        console.warn('[FrontCameraEngine] ImageCapture.takePhoto failed, falling back to canvas.', e);
                    }
                }

                // Strategy B: Full-resolution Canvas Fallback
                if (video.readyState < 2) {
                    await new Promise<void>((resolve, reject) => {
                        let settled = false;
                        const timeout = setTimeout(() => {
                            if (settled) return;
                            settled = true;
                            reject(new Error('Video stream not ready for canvas capture'));
                        }, 3000);
                        const onReady = () => {
                            if (settled) return;
                            if (video.readyState >= 2) {
                                settled = true;
                                clearTimeout(timeout);
                                resolve();
                            }
                        };
                        video.addEventListener('loadeddata', onReady, { once: true });
                        video.addEventListener('canplay', onReady, { once: true });
                    });
                }

                const frame = this.captureFullCanvasFrame();
                if (!frame) throw new Error('Failed to capture canvas frame');
                this.pushFrameToBuffer(frame);
                return frame.dataUrl;
            } catch (e: any) {
                console.error('[FrontCameraEngine] Capture failed:', e);
                this.reportCameraError(e);
                this.stopStream();
                return null;
            } finally {
                this.capturePromise = null;
            }
        })();

        this.capturePromise = task;
        return task;
    }

    stop(): void {
        this.stopFrameStreaming();
        this.keepAliveHolders.clear();
        this.monitorCameraBlocked = false;
        this.bufferCanvas = null;
        this.bufferCtx = null;
        this.stopStream();
    }
}

export const frontCameraEngine = new FrontCameraEngine();