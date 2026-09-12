import { useState, useEffect } from 'react';
import type { Location } from '../types';
import { loadAllRawLocations, saveRawLocation, deleteRawLocation } from '../storage/serverStorage';

export function useLocationManager() {
    const [locations, setLocations] = useState<Location[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadLocations = async () => {
        setIsLoading(true);
        try {
            const data = await loadAllRawLocations();
            setLocations(data);
        } catch (error) {
            console.error("Failed to load locations", error);
        } finally {
            setIsLoading(false);
        }
    };

    const saveLocation = async (location: Location) => {
        try {
            await saveRawLocation(location);
            await loadLocations();
            return true;
        } catch (error) {
            console.error("Failed to save location", error);
            return false;
        }
    };

    const deleteLocation = async (id: string) => {
        try {
            await deleteRawLocation(id);
            await loadLocations();
            return true;
        } catch (error) {
            console.error("Failed to delete location", error);
            return false;
        }
    };

    useEffect(() => {
        loadLocations();
    }, []);

    return { locations, isLoading, saveLocation, deleteLocation, refresh: loadLocations };
}