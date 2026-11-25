// src/frontend_src/services/FrontCameraEngine.ts

const CAMERA_IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes to save battery

export type CameraToastFn = (message: string, type: 'error' | 'success' | 'info') => void;

class FrontCameraEngine {
    private stream: MediaStream | null = null;
    private video: HTMLVideoElement | null = null;
    private cleanupTimer: ReturnType<typeof setTimeout> | null = null;
    private initPromise: Promise<HTMLVideoElement | null> | null = null;
    private capturePromise: Promise<string | null> | null = null;

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

                // ─── CAPTURE STRATEGY ───

                // Strategy A: Native ImageCapture API (Android/Chrome Desktop)
                if ('ImageCapture' in window) {
                    try {
                        const imageCapture = new (window as any).ImageCapture(track);
                        const blob = await imageCapture.takePhoto();
                        return await new Promise<string>((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result as string);
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });
                    } catch (e) {
                        console.warn('[FrontCameraEngine] ImageCapture.takePhoto failed, falling back to canvas.', e);
                    }
                }

                // Strategy B: Canvas Fallback (Required for iOS Safari, Firefox)
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

                const canvas = document.createElement('canvas');
                const settings = track.getSettings();
                canvas.width = video.videoWidth || settings.width || 1920;
                canvas.height = video.videoHeight || settings.height || 1080;

                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('Failed to get canvas 2d context');

                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                return canvas.toDataURL('image/jpeg', 0.95);
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
        this.keepAliveHolders.clear();
        this.monitorCameraBlocked = false;
        this.stopStream();
    }
}

export const frontCameraEngine = new FrontCameraEngine();