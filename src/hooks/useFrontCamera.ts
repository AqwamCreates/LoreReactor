// src/hooks/useFrontCamera.ts
import { useRef, useCallback, useEffect } from 'react';

const CAMERA_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes to save phone battery

export function useFrontCamera(
    addToast: (message: string, type: 'error' | 'success' | 'info') => void
) {
    const streamRef = useRef<MediaStream | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Cleanly destroy stream and DOM nodes
    const stopStream = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
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
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                addToast('Camera API blocked. Ensure you are on localhost or HTTPS.', 'error');
                return null;
            }

            // Initialize stream if not active
            if (!streamRef.current || !streamRef.current.active) {
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
                
                // Wait for video metadata to load before playing
                await new Promise<void>((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Video load timeout')), 5000);
                    video.onloadedmetadata = () => {
                        clearTimeout(timeout);
                        video.play().then(resolve).catch(reject);
                    };
                    video.onerror = () => {
                        clearTimeout(timeout);
                        reject(new Error('Video element error'));
                    };
                });
            }

            scheduleCleanup();

            const track = streamRef.current.getVideoTracks()[0];
            if (!track) throw new Error('No video track found');

            // ─── CAPTURE STRATEGY ───
            
            // Strategy A: Native ImageCapture API (Android/Chrome Desktop)
            // Triggers the actual hardware shutter for full-res photos (e.g. 12MP)
            if ('ImageCapture' in window) {
                try {
                    const imageCapture = new ImageCapture(track);
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
            // Draws the live video frame to a hidden canvas
            const video = videoRef.current;
            if (!video || video.readyState < 2) {
                throw new Error('Video stream not ready for canvas capture');
            }

            const canvas = document.createElement('canvas');
            const settings = track.getSettings();
            canvas.width = settings.width || video.videoWidth || 1920;
            canvas.height = settings.height || video.videoHeight || 1080;
            
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
        }
    }, [addToast, scheduleCleanup, stopStream]);

    useEffect(() => {
        return () => {
            if (cleanupTimerRef.current) clearTimeout(cleanupTimerRef.current);
            stopStream();
        };
    }, [stopStream]);

    return { captureFrontCameraImage };
}