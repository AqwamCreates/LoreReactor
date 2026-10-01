// src/hooks/useProfileManager.ts
import { useState } from 'react';
import type { profile } from '../types';
import { loadAllRawProfiles, saveRawProfile, deleteRawProfile } from '../storages/serverStorage';

export function useProfileManager() {
    const [profiles, setProfiles] = useState<profile[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadProfiles = async () => {
        setIsLoading(true);
        try {
            const data = await loadAllRawProfiles();
            setProfiles(data);
        } finally {
            setIsLoading(false);
        }
    };

    const saveProfile = async (profile: profile) => {
        try {
            await saveRawProfile(profile);
            await loadProfiles();
            return true;
        } catch {
            return false;
        }
    };

    const deleteProfile = async (id: string) => {
        try {
            await deleteRawProfile(id);
            await loadProfiles();
            return true;
        } catch {
            return false;
        }
    };

    useState(() => { loadProfiles() });

    return {
        profiles,
        isLoading,
        saveProfile,
        deleteProfile,
        refresh: loadProfiles,
    };
}