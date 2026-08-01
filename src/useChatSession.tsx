// src/hooks/useChatSession.ts
import { useState, useRef, useCallback, useEffect } from 'react';
import type { Character, ChatData } from './types';
import { saveRawChatData, loadAllRawChatData, deleteRawChatMessage, getCharacterImageUrl } from './storage';
import { createChatMessage, addMessageToChatData, convertIdsToDisplayNames, prepareRequestBody } from './chatLogic';
import { runTurnSequence } from './ChatOrchestrator';
import { LargeLanguageModelInferenceEngine } from './LargeLanguageModelInferenceEngine';
import { v4 as uuidv4 } from 'uuid';

const engine = new LargeLanguageModelInferenceEngine();

export function useChatSession() {
    const [chatData, setChatData] = useState<ChatData | null>(null);
    const [currentCharacter, setCurrentCharacter] = useState<Character | null>(null);
    
    // UI State
    const [isLoading, setIsLoading] = useState(false);
    const [streamingText, setStreamingText] = useState("");
    const [streamingCharacter, setStreamingCharacter] = useState<Character | null>(null);
    const [isInitialImageProcessed, setIsInitialImageProcessed] = useState(false);

    const abortControllerRef = useRef<AbortController | null>(null);
    const messageEndRef = useRef<HTMLDivElement>(null);

    // --- Helpers ---

    const getImageBase64 = async (url: string): Promise<string | null> => {
        try {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
        } catch (error) {
        console.error(`Failed to convert image: ${url}`, error);
        return null;
        }
    };

    const handleServerResponse = useCallback(async (
        data: ChatData, 
        character: Character, 
        signal: AbortSignal, 
        onToken?: (text: string) => void
    ): Promise<ChatData | null> => {
        let imageData: string | null = null;
        if (character.image) {
        const url = getCharacterImageUrl(character.image);
        if (url) imageData = await getImageBase64(url);
        }

        const requestBody = prepareRequestBody(data, character, imageData);

        try {
        const rawText = await engine.generateStream(requestBody, { signal } as AbortController, {
            onToken: (fullText) => onToken?.(fullText)
        });
        
        const displayText = convertIdsToDisplayNames(rawText, data);
        const aiMessage = createChatMessage(data, character, displayText);
        return addMessageToChatData(data, aiMessage);
        } catch (error) {
        if ((error as Error).name === 'AbortError') return null;
        console.error("Inference failed:", error);
        return null;
        }
    }, []);

    const processProtagonistImageSilently = useCallback(async (data: ChatData, character: Character) => {
        if (!character.image) {
        setIsInitialImageProcessed(true);
        return;
        }

        const sampler = character.sampler;
        const silentCharacter: Character = {
        ...character,
        sampler: {
            ...sampler,
            id: sampler?.id || uuidv4(),
            name: sampler?.name || 'silent',
            maximumNumberOfTokens: 0,
            parameters: { ...sampler?.parameters, n_predict: 0 },
            stopPatterns: [],
        }
        };

        try {
        const controller = new AbortController();
        await handleServerResponse(data, silentCharacter, controller.signal, undefined);
        setIsInitialImageProcessed(true);
        } catch (error) {
        console.warn("Silent image processing failed:", error);
        setIsInitialImageProcessed(true);
        }
    }, [handleServerResponse]);

    // --- Initialization ---

    useEffect(() => {
        const init = async () => {
        if (!chatData) {
            const arr = await loadAllRawChatData();
            if (arr.length > 0 && arr[0]) {
            const data = arr[0];
            setChatData(data);
            setCurrentCharacter(data.protagonist);
            } else {
            setIsInitialImageProcessed(true);
            }
        } else if (currentCharacter && !isInitialImageProcessed) {
            await processProtagonistImageSilently(chatData, currentCharacter);
        }
        };
        init();
    }, [chatData, currentCharacter, isInitialImageProcessed, processProtagonistImageSilently]);

    // Auto-scroll
    useEffect(() => {
        if (isLoading && streamingText && messageEndRef.current) {
        messageEndRef.current.scrollIntoView({ behavior: 'auto' });
        } else if (messageEndRef.current) {
        messageEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [streamingText, isLoading, chatData?.chatMessageHistory.length]);

    // --- Actions ---

    const stopGeneration = useCallback(() => {
        if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
        }
        setIsLoading(false);
        setStreamingCharacter(null);
        setStreamingText("");
    }, []);

    const sendMessage = useCallback(async (text: string) => {
        if (!chatData || !currentCharacter || !text.trim() || isLoading) return;

        abortControllerRef.current = new AbortController();
        setIsLoading(true);
        setStreamingText("");

        try {
        const userMsg = createChatMessage(chatData, currentCharacter, text);
        const tempData = addMessageToChatData(chatData, userMsg);
        setChatData(tempData);

        const executor = async (data: ChatData, char: Character, signal: AbortSignal, onToken: (t:string)=>void) => 
            handleServerResponse(data, char, signal, onToken);

        const updatedData = await runTurnSequence(
            tempData, 
            executor, 
            abortControllerRef.current, 
            setStreamingCharacter, 
            setStreamingText
        );

        if (!abortControllerRef.current.signal.aborted && updatedData) {
            await saveRawChatData(updatedData);
            setChatData(updatedData);
        }
        } catch (err) {
        console.error("Send failed:", err);
        } finally {
        setIsLoading(false);
        setStreamingText("");
        setStreamingCharacter(null);
        abortControllerRef.current = null;
        }
    }, [chatData, currentCharacter, isLoading, handleServerResponse]);

    const regenerateLastAI = useCallback(async () => {
        if (!chatData || isLoading) return;
        const history = chatData.chatMessageHistory;
        
        let trimIndex = history.length;
        while (trimIndex > 0 && history[trimIndex - 1].character.id !== chatData.protagonist.id) {
        trimIndex--;
        }
        if (trimIndex === 0 || trimIndex === history.length) return;

        const oldMessages = history.slice(trimIndex);
        try {
        await Promise.all(oldMessages.map(m => deleteRawChatMessage(m.id)));
        } catch (err) { console.error("Delete failed:", err); }

        const trimmedData = { ...chatData, chatMessageHistory: history.slice(0, trimIndex), last_updated_timestamp: Date.now() };
        setChatData(trimmedData);
        setIsLoading(true);
        setStreamingText("");
        setStreamingCharacter(null);

        abortControllerRef.current = new AbortController();
        const originalResponders = oldMessages.map(m => m.character).filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i);

        try {
        let currentData = trimmedData;
        for (const responder of originalResponders) {
            if (abortControllerRef.current?.signal.aborted) break;
            setStreamingCharacter(responder);
            
            const result = await handleServerResponse(currentData, responder, abortControllerRef.current.signal, setStreamingText);
            if (!result) break;
            currentData = result;
        }

        if (!abortControllerRef.current.signal.aborted) {
            await saveRawChatData(currentData);
            setChatData(currentData);
        }
        } catch (err) {
        console.error("Regen failed:", err);
        } finally {
        setIsLoading(false);
        setStreamingText("");
        setStreamingCharacter(null);
        abortControllerRef.current = null;
        }
    }, [chatData, isLoading, handleServerResponse]);

    const regenerateLastProtagonist = useCallback(async () => {
        if (!chatData || isLoading) return;
        const history = chatData.chatMessageHistory;
        
        let trimIndex = history.length;
        while (trimIndex > 0 && history[trimIndex - 1].character.id !== chatData.protagonist.id) {
        trimIndex--;
        }
        if (trimIndex === 0 || trimIndex === history.length) return;

        const oldMessages = history.slice(trimIndex);
        try {
        await Promise.all(oldMessages.map(m => deleteRawChatMessage(m.id)));
        } catch (err) { console.error("Delete failed:", err); }

        const trimmedData = { ...chatData, chatMessageHistory: history.slice(0, trimIndex), last_updated_timestamp: Date.now() };
        setChatData(trimmedData);
        setIsLoading(true);
        setStreamingText("");
        setStreamingCharacter(null);

        abortControllerRef.current = new AbortController();

        try {
        const executor = async (data: ChatData, char: Character, signal: AbortSignal, onToken: (t:string)=>void) => 
            handleServerResponse(data, char, signal, onToken);

        const updatedData = await runTurnSequence(
            trimmedData, 
            executor, 
            abortControllerRef.current, 
            setStreamingCharacter, 
            setStreamingText
        );

        if (!abortControllerRef.current.signal.aborted && updatedData) {
            await saveRawChatData(updatedData);
            setChatData(updatedData);
        }
        } catch (err) {
        console.error("Regen failed:", err);
        } finally {
        setIsLoading(false);
        setStreamingText("");
        setStreamingCharacter(null);
        abortControllerRef.current = null;
        }
    }, [chatData, isLoading, handleServerResponse]);

    return {
        chatData,
        setChatData,
        currentCharacter,
        setCurrentCharacter,
        isLoading,
        streamingText,
        streamingCharacter,
        sendMessage,
        stopGeneration,
        regenerateLastAI,
        regenerateLastProtagonist,
        messageEndRef
    };
}