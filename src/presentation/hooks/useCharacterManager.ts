import { useState, useEffect } from 'react';
import { loadAllCharacterShells, loadRawCharacter, saveRawCharacter, deleteRawCharacter } from '../../infrastructure';
import type { Character } from '../../types';

export function useCharacterManager() {
    const [characters, setCharacters] = useState<Character[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    // ✅ Load lightweight shells for list display — no sampler hydration
    const loadCharacters = async () => {
        setIsLoading(true);
        try {
            const data = await loadAllCharacterShells();
            setCharacters(data);
        } catch (err) {
            console.error("Failed to load characters", err);
        } finally {
            setIsLoading(false);
        }
    };

    // ✅ Full hydration on demand — used when opening editor or selecting for chat
    const loadFullCharacter = async (id: string): Promise<Character | null> => {
        try {
            return await loadRawCharacter(id);
        } catch (err) {
            console.error(`Failed to load full character ${id}`, err);
            return null;
        }
    };

    const saveCharacter = async (char: Character) => {
        try {
            await saveRawCharacter(char);
            await loadCharacters(); // Refresh shell list
            return true;
        } catch (err) {
            console.error("Failed to save character", err);
            return false;
        }
    };

    const deleteCharacter = async (id: string) => {
        try {
            await deleteRawCharacter(id);
            await loadCharacters(); // Refresh shell list
            return true;
        } catch (err) {
            console.error("Failed to delete character", err);
            return false;
        }
    };

    // Initial load — shells only, instant on mobile
    useEffect(() => {
        loadCharacters();
    }, []);

    return { characters, isLoading, saveCharacter, deleteCharacter, loadFullCharacter, refresh: loadCharacters };
}