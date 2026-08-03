import { useState, useEffect } from 'react';
import type { Character } from '../types';
import { loadAllRawCharacters, saveRawCharacter, deleteRawCharacter } from './storage';

export function useCharacterManager() {
    const [characters, setCharacters] = useState<Character[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadCharacters = async () => {
        setIsLoading(true);
        try {
        const data = await loadAllRawCharacters();
        setCharacters(data);
        } catch (err) {
        console.error("Failed to load characters", err);
        } finally {
        setIsLoading(false);
        }
    };

    const saveCharacter = async (char: Character) => {
        try {
        await saveRawCharacter(char);
        await loadCharacters(); // Refresh list
        return true;
        } catch (err) {
        console.error("Failed to save character", err);
        return false;
        }
    };

    const deleteCharacter = async (id: string) => {
        try {
        await deleteRawCharacter(id);
        await loadCharacters(); // Refresh list
        return true;
        } catch (err) {
        console.error("Failed to delete character", err);
        return false;
        }
    };

    // Initial load
    useEffect(() => {
        loadCharacters();
    }, []);

    return { characters, isLoading, saveCharacter, deleteCharacter, refresh: loadCharacters };
}