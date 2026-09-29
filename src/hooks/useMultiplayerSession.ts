// src/hooks/useMultiplayerSession.ts

import { useState, useRef, useEffect, useCallback } from "react";
import { loadRawMultiplayerJoinData, deleteMultiplayerJoinData, saveRawMultiplayerJoinData } from "../storages/serverStorage";
import type { InteractionData, Character, HistoryMessage, LanguageModel, MultiplayerData } from "../types";
import { useMultiplayerSync } from "./useMultiplayerSync";
import { useSessionStore } from "./useSessionStore";

interface UseMultiplayerSessionOptions {
    allCharacters: Character[];
    saveMultiplayerData: (data: MultiplayerData) => Promise<boolean>;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export function useMultiplayerSession(options: UseMultiplayerSessionOptions) {
    const { allCharacters, saveMultiplayerData, addToast } = options;

    const currentAccountId = useSessionStore((s: any) => s.currentAccountId);
    const multiplayerData = useSessionStore((s: any) => s.multiplayerData);
    const setInteractionData = useSessionStore((s: any) => s.setInteractionData) as ((data: InteractionData) => void) | undefined;
    const setSelectedCharacter = useSessionStore((s: any) => s.setSelectedCharacter) as ((char: Character | null) => void) | undefined;

    const [joinSessionId, setJoinSessionId] = useState<string | null>(null);
    const [joinPassword, setJoinPassword] = useState('');
    const [joinProtagonist, setJoinProtagonist] = useState<Character | null>(null);
    const [joinRequestedCharacterId, setJoinRequestedCharacterId] = useState<string | null>(null);
    const [joinRequestedCharacterData, setJoinRequestedCharacterData] = useState<Character | null>(null);

    const broadcastMessageRef = useRef<((message: HistoryMessage) => void) | undefined>(undefined);
    const requestBorrowedModelRef = useRef<() => Promise<LanguageModel | null>>(async () => null);

    const isMultiplayerClient = !!joinSessionId;

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await loadRawMultiplayerJoinData();
                if (cancelled) return;
                setJoinSessionId(data.joinSessionId ?? null);
                setJoinPassword(data.joinPassword ?? '');
                setJoinProtagonist(data.joinProtagonist ?? null);
                setJoinRequestedCharacterId(data.joinRequestedCharacterId ?? null);
                setJoinRequestedCharacterData(data.joinRequestedCharacterData ?? null);
            } catch (e) {
                console.warn('Failed to load multiplayer join data:', e);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const clearJoinState = useCallback(() => {
        setJoinSessionId(null);
        setJoinPassword('');
        setJoinProtagonist(null);
        setJoinRequestedCharacterId(null);
        setJoinRequestedCharacterData(null);
        deleteMultiplayerJoinData().catch((e: unknown) => console.warn('Failed to clear join data:', e));
    }, []);

    const handleJoinAccepted = useCallback((assignedCharacter: Character) => {
        addToast(`Joined session as ${assignedCharacter.name}.`, 'success');
        saveRawMultiplayerJoinData({
            joinSessionId,
            joinPassword,
            joinProtagonist: assignedCharacter,
        }).catch((e: unknown) => console.warn('Failed to save join data:', e));
        setJoinProtagonist(assignedCharacter);
        setSelectedCharacter?.(assignedCharacter);
    }, [addToast, joinSessionId, joinPassword, setSelectedCharacter]);

    const handleCharacterSelectionRequired = useCallback((initialState: any) => {
        // Automatically default to the first available protagonist/participant if none explicitly chosen
        const fallbackChar = initialState?.protagonists?.[0] || initialState?.participants?.[0] || allCharacters[0];
        if (fallbackChar) {
            handleJoinAccepted(fallbackChar);
        } else {
            addToast('Connected! Please select a character to participate.', 'info');
        }
    }, [allCharacters, handleJoinAccepted, addToast]);

    const handleJoinRejected = useCallback((reason: string) => {
        addToast(`Join rejected: ${reason}`, 'error');
        clearJoinState();
    }, [addToast, clearJoinState]);

    const handleJoinSession = useCallback((sessionId: string, password: string, requestedCharacterIdentifier: string | null, requestedCharacterData: Character | null) => {
        if (!currentAccountId) {
            addToast('No account configured. Create an account first.', 'error');
            return;
        }
        setJoinSessionId(sessionId);
        setJoinPassword(password);
        setJoinRequestedCharacterId(requestedCharacterIdentifier);
        setJoinRequestedCharacterData(requestedCharacterData);
        saveRawMultiplayerJoinData({
            joinSessionId: sessionId,
            joinPassword: password,
            joinRequestedCharacterId: requestedCharacterIdentifier,
            joinRequestedCharacterData: requestedCharacterData,
        }).catch((e: unknown) => console.warn('Failed to save join data:', e));
    }, [currentAccountId, addToast]);

    const handleConnectionFailed = useCallback(() => {
        addToast('Could not connect to host. Returning to local mode.', 'error');
        clearJoinState();
    }, [addToast, clearJoinState]);

    const saveMultiplayerDataVoid = useCallback(async (data: MultiplayerData): Promise<void> => {
        await saveMultiplayerData(data);
    }, [saveMultiplayerData]);

    const multiplayerSync = useMultiplayerSync({
        interactionData: useSessionStore.getState().interactionData,
        multiplayerData,
        currentAccountId,
        setInteractionData: setInteractionData ?? (() => {}),
        allCharacters,
        joinSessionId,
        joinPassword,
        joinRequestedCharacterId,
        joinRequestedCharacterData,
        onJoinAccepted: handleJoinAccepted,
        onJoinRejected: handleJoinRejected,
        onSaveMultiplayerData: saveMultiplayerDataVoid,
        onConnectionFailed: handleConnectionFailed,
        onCharacterSelectionRequired: handleCharacterSelectionRequired,
    });

    useEffect(() => {
        requestBorrowedModelRef.current = multiplayerSync.requestAndAwaitBorrowedModel;
    }, [multiplayerSync.requestAndAwaitBorrowedModel]);

    useEffect(() => {
        broadcastMessageRef.current = multiplayerSync.isConnected ? multiplayerSync.broadcastMessage : undefined;
    }, [multiplayerSync.isConnected, multiplayerSync.broadcastMessage]);

    return {
        isMultiplayerClient,
        joinSessionId,
        joinPassword,
        joinProtagonist,
        joinRequestedCharacterId,
        joinRequestedCharacterData,
        handleJoinSession,
        handleJoinAccepted,
        handleJoinRejected,
        handleConnectionFailed,
        clearJoinState,
        multiplayerSync,
        broadcastMessageRef,
        requestBorrowedModelRef,
        currentAccountId,
        multiplayerData,
    };
}