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
    
    const [isLoading, setIsLoading] = useState(false);
    const [streamingText, setStreamingText] = useState("");
    const [streamingCharacter, setStreamingCharacter] = useState<Character | null>(null);
    const [isInitialImageProcessed, setIsInitialImageProcessed] = useState(false);
    
    // ✅ State to track which messages in the current chat have branches
    const [branchChatMessageIds, setBranchChatMessageIds] = useState<Set<string>>(new Set());

    const abortControllerRef = useRef<AbortController | null>(null);
    const messageEndRef = useRef<HTMLDivElement>(null);

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
            
            if (!rawText) return null;

            const displayText = convertIdsToDisplayNames(rawText, data);
            const aiMessage = createChatMessage(data, character, displayText);
            return addMessageToChatData(data, aiMessage);
        } catch (error) {
            if ((error as Error).name !== 'AbortError') {
                console.error("Inference failed:", error);
            }
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
            if ((error as Error).name !== 'AbortError') {
                console.warn("Silent image processing failed:", error);
            }
            setIsInitialImageProcessed(true);
        }
    }, [handleServerResponse]);

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
            if (chatData) {
                const allChats = await loadAllRawChatData();
                const points = new Set<string>();
                for (const c of allChats) {
                    if (c && c.parentChatDataId === chatData.id && c.parentChatMessageId) {
                        points.add(c.parentChatMessageId || "");
                    }
                }
                
                setBranchChatMessageIds(points);
            }
        };
        init();
    }, [chatData, currentCharacter, isInitialImageProcessed, processProtagonistImageSilently]);

    useEffect(() => {
        if (isLoading && streamingText && messageEndRef.current) {
            messageEndRef.current.scrollIntoView({ behavior: 'auto' });
        } else if (messageEndRef.current) {
            messageEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [streamingText, isLoading, chatData?.chatMessageHistory.length]);

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

        const controller = new AbortController();
        abortControllerRef.current = controller;
        
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
                controller, 
                setStreamingCharacter, 
                setStreamingText,
                setChatData 
            );

            if (!controller.signal.aborted && updatedData) {
                setChatData(updatedData);
            }
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                console.error("Send failed:", err);
            }
        } finally {
            if (abortControllerRef.current === controller) {
                abortControllerRef.current = null;
            }
            setIsLoading(false);
            setStreamingText("");
            setStreamingCharacter(null);
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

        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            let currentData = trimmedData;
            for (const responder of oldMessages.map(m => m.character).filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i)) {
                if (controller.signal.aborted) break;
                setStreamingCharacter(responder);
                
                const result = await handleServerResponse(currentData, responder, controller.signal, setStreamingText);
                if (!result) break;
                currentData = result;
            }

            if (!controller.signal.aborted) {
                await saveRawChatData(currentData);
                setChatData(currentData);
            }
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                console.error("Regen failed:", err);
            }
        } finally {
            if (abortControllerRef.current === controller) {
                abortControllerRef.current = null;
            }
            setIsLoading(false);
            setStreamingText("");
            setStreamingCharacter(null);
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

        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            const executor = async (data: ChatData, char: Character, signal: AbortSignal, onToken: (t:string)=>void) => 
                handleServerResponse(data, char, signal, onToken);

            const updatedData = await runTurnSequence(
                trimmedData, 
                executor, 
                controller, 
                setStreamingCharacter, 
                setStreamingText,
                setChatData
            );

            if (!controller.signal.aborted && updatedData) {
                setChatData(updatedData);
            }
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                console.error("Regen failed:", err);
            }
        } finally {
            if (abortControllerRef.current === controller) {
                abortControllerRef.current = null;
            }
            setIsLoading(false);
            setStreamingText("");
            setStreamingCharacter(null);
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
        messageEndRef,
        branchChatMessageIds // ✅ Don't forget to return this!
    };
}