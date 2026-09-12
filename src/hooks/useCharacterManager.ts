import { useState, useEffect } from 'react';
import type { Character } from '../types';
import { loadAllCharacterShells, loadRawCharacter, saveRawCharacter, deleteRawCharacter } from '../storage/storage';

export function useCharacterManager() {
    const [characters, setCharacters] = useState<Character[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    // ✅ Load lightweight shells for list display — no sampler hydration
    const loadCharacters = async () => {
        setIsLoading(true);
        try {
            const data = await loadAllCharacterShells();
            setCharacters(data);
        } catch (error) {
            console.error("Failed to load characters", error);
        } finally {
            setIsLoading(false);
        }
    };

    // ✅ Full hydration on demand — used when opening editor or selecting for chat
    const loadFullCharacter = async (id: string): Promise<Character | null> => {
        try {
            return await loadRawCharacter(id);
        } catch (error) {
            console.error(`Failed to load full character ${id}`, error);
            return null;
        }
    };

    const saveCharacter = async (char: Character) => {
        try {
            await saveRawCharacter(char);
            await loadCharacters(); // Refresh shell list
            return true;
        } catch (error) {
            console.error("Failed to save character", error);
            return false;
        }
    };

    const deleteCharacter = async (id: string) => {
        try {
            await deleteRawCharacter(id);
            await loadCharacters(); // Refresh shell list
            return true;
        } catch (error) {
            console.error("Failed to delete character", error);
            return false;
        }
    };

    // Initial load — shells only, instant on mobile
    useEffect(() => {
        loadCharacters();
    }, []);

    return { characters, isLoading, saveCharacter, deleteCharacter, loadFullCharacter, refresh: loadCharacters };
}