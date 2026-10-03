// src/hooks/useFrontCamera.ts
import { useRef, useCallback, useEffect } from 'react';

const CAMERA_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export function useFrontCamera(
    addToast: (message: string, type: 'error' | 'success' | 'info') => void
) {
    const streamRef = useRef<MediaStream | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const scheduleCleanup = useCallback(() => {
        if (cleanupTimerRef.current) {
            clearTimeout(cleanupTimerRef.current);
        }
        cleanupTimerRef.current = setTimeout(() => {
            if (streamRef.current) {
                const tracks = streamRef.current.getTracks();
                for (const track of tracks) {
                    track.stop();
                }
                streamRef.current = null;
            }
            if (videoRef.current) {
                videoRef.current.srcObject = null;
                videoRef.current.remove();
                videoRef.current = null;
            }
            cleanupTimerRef.current = null;
        }, CAMERA_IDLE_TIMEOUT_MS);
    }, []);

    const captureFrontCameraImage = useCallback(async (): Promise<string | null> => {
        try {
            if (!streamRef.current || !streamRef.current.active) {
                if (videoRef.current) {
                    videoRef.current.srcObject = null;
                    videoRef.current.remove();
                    videoRef.current = null;
                }
                
                // Request HD (or native max) without forcing a square aspect ratio crop
                streamRef.current = await navigator.mediaDevices.getUserMedia({
                    video: { 
                        facingMode: 'user', 
                        width: { ideal: 1920 }, 
                        height: { ideal: 1080 } 
                    },
                    audio: false,
                });
                
                videoRef.current = document.createElement('video');
                videoRef.current.srcObject = streamRef.current;
                videoRef.current.setAttribute('playsinline', '');
                videoRef.current.muted = true;
                await videoRef.current.play();
                
                await new Promise<void>(resolve => {
                    const check = () => {
                        if (videoRef.current && videoRef.current.readyState >= 2) resolve();
                        else requestAnimationFrame(check);
                    };
                    check();
                });
            }

            scheduleCleanup();

            if (!videoRef.current || videoRef.current.readyState < 2) return null;

            const canvas = document.createElement('canvas');
            // Use the actual video stream dimensions (native uncropped aspect ratio)
            canvas.width = videoRef.current.videoWidth || 1920;
            canvas.height = videoRef.current.videoHeight || 1080;
            
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            
            ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
            
            return canvas.toDataURL('image/jpeg', 1);
        } catch (e) {
            console.error('Front camera capture failed:', e);
            addToast('Failed to capture camera image. Check camera permissions.', 'error');
            return null;
        }
    }, [addToast, scheduleCleanup]);

    useEffect(() => {
        return () => {
            if (cleanupTimerRef.current) {
                clearTimeout(cleanupTimerRef.current);
            }
            if (streamRef.current) {
                const tracks = streamRef.current.getTracks();
                for (const track of tracks) {
                    track.stop();
                }
            }
            if (videoRef.current) {
                videoRef.current.srcObject = null;
                videoRef.current.remove();
            }
        };
    }, []);

    return { captureFrontCameraImage };
}