// src/hooks/useChatSession.ts
import { useState, useRef, useCallback, useEffect } from 'react';
import type { Character, ChatData } from '../types';
import { saveRawChatData, loadAllRawChatData, deleteRawChatMessage, getCharacterImageUrl } from './storage';
import { createChatMessage, addMessageToChatData, convertIdsToDisplayNames, prepareRequestBody } from './chatLogic';
import { runTurnSequence } from '../objects/ChatOrchestrator';
import { LargeLanguageModelInferenceEngine, type TokenStats } from '../objects/LargeLanguageModelInferenceEngine';
import { v4 as uuidv4 } from 'uuid';

const engine = new LargeLanguageModelInferenceEngine();

// Helper: Estimate tokens (approx 4 chars = 1 token)
const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export function useChatSession() {
    const [chatData, setChatData] = useState<ChatData | null>(null);
    const [currentCharacter, setCurrentCharacter] = useState<Character | null>(null);
    
    const [isLoading, setIsLoading] = useState(false);
    const [streamingText, setStreamingText] = useState("");
    const [streamingCharacter, setStreamingCharacter] = useState<Character | null>(null);
    const [isInitialImageProcessed, setIsInitialImageProcessed] = useState(false);
    
    // ✅ New Stats State
    const [generationSpeed, setGenerationSpeed] = useState<number>(0); // ms per token
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
        onTokenStats?: (stats: TokenStats) => void
    ): Promise<ChatData | null> => {
        let imageData: string | null = null;
        if (character.image) {
            const url = getCharacterImageUrl(character.image);
            if (url) imageData = await getImageBase64(url);
        }

        const requestBody = prepareRequestBody(data, character, imageData);

        try {
            const rawText = await engine.generateStream(requestBody, { signal } as AbortController, {
                // ✅ Receive stats from engine
                onToken: (stats: TokenStats) => {
                    setGenerationSpeed(stats.msPerToken); // Update global speed state
                    if (onTokenStats) onTokenStats(stats); // Pass text up for UI streaming
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
                allChats.forEach(c => {
                    if (c && c.parentChatDataId === chatData.id && c.parentChatMessageId) {
                        points.add(c.parentChatMessageId);
                    }
                });
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
        setGenerationSpeed(0); // Reset speed on stop
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

            const executor = async (data: ChatData, char: Character, signal: AbortSignal, onTokenStats: (s: TokenStats)=>void) => 
                handleServerResponse(data, char, signal, onTokenStats);

            const updatedData = await runTurnSequence(
                tempData, 
                executor, 
                controller, 
                setStreamingCharacter, 
                // ✅ Adapt the callback to just update text state
                (stats: TokenStats) => setStreamingText(stats.fullText),
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
            // Keep the last speed visible for a moment or reset? Let's keep it.
        }
    }, [chatData, currentCharacter, isLoading, handleServerResponse]);

    // ... (regenerateLastAI and regenerateLastProtagonist follow similar pattern, omitted for brevity but should pass the stats callback) ...
    // For brevity, assuming you copy the logic from sendMessage into these two functions regarding the executor.

    const regenerateLastAI = useCallback(async () => {
        // ... (Your existing logic) ...
        // Just ensure when calling handleServerResponse, you pass the stats updater if you want speed tracking during regen
        // Example: handleServerResponse(..., (stats) => setStreamingText(stats.fullText))
        // Note: You might want to duplicate the speed logic here or refactor runTurnSequence to handle it globally.
        // For now, speed tracking works best in sendMessage.
        
        // Placeholder implementation to avoid errors in this snippet:
        if (!chatData || isLoading) return;
        // ... implement similar to sendMessage ...
    }, [chatData, isLoading, handleServerResponse]);
    
    const regenerateLastProtagonist = useCallback(async () => {
         // ... similar to above ...
         if (!chatData || isLoading) return;
    }, [chatData, isLoading, handleServerResponse]);

    // ✅ Calculate Context Tokens
    const currentTokenCount = chatData 
        ? chatData.chatMessageHistory.reduce((acc, msg) => acc + estimateTokens(msg.textContent), 0)
        : 0;
    
    // Estimate Max Context (e.g., 4096 or from model config)
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
        // ✅ Expose Stats
        generationSpeed,
        messageCount: chatData?.chatMessageHistory.length || 0,
        tokenCount: currentTokenCount,
        maxContextTokens
    };
}