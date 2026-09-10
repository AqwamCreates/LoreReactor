// src/hooks/useAudioTrackManager.ts
import { useState, useEffect, useCallback } from 'react';
import type { AudioTrack } from '../types';
import { loadAllRawAudioTracks, saveRawAudioTrack, deleteRawAudioTrack } from './storage';
import { useToast } from '../context/ToastContext';

export function useAudioTrackManager() {
    const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const { addToast } = useToast();

    const loadAudioTracks = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await loadAllRawAudioTracks();
            setAudioTracks(data);
        } catch (e) {
            const message = e instanceof Error ? e.message : "Unknown error";
            console.error("Failed to load audio tracks", e);
            addToast(`Failed to load audio tracks: ${message}`, "error");
        } finally {
            setIsLoading(false);
        }
    }, [addToast]);

    const saveAudioTrack = async (track: AudioTrack) => {
        try {
            await saveRawAudioTrack(track);
            await loadAudioTracks();
            addToast(`Audio track "${track.name}" saved`, "success");
            return true;
        } catch (e) {
            const message = e instanceof Error ? e.message : "Unknown error";
            console.error("Failed to save audio track", e);
            addToast(`Failed to save audio track: ${message}`, "error");
            return false;
        }
    };

    const deleteAudioTrack = async (id: string) => {
        try {
            await deleteRawAudioTrack(id);
            await loadAudioTracks();
            addToast("Audio track deleted", "info");
            return true;
        } catch (e) {
            const message = e instanceof Error ? e.message : "Unknown error";
            console.error("Failed to delete audio track", e);
            addToast(`Failed to delete audio track: ${message}`, "error");
            return false;
        }
    };

    useEffect(() => {
        const timeout = setTimeout(() => {
            void loadAudioTracks();
        }, 0);
        return () => clearTimeout(timeout);
    }, [loadAudioTracks]);

    return {
        audioTracks,
        isLoading,
        saveAudioTrack,
        deleteAudioTrack,
        refresh: loadAudioTracks,
    };
}