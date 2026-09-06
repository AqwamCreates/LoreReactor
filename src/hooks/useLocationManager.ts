import { useState, useEffect } from 'react';
import type { Location } from '../types';
import { loadAllRawLocations, saveRawLocation, deleteRawLocation } from './storage';

export function useLocationManager() {
    const [locations, setLocations] = useState<Location[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadLocations = async () => {
        setIsLoading(true);
        try {
            const data = await loadAllRawLocations();
            setLocations(data);
        } catch (err) {
            console.error("Failed to load locations", err);
        } finally {
            setIsLoading(false);
        }
    };

    const saveLocation = async (location: Location) => {
        try {
            await saveRawLocation(location);
            await loadLocations();
            return true;
        } catch (err) {
            console.error("Failed to save location", err);
            return false;
        }
    };

    const deleteLocation = async (id: string) => {
        try {
            await deleteRawLocation(id);
            await loadLocations();
            return true;
        } catch (err) {
            console.error("Failed to delete location", err);
            return false;
        }
    };

    useEffect(() => {
        loadLocations();
    }, []);

    return { locations, isLoading, saveLocation, deleteLocation, refresh: loadLocations };
}