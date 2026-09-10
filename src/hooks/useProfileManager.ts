// src/hooks/useProfileManager.ts
import { useState, useEffect } from 'react';
import type { Profile } from '../types';
import { loadAllRawProfiles, saveRawProfile, deleteRawProfile } from './storage';
import { useToast } from '../context/ToastContext';

export function useProfileManager() {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const { addToast } = useToast();

    const loadProfiles = async () => {
        setIsLoading(true);
        try {
            const data = await loadAllRawProfiles();
            setProfiles(data);
        } catch (error) {
            console.error("Failed to load profiles", error);
            addToast("Failed to load profiles list", "error");
        } finally {
            setIsLoading(false);
        }
    };

    const saveProfile = async (profile: Profile) => {
        try {
            await saveRawProfile(profile);
            await loadProfiles();
            addToast(`Profile "${profile.name}" saved`, "success");
            return true;
        } catch (error) {
            console.error("Failed to save profile", error);
            addToast("Failed to save profile", "error");
            return false;
        }
    };

    const deleteProfile = async (id: string) => {
        try {
            await deleteRawProfile(id);
            await loadProfiles();
            addToast("Profile deleted", "info");
            return true;
        } catch (error) {
            console.error("Failed to delete profile", error);
            addToast("Failed to delete profile", "error");
            return false;
        }
    };

    useEffect(() => {
        loadProfiles();
    }, []);

    return {
        profiles,
        isLoading,
        saveProfile,
        deleteProfile,
        refresh: loadProfiles,
    };
}