// src/hooks/useAudioTrackManager.ts
import { useState, useEffect, useCallback } from 'react';
import type { AudioTrack } from '../types';
import { loadAllRawAudioTracks, saveRawAudioTrack, deleteRawAudioTrack } from '../storage/serverStorage';

export function useAudioTrackManager() {
    const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadAudioTracks = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await loadAllRawAudioTracks();
            setAudioTracks(data);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const saveAudioTrack = async (track: AudioTrack) => {
        try {
            await saveRawAudioTrack(track);
            await loadAudioTracks();
            return true;
        } catch {
            return false;
        }
    };

    const deleteAudioTrack = async (id: string) => {
        try {
            await deleteRawAudioTrack(id);
            await loadAudioTracks();
            return true;
        } catch {
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