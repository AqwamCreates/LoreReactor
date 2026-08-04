// src/hooks/useChatSession.ts
import { useState, useRef, useCallback, useEffect } from 'react';
import type { Character, ChatData, BudgetStrategy } from '../types';
import { saveRawChatData, loadAllRawChatData, deleteRawChatMessage, getCharacterImageUrl } from './storage';
import { createChatMessage, addMessageToChatData, convertIdsToDisplayNames, createNewChatData } from './chatLogic';
import { runTurnSequence } from '../services/ChatOrchestrator';
import { LargeLanguageModelInferenceEngine } from '../services/LargeLanguageModelInferenceEngine';
import { BudgetStrategyEngine } from '../services/BudgetStrategyEngine';
import { calculateRequestCost, type ModelPricing } from '../utilities/costCalculator.ts';
import { v4 as uuidv4 } from 'uuid';

const baseEngine = new LargeLanguageModelInferenceEngine();

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

const convertFileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};

function getDefaultCharacter(): Character {
    const now = Date.now();
    return {
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
            maximumNumberOfTokens: 256,
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        },
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    };
}

export function useChatSession() {
    const [chatData, setChatData] = useState<ChatData | null>(null);
    const [currentCharacter, setCurrentCharacter] = useState<Character | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [streamingText, setStreamingText] = useState("");
    const [streamingCharacter, setStreamingCharacter] = useState<Character | null>(null);
    const [isInitialImageProcessed, setIsInitialImageProcessed] = useState(false);
    const [generationSpeed, setGenerationSpeed] = useState<number>(0);
    const [parentChatMessageIds, setParentChatMessageIds] = useState<Set<string>>(new Set());

    const [activeStrategy, setActiveStrategy] = useState<BudgetStrategy | null>(null);

    const [stats, setStats] = useState({
        numberOfCacheInvalidations: 0,
        numberOfRequests: 0,
        totalCost: 0,
        costWithoutCacheMisses: 0,
    });

    const abortControllerRef = useRef<AbortController | null>(null);
    const messageEndRef = useRef<HTMLDivElement>(null);

    // ✅ Inject Toast Context directly here or pass it down if preferred
    // Since this is a hook, we assume the component using it has access to Toasts via context
    // But to keep it clean, we will return a handler that the App can use, 
    // OR we import useToast here if your project structure allows hooks inside hooks files.
    // For simplicity, let's assume we can import useToast here since it's a React hook file.
    import { useToast } from '../context/ToastContext';
    const { addToast } = useToast(); 

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
        onToken?: (text: string) => void,
        userImagesBase64?: string[],
        strategy?: BudgetStrategy | null
    ): Promise<ChatData | null> => {
        
        let imageData: string | null = null;
        if (character.image) {
            const url = getCharacterImageUrl(character.image);
            if (url) imageData = await getImageBase64(url);
        }

        const pricing: ModelPricing = {
            cacheHitPerMillion: 0, 
            cacheMissPerMillion: 0, 
            outputPerMillion: 0
        };

        try {
            let rawText: string;

            if (strategy) {
                const strategyEngine = new BudgetStrategyEngine(strategy);
                const wrappedCallbacks = onToken ? {
                    onToken: (stats: any) => {
                        setGenerationSpeed(stats.msPerToken);
                        onToken(stats.fullText);
                    }
                } : undefined;

                rawText = await strategyEngine.generateStream(
                    data,
                    character,
                    { signal } as AbortController,
                    wrappedCallbacks,
                    userImagesBase64
                );

                if (strategyEngine.currentCost > 0) {
                    setStats(prev => ({
                        ...prev,
                        numberOfRequests: prev.numberOfRequests + 1,
                        totalCost: prev.totalCost + strategyEngine.currentCost,
                    }));
                }

            } else {
                const requestBody = await import('../hooks/chatLogic').then(m => m.prepareRequestBody(data, character, imageData, userImagesBase64));
                
                const modelContext = character.sampler?.associatedModel ? {
                    apiKey: character.sampler.associatedModel.apiKey,
                    backend: character.sampler.associatedModel.backend,
                    modelPath: character.sampler.associatedModel.model
                } : undefined;

                rawText = await baseEngine.generateStream(
                    requestBody,
                    { signal } as AbortController,
                    {
                        onToken: (stats) => {
                            setGenerationSpeed(stats.msPerToken);
                            if (onToken) onToken(stats.fullText);
                        },
                        onFinish: (responseStats) => {
                            const promptTokens = responseStats.promptTokens || 0;
                            const completionTokens = responseStats.completionTokens || 0;
                            const isCacheMiss = responseStats.cacheMiss || false;
                            const costResult = calculateRequestCost(promptTokens, completionTokens, isCacheMiss, pricing);

                            setStats(prev => ({
                                numberOfRequests: prev.numberOfRequests + 1,
                                numberOfCacheInvalidations: prev.numberOfCacheInvalidations + (isCacheMiss ? 1 : 0),
                                totalCost: prev.totalCost + costResult.totalCost,
                                costWithoutCacheMisses: prev.costWithoutCacheMisses + costResult.potentialMaxCost,
                            }));
                        }
                    },
                    modelContext
                );
            }
            
            if (!rawText) return null;

            const displayText = convertIdsToDisplayNames(rawText, data);
            const aiMessage = createChatMessage(data, character, displayText);
            return addMessageToChatData(data, aiMessage);
        } catch (error) {
            const err = error as Error;
            
            // ✅ Handle Abort Silently
            if (err.name === 'AbortError') return null;

            // ✅ Replace Alert with Toast
            const isNetworkError = err.message.includes('Failed to fetch') || 
                                   err.message.includes('NetworkError') ||
                                   err.message.includes('ERR_ABORTED') ||
                                   err.message.includes('502') ||
                                   err.message.includes('503') ||
                                   err.message.includes('504');

            if (isNetworkError) {
                addToast(
                    "⚠️ Backend Connection Failed. Could not connect to the AI server. Please check if your backend (KoboldCPP/llama.cpp) is running.", 
                    "error"
                );
                setIsLoading(false);
                return null;
            }

            // ✅ Generic Error Toast
            console.error("Inference failed:", err);
            addToast(`❌ Inference Error: ${err.message}`, "error");
            return null;
        }
    }, [addToast]); // ✅ Added addToast to dependencies

    const sendActionAndGetResponse = useCallback(async (actionText: string, targetChar: Character): Promise<void> => {
        if (!chatData || !currentCharacter || isLoading) return;
        try {
            const actionMsg = createChatMessage(chatData, currentCharacter, actionText);
            const updatedData = addMessageToChatData(chatData, actionMsg);
            await saveRawChatData(updatedData);
            setChatData(updatedData);
            await new Promise(resolve => setTimeout(resolve, 50));
            
            const controller = new AbortController();
            abortControllerRef.current = controller;
            setIsLoading(true);
            setStreamingText("");
            setStreamingCharacter(targetChar);
            setGenerationSpeed(0);
            
            try {
                const result = await handleServerResponse(updatedData, targetChar, controller.signal, setStreamingText, undefined, activeStrategy);
                if (!controller.signal.aborted && result) {
                    await saveRawChatData(result);
                    setChatData(result);
                }
            } catch (err) {
                if ((err as Error).name !== 'AbortError') console.error("AI response failed:", err);
            } finally {
                if (abortControllerRef.current === controller) abortControllerRef.current = null;
                setIsLoading(false);
                setStreamingText("");
                setStreamingCharacter(null);
            }
        } catch (error) {
            console.error("Failed to send action:", error);
            setIsLoading(false);
            setStreamingText("");
            setStreamingCharacter(null);
        }
    }, [chatData, currentCharacter, isLoading, handleServerResponse, activeStrategy]);

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
                firstCreatedTimestamp: sampler?.firstCreatedTimestamp || Date.now(),
                lastUpdatedTimestamp: Date.now(),
            }
        };
        try {
            const controller = new AbortController();
            await handleServerResponse(data, silentCharacter, controller.signal, undefined, undefined, activeStrategy);
            setIsInitialImageProcessed(true);
        } catch (error) {
            console.warn("Silent image processing failed:", error);
            setIsInitialImageProcessed(true);
        }
    }, [handleServerResponse, activeStrategy]);

    useEffect(() => {
        const init = async () => {
            const arr = await loadAllRawChatData();
            const validChats = arr.filter((c): c is ChatData => c !== null);
            let charToUse: Character | null = null;
            let chatToLoad: ChatData | null = null;

            if (validChats.length > 0) {
                const sortedChats = [...validChats].sort((a, b) => b.lastUpdatedTimestamp - a.lastUpdatedTimestamp);
                const firstChat = sortedChats[0];
                if (firstChat.protagonist && firstChat.protagonist.id !== 'default-user') {
                    chatToLoad = firstChat;
                    charToUse = firstChat.protagonist;
                }
            }

            if (!charToUse) charToUse = getDefaultCharacter();
            if (!currentCharacter && charToUse) setCurrentCharacter(charToUse);

            if (!chatData && charToUse) {
                if (chatToLoad) setChatData(chatToLoad);
                else setChatData(createNewChatData(charToUse));
            }

            const dataToProcess = chatToLoad || (charToUse ? createNewChatData(charToUse) : null);
            if (dataToProcess && charToUse && !isInitialImageProcessed) {
                await processProtagonistImageSilently(dataToProcess, charToUse);
            }

            if (chatData || chatToLoad) {
                const activeChat = chatToLoad || chatData;
                if (activeChat) {
                    const allChats = await loadAllRawChatData();
                    const points = new Set<string>();
                    for (const c of allChats) {
                        if (c && c.parentChatDataId === activeChat.id && c.parentChatMessageId) points.add(c.parentChatMessageId);
                    }
                    setParentChatMessageIds(points);
                }
            }
        };
        init();
    }, []);

    useEffect(() => {
        if (isLoading && streamingText && messageEndRef.current) messageEndRef.current.scrollIntoView({ behavior: 'auto' });
        else if (messageEndRef.current) messageEndRef.current.scrollIntoView({ behavior: 'smooth' });
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
        newChat.name = "Untitled Chat";
        setChatData(newChat);
        setCurrentCharacter(character);
        setIsInitialImageProcessed(false);
        saveRawChatData(newChat).catch(err => console.error("Failed to save new chat:", err));
    }, []);

    const setActiveBudgetStrategy = useCallback((strategy: BudgetStrategy | null) => {
        setActiveStrategy(strategy);
    }, []);

    const sendMessage = useCallback(async (text: string, files?: File[]) => {
        if (!chatData || !currentCharacter || (!text.trim() && (!files || files.length === 0)) || isLoading) return;
        
        const controller = new AbortController();
        abortControllerRef.current = controller;
        setIsLoading(true);
        setStreamingText("");
        setStreamingCharacter(null);
        setGenerationSpeed(0);
        
        try {
            let userImagesBase64: string[] | undefined = undefined;
            if (files && files.length > 0) {
                userImagesBase64 = await Promise.all(files.map(f => convertFileToBase64(f)));
            }

            const userMsg = createChatMessage(chatData, currentCharacter, text);
            const tempData = addMessageToChatData(chatData, userMsg);
            setChatData(tempData);
            
            const executor = async (data: ChatData, char: Character, signal: AbortSignal, onToken: (t:string)=>void) => 
                handleServerResponse(data, char, signal, onToken, userImagesBase64, activeStrategy);
            
            const updatedData = await runTurnSequence(tempData, executor, controller, setStreamingCharacter, setStreamingText, setChatData);
            if (updatedData) {
                await saveRawChatData(updatedData);
                setChatData(updatedData);
            }
        } catch (err) {
            if ((err as Error).name !== 'AbortError') console.error("Send failed:", err);
        } finally {
            if (abortControllerRef.current === controller) abortControllerRef.current = null;
            setIsLoading(false);
            setStreamingText("");
            setStreamingCharacter(null);
        }
    }, [chatData, currentCharacter, isLoading, handleServerResponse, activeStrategy]);

    const regenerateLastAI = useCallback(async () => {
        if (!chatData || isLoading || chatData.chatMessageHistory.length === 0) return;
        const history = chatData.chatMessageHistory;
        let trimIndex = history.length;
        while (trimIndex > 0 && history[trimIndex - 1].character.id !== chatData.protagonist.id) trimIndex--;
        if (trimIndex === 0 || trimIndex === history.length) return;
        const oldMessages = history.slice(trimIndex);
        try { await Promise.all(oldMessages.map(m => deleteRawChatMessage(m.id))); } catch (err) { console.error(err); }
        const trimmedData = { ...chatData, chatMessageHistory: history.slice(0, trimIndex), lastUpdatedTimestamp: Date.now() };
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
                const result = await handleServerResponse(currentData, responder, controller.signal, setStreamingText, undefined, activeStrategy);
                if (!result) break;
                currentData = result;
            }
            if (!controller.signal.aborted && currentData) {
                await saveRawChatData(currentData);
                setChatData(currentData);
            }
        } catch (err) { if ((err as Error).name !== 'AbortError') console.error(err); }
        finally { 
            if (abortControllerRef.current === controller) abortControllerRef.current = null; 
            setIsLoading(false); 
            setStreamingText(""); 
            setStreamingCharacter(null); 
        }
    }, [chatData, isLoading, handleServerResponse, activeStrategy]);

    const regenerateLastProtagonist = useCallback(async () => {
        if (!chatData || isLoading || chatData.chatMessageHistory.length === 0) return;
        const history = chatData.chatMessageHistory;
        let trimIndex = history.length;
        while (trimIndex > 0 && history[trimIndex - 1].character.id !== chatData.protagonist.id) trimIndex--;
        if (trimIndex === 0 || trimIndex === history.length) return;
        const oldMessages = history.slice(trimIndex);
        try { await Promise.all(oldMessages.map(m => deleteRawChatMessage(m.id))); } catch (err) { console.error(err); }
        const trimmedData = { ...chatData, chatMessageHistory: history.slice(0, trimIndex), lastUpdatedTimestamp: Date.now() };
        setChatData(trimmedData);
        setIsLoading(true);
        setStreamingText("");
        setStreamingCharacter(null);
        setGenerationSpeed(0);
        
        const controller = new AbortController();
        abortControllerRef.current = controller;
        try {
            const executor = async (data: ChatData, char: Character, signal: AbortSignal, onToken: (t:string)=>void) => handleServerResponse(data, char, signal, onToken, undefined, activeStrategy);
            const updatedData = await runTurnSequence(trimmedData, executor, controller, setStreamingCharacter, setStreamingText, setChatData);
            if (!controller.signal.aborted && updatedData) {
                await saveRawChatData(updatedData);
                setChatData(updatedData);
            }
        } catch (err) { if ((err as Error).name !== 'AbortError') console.error(err); }
        finally { 
            if (abortControllerRef.current === controller) abortControllerRef.current = null; 
            setIsLoading(false); 
            setStreamingText(""); 
            setStreamingCharacter(null); 
        }
    }, [chatData, isLoading, handleServerResponse, activeStrategy]);

    const currentTokenCount = chatData ? chatData.chatMessageHistory.reduce((acc, msg) => acc + estimateTokens(msg.textContent), 0) : 0;
    const maxContextTokens = 4096; 

    return {
        chatData, setChatData, currentCharacter, setCurrentCharacter, isLoading, streamingText, streamingCharacter,
        sendMessage, stopGeneration, regenerateLastAI, regenerateLastProtagonist, messageEndRef, parentChatMessageIds,
        generationSpeed, messageCount: chatData?.chatMessageHistory.length || 0, tokenCount: currentTokenCount,
        maximumNumberOfTokens: maxContextTokens, startNewChat,
        sendActionAndGetResponse,
        setActiveBudgetStrategy,
        numberOfCacheInvalidations: stats.numberOfCacheInvalidations,
        numberOfRequests: stats.numberOfRequests,
        totalCost: stats.totalCost,
        costWithoutCacheMisses: stats.costWithoutCacheMisses,
    };
}