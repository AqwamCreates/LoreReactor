// src/hooks/useChatSession.ts
import { useState, useRef, useCallback, useEffect } from 'react';
import type { Character, ChatData } from '../types';
import { saveRawChatData, loadAllRawChatData, deleteRawChatMessage, getCharacterImageUrl } from './storage';
import { createChatMessage, addMessageToChatData, convertIdsToDisplayNames, prepareRequestBody, createNewChatData } from './chatLogic';
import { runTurnSequence } from '../services/ChatOrchestrator';
import { LargeLanguageModelInferenceEngine } from '../services/LargeLanguageModelInferenceEngine';
import { v4 as uuidv4 } from 'uuid';

const engine = new LargeLanguageModelInferenceEngine();

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

// ✅ Helper: Create a safe default character if none exists
const getDefaultCharacter = (): Character => ({
  id: 'default-user',
  name: 'User',
  description: 'Default user character',
  systemPrompt: '',
  initiativeWeight: 1,
  chatProbability: 0.5,
  maximumChatStamina: 5,
  sampler: {
    id: 'default-sampler',
    name: 'Default',
    parameters: { temperature: 0.7, top_p: 0.9 },
    stopPatterns: [],
    maximumNumberOfTokens: 256
  }
});

export function useChatSession() {
    const [chatData, setChatData] = useState<ChatData | null>(null);
    const [currentCharacter, setCurrentCharacter] = useState<Character | null>(null);
    
    const [isLoading, setIsLoading] = useState(false);
    const [streamingText, setStreamingText] = useState("");
    const [streamingCharacter, setStreamingCharacter] = useState<Character | null>(null);
    const [isInitialImageProcessed, setIsInitialImageProcessed] = useState(false);
    
    const [generationSpeed, setGenerationSpeed] = useState<number>(0);
    const [parentChatMessageIds, setParentChatMessageIds] = useState<Set<string>>(new Set());

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
                onToken: (stats) => {
                    setGenerationSpeed(stats.msPerToken);
                    if (onToken) onToken(stats.fullText);
                }
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

    // ✅ FIXED INITIALIZATION
    useEffect(() => {
        const init = async () => {
            // 1. Load all chats to check for existing data or default character
            const arr = await loadAllRawChatData();
            
            let charToUse: Character | null = null;

            // Strategy: 
            // A. If we already have a currentCharacter in state, keep it.
            // B. Else, if there are old chats, use the protagonist of the first one.
            // C. Else, create a Default Character so the UI doesn't break.
            
            if (currentCharacter) {
                charToUse = currentCharacter;
            } else if (arr.length > 0 && arr[0]) {
                charToUse = arr[0].protagonist;
            } else {
                charToUse = getDefaultCharacter();
            }

            // Ensure state is set
            if (!currentCharacter && charToUse) {
                setCurrentCharacter(charToUse);
            }

            // 2. Create a Fresh Draft Chat if none exists
            if (!chatData && charToUse) {
                const newDraft = createNewChatData(charToUse);
                setChatData(newDraft);
                // Do NOT save yet. Wait for user input.
            }

            // 3. Process Image if needed
            if (chatData && currentCharacter && !isInitialImageProcessed) {
                await processProtagonistImageSilently(chatData, currentCharacter);
            } else if (!chatData && charToUse) {
                // If we just created a draft, process its image
                // We need a temporary data object to pass to processor
                const tempData = createNewChatData(charToUse);
                await processProtagonistImageSilently(tempData, charToUse);
            }

            // 4. Calculate Branch Points
            if (chatData) {
                const allChats = await loadAllRawChatData();
                const points = new Set<string>();
                for (const c of allChats) {
                    if (c && c.parentChatDataId === chatData.id && c.parentChatMessageId) {
                        points.add(c.parentChatMessageId);
                    }
                }
                setParentChatMessageIds(points);
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
        setGenerationSpeed(0);
    }, []);

    const startNewChat = useCallback((character: Character) => {
        const newChat = createNewChatData(character);
        setChatData(newChat);
        setCurrentCharacter(character);
        setIsInitialImageProcessed(false);
    }, []);

    const sendMessage = useCallback(async (text: string) => {
        if (!chatData || !currentCharacter || !text.trim() || isLoading) return;

        const controller = new AbortController();
        abortControllerRef.current = controller;
        
        setIsLoading(true);
        setStreamingText("");
        setGenerationSpeed(0);

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

            if (updatedData) {
                await saveRawChatData(updatedData);
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
        if (!chatData || isLoading || chatData.chatMessageHistory.length === 0) return;
        const history = chatData.chatMessageHistory;
        let trimIndex = history.length;
        while (trimIndex > 0 && history[trimIndex - 1].character.id !== chatData.protagonist.id) {
            trimIndex--;
        }
        if (trimIndex === 0 || trimIndex === history.length) return;

        const oldMessages = history.slice(trimIndex);
        try { await Promise.all(oldMessages.map(m => deleteRawChatMessage(m.id))); } catch (err) { console.error(err); }

        const trimmedData = { ...chatData, chatMessageHistory: history.slice(0, trimIndex), last_updated_timestamp: Date.now() };
        setChatData(trimmedData);
        setIsLoading(true);
        setStreamingText("");
        setStreamingCharacter(null);
        setGenerationSpeed(0);

        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            let currentData = trimmedData;
            const responders = oldMessages.map(m => m.character).filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i);
            for (const responder of responders) {
                if (controller.signal.aborted) break;
                setStreamingCharacter(responder);
                const result = await handleServerResponse(currentData, responder, controller.signal, setStreamingText);
                if (!result) break;
                currentData = result;
            }
            if (!controller.signal.aborted && currentData) {
                await saveRawChatData(currentData);
                setChatData(currentData);
            }
        } catch (err) {
            if ((err as Error).name !== 'AbortError') console.error(err);
        } finally {
            if (abortControllerRef.current === controller) abortControllerRef.current = null;
            setIsLoading(false);
            setStreamingText("");
            setStreamingCharacter(null);
        }
    }, [chatData, isLoading, handleServerResponse]);

    const regenerateLastProtagonist = useCallback(async () => {
        if (!chatData || isLoading || chatData.chatMessageHistory.length === 0) return;
        const history = chatData.chatMessageHistory;
        let trimIndex = history.length;
        while (trimIndex > 0 && history[trimIndex - 1].character.id !== chatData.protagonist.id) {
            trimIndex--;
        }
        if (trimIndex === 0 || trimIndex === history.length) return;

        const oldMessages = history.slice(trimIndex);
        try { await Promise.all(oldMessages.map(m => deleteRawChatMessage(m.id))); } catch (err) { console.error(err); }

        const trimmedData = { ...chatData, chatMessageHistory: history.slice(0, trimIndex), last_updated_timestamp: Date.now() };
        setChatData(trimmedData);
        setIsLoading(true);
        setStreamingText("");
        setStreamingCharacter(null);
        setGenerationSpeed(0);

        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            const executor = async (data: ChatData, char: Character, signal: AbortSignal, onToken: (t:string)=>void) => 
                handleServerResponse(data, char, signal, onToken);
            const updatedData = await runTurnSequence(trimmedData, executor, controller, setStreamingCharacter, setStreamingText, setChatData);
            if (!controller.signal.aborted && updatedData) {
                await saveRawChatData(updatedData);
                setChatData(updatedData);
            }
        } catch (err) {
            if ((err as Error).name !== 'AbortError') console.error(err);
        } finally {
            if (abortControllerRef.current === controller) abortControllerRef.current = null;
            setIsLoading(false);
            setStreamingText("");
            setStreamingCharacter(null);
        }
    }, [chatData, isLoading, handleServerResponse]);

    const currentTokenCount = chatData ? chatData.chatMessageHistory.reduce((acc, msg) => acc + estimateTokens(msg.textContent), 0) : 0;
    const maxContextTokens = 4096; 

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
        parentChatMessageIds,
        generationSpeed,
        messageCount: chatData?.chatMessageHistory.length || 0,
        tokenCount: currentTokenCount,
        maximumNumberOfTokens: maxContextTokens,
        startNewChat
    };
}