// src/frontend_src/hooks/useFrontCamera.ts

import { useRef, useCallback, useEffect } from 'react';

const CAMERA_IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes to save battery

export function useFrontCamera(
    addToast: (message: string, type: 'error' | 'success' | 'info') => void
) {
    const streamRef = useRef<MediaStream | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const inFlightRef = useRef<Promise<string | null> | null>(null);

    // Cleanly destroy stream and DOM nodes
    const stopStream = useCallback(() => {
        if (streamRef.current) {
            for (const track of streamRef.current.getTracks()) {
                track.stop();
            }
            streamRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
            videoRef.current.remove();
            videoRef.current = null;
        }
    }, []);

    const scheduleCleanup = useCallback(() => {
        if (cleanupTimerRef.current) clearTimeout(cleanupTimerRef.current);
        cleanupTimerRef.current = setTimeout(() => {
            stopStream();
            cleanupTimerRef.current = null;
        }, CAMERA_IDLE_TIMEOUT_MS);
    }, [stopStream]);

    const captureFrontCameraImage = useCallback(async (): Promise<string | null> => {
        if (inFlightRef.current) {
            return inFlightRef.current;
        }

        const capturePromise = (async (): Promise<string | null> => {
            try {
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    addToast('Camera API blocked. Ensure you are on localhost or HTTPS.', 'error');
                    return null;
                }

                const existingTrack = streamRef.current?.getVideoTracks()[0];
                const isStreamReusable = Boolean(
                    streamRef.current &&
                    streamRef.current.active &&
                    existingTrack &&
                    existingTrack.readyState === 'live' &&
                    videoRef.current
                );

                // Initialize stream if not active
                if (!isStreamReusable) {
                    stopStream(); // Clean up any dead references

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
                            throw err; // Re-throw permission or hardware errors
                        }
                    }

                    streamRef.current = stream;
                    
                    const video = document.createElement('video');
                    video.srcObject = stream;
                    video.setAttribute('playsinline', ''); // ⚠️ CRITICAL for iOS Safari
                    video.setAttribute('autoplay', '');
                    video.muted = true;
                    videoRef.current = video;
                    
                    // Wait for video playback and first decoded frame before capturing
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
                }

                scheduleCleanup();

                const track = streamRef.current?.getVideoTracks()[0];
                if (!track) throw new Error('No video track found');

                // ─── CAPTURE STRATEGY ───
                
                // Strategy A: Native ImageCapture API (Android/Chrome Desktop)
                // Triggers the actual hardware shutter for full-res photos (e.g. 12MP)
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
                        console.warn('ImageCapture.takePhoto failed, falling back to canvas.', e);
                        // Fallthrough to Canvas Strategy
                    }
                }

                // Strategy B: Canvas Fallback (Required for iOS Safari, Firefox)
                // Draws the live video frame to a hidden canvas at full native resolution
                const video = videoRef.current;
                if (!video) {
                    throw new Error('Video element not initialized');
                }
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
                console.error('Front camera capture failed:', e);
                
                // Granular Error Handling
                if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
                    addToast('Camera permission denied. Check browser settings.', 'error');
                } else if (e.name === 'NotFoundError') {
                    addToast('No camera detected on this device.', 'error');
                } else if (e.name === 'NotReadableError') {
                    addToast('Camera is in use by another app (e.g., Zoom).', 'error');
                } else {
                    addToast(`Camera error: ${e.message || 'Unknown error'}`, 'error');
                }
                
                // Destroy stream on fatal error so it re-initializes cleanly next time
                stopStream();
                return null;
            } finally {
                inFlightRef.current = null;
            }
        })();

        inFlightRef.current = capturePromise;
        return capturePromise;
    }, [addToast, scheduleCleanup, stopStream]);

    useEffect(() => {
        return () => {
            if (cleanupTimerRef.current) clearTimeout(cleanupTimerRef.current);
            stopStream();
        };
    }, [stopStream]);

    return { captureFrontCameraImage };
}