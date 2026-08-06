// src/hooks/useChatSession.ts
import { useState, useRef, useCallback, useEffect } from 'react';
import type { Character, ChatData, ChatMessage, BudgetStrategy, LanguageModel } from '../types';
import { saveRawChatData, loadAllRawChatData, deleteRawChatMessage, getCharacterImageUrl } from './storage';
import { createChatMessage, addMessageToChatData, convertIdsToDisplayNames, createNewChatData, prepareRequestBody } from './chatLogic';
import { runTurnSequence } from '../services/ChatOrchestrator';
import { LargeLanguageModelInferenceEngine } from '../services/LargeLanguageModelInferenceEngine';
import { BudgetStrategyEngine } from '../services/BudgetStrategyEngine';
import { calculateRequestCost, type ModelPricing } from '../utilities/costCalculator.ts';
import { v4 as uuidv4 } from 'uuid';
import { useToast } from '../context/ToastContext';
import { localURL } from '../configurations';

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
    const [selectedModel, setSelectedModel] = useState<LanguageModel | null>(null);

    const [runningModelsMap, setRunningModelsMap] = useState<Record<string, { isRunning: boolean; port?: number }>>({});

    const [stats, setStats] = useState({
        numberOfCacheInvalidations: 0,
        numberOfRequests: 0,
        totalCost: 0,
        costWithoutCacheMisses: 0,
    });

    const abortControllerRef = useRef<AbortController | null>(null);
    const messageEndRef = useRef<HTMLDivElement>(null);
    
    const selectedModelRef = useRef<LanguageModel | null>(null);
    const runningModelsMapRef = useRef<Record<string, { isRunning: boolean; port?: number }>>({});
    const activeStrategyRef = useRef<BudgetStrategy | null>(null);
    const isLoadingRef = useRef(false);
    // ✅ Guard to prevent silent image processing from racing with user generation
    const isProcessingSilentlyRef = useRef(false);
    
    useEffect(() => { selectedModelRef.current = selectedModel; }, [selectedModel]);
    useEffect(() => { runningModelsMapRef.current = runningModelsMap; }, [runningModelsMap]);
    useEffect(() => { activeStrategyRef.current = activeStrategy; }, [activeStrategy]);
    useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);
    
    const { addToast } = useToast();

    // ✅ EAGER FETCH: Populate running models immediately on mount
    useEffect(() => {
        const fetchRunningModels = async () => {
            try {
                const res = await fetch(`${localURL}/models/status`);
                if (!res.ok) return;
                const data = await res.json();
                const status: Record<string, { isRunning: boolean; port?: number }> = {};
                for (const m of data.activeModels || []) {
                    status[m.id] = { isRunning: true, port: m.port };
                }
                setRunningModelsMap(status);
            } catch {
                // Server not ready yet
            }
        };
        fetchRunningModels();
    }, []);

    // ✅ Helper: Check if model is ready for generation (has port or API key)
    const isModelReadyForGeneration = useCallback((): boolean => {
        const model = selectedModelRef.current;
        if (!model) return false;
        if (model.apiKey) return true; // Cloud model
        const models = runningModelsMapRef.current;
        return !!(model.id && models[model.id]?.port);
    }, []);

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

        const currentModel = selectedModelRef.current;
        const currentRunningModels = runningModelsMapRef.current;
        const currentStrategy = strategy ?? activeStrategyRef.current;

        try {
            let rawText: string;

            if (currentStrategy) {
                const strategyEngine = new BudgetStrategyEngine(currentStrategy);
                const wrappedCallbacks = onToken ? {
                    onToken: (stats: any) => {
                        setGenerationSpeed(stats.msPerToken);
                        onToken(stats.fullText);
                    }
                } : undefined;

                rawText = await strategyEngine.generateStream(
                    data, character, { signal } as AbortController, wrappedCallbacks, userImagesBase64
                );

                if (strategyEngine.currentCost > 0) {
                    setStats(prev => ({
                        ...prev,
                        numberOfRequests: prev.numberOfRequests + 1,
                        totalCost: prev.totalCost + strategyEngine.currentCost,
                    }));
                }

            } else {
                if (!currentModel) {
                    if (!signal.aborted) {
                        addToast("No model selected. Please select a model from the Models list.", "error");
                    }
                    return null;
                }

                const requestBody = await prepareRequestBody(data, character, imageData, userImagesBase64);
                
                const runtimePort = currentModel?.id 
                    ? currentRunningModels[currentModel.id]?.port 
                    : undefined;
                
                const effectivePort = runtimePort || (currentModel.parameters as any)?._runtimePort;
                
                if (!effectivePort && !currentModel.apiKey) {
                    if (!signal.aborted) {
                        addToast("Model is not ready yet. Please wait.", "error");
                    }
                    return null;
                }
                
                const modelContext = {
                    apiKey: currentModel.apiKey,
                    backend: currentModel.backend,
                    modelPath: currentModel.model,
                    runtimePort: effectivePort
                };

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
            
            if (!rawText) {
                if (!signal.aborted) console.warn("Generated empty text");
                return null;
            }

            const displayText = convertIdsToDisplayNames(rawText, data);
            const aiMessage = createChatMessage(data, character, displayText);
            return addMessageToChatData(data, aiMessage);
        } catch (error) {
            const err = error as Error;
            
            if (err.name === 'AbortError') {
                if (streamingText && streamingText.trim().length > 0) {
                    const displayText = convertIdsToDisplayNames(streamingText, data);
                    const aiMessage = createChatMessage(data, character, displayText);
                    return addMessageToChatData(data, aiMessage);
                }
                return null;
            }

            const isNetworkError = err.message.includes('Failed to fetch') || 
                                    err.message.includes('NetworkError') ||
                                    err.message.includes('ERR_ABORTED') ||
                                    err.message.includes('502') ||
                                    err.message.includes('503') ||
                                    err.message.includes('504');

            if (isNetworkError) {
                if (!signal.aborted) {
                    addToast("⚠️ Backend Connection Failed. Could not connect to the AI server.", "error");
                }
                return null;
            }

            console.error("Inference failed:", err);
            if (!signal.aborted) {
                addToast(`❌ Inference Error: ${err.message}`, "error");
            }
            return null;
        }
    }, [addToast]);

    const updateRunningModels = useCallback((models: Record<string, { isRunning: boolean; port?: number }>) => {
        setRunningModelsMap(models);
    }, []);

    const sendActionAndGetResponse = useCallback(async (actionText: string, targetChar: Character): Promise<void> => {
        if (!chatData || !currentCharacter || isLoadingRef.current) return;
        // ✅ Pre-check model readiness BEFORE setting loading state
        if (!isModelReadyForGeneration()) {
            addToast("Model is not ready yet. Please wait.", "error");
            return;
        }
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
                const result = await handleServerResponse(updatedData, targetChar, controller.signal, setStreamingText, undefined, undefined);
                if (!controller.signal.aborted && result) {
                    await saveRawChatData(result);
                    setChatData(result);
                } else if (controller.signal.aborted && result) {
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
    }, [chatData, currentCharacter, handleServerResponse, addToast, isModelReadyForGeneration]);

    const processProtagonistImageSilently = useCallback(async (data: ChatData, character: Character) => {
        if (!character.image) {
            setIsInitialImageProcessed(true);
            return;
        }
        // ✅ Skip if model not ready OR if user is already generating
        if (!isModelReadyForGeneration() || isLoadingRef.current) {
            setIsInitialImageProcessed(true);
            return;
        }

        isProcessingSilentlyRef.current = true;
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
            await handleServerResponse(data, silentCharacter, controller.signal, undefined, undefined, undefined);
        } catch (error) {
            console.warn("Silent image processing failed:", error);
        } finally {
            isProcessingSilentlyRef.current = false;
            setIsInitialImageProcessed(true);
        }
    }, [handleServerResponse, isModelReadyForGeneration]);

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

    const setSelectedGlobalModel = useCallback((model: LanguageModel | null) => {
        setSelectedModel(model);
    }, []);

    const sendMessage = useCallback(async (text: string, files?: File[]) => {
        if (!chatData || !currentCharacter || (!text.trim() && (!files || files.length === 0)) || isLoadingRef.current) return;
        // ✅ Pre-check model readiness BEFORE setting loading state or saving anything
        if (!isModelReadyForGeneration()) {
            addToast("Model is not ready yet. Please wait.", "error");
            return;
        }
        
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
            await saveRawChatData(tempData);

            const executor = async (data: ChatData, char: Character, signal: AbortSignal, onToken: (t:string)=>void) => 
                handleServerResponse(data, char, signal, onToken, userImagesBase64, undefined);
            
            const updatedData = await runTurnSequence(tempData, executor, controller, setStreamingCharacter, setStreamingText, setChatData);
            
            if (updatedData) {
                await saveRawChatData(updatedData);
                setChatData(updatedData);
            } else if (!controller.signal.aborted) {
                addToast("Generation failed to produce output.", "error");
            }
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                console.error("Send failed:", err);
                addToast(`Send failed: ${(err as Error).message}`, "error");
            }
        } finally {
            if (abortControllerRef.current === controller) abortControllerRef.current = null;
            setIsLoading(false);
            setStreamingText("");
            setStreamingCharacter(null);
        }
    }, [chatData, currentCharacter, handleServerResponse, addToast, isModelReadyForGeneration]);

    const regenerateFromMessage = useCallback(async (messageId: string, type: 'ai' | 'user') => {
        if (!chatData || isLoadingRef.current) {
            if(isLoadingRef.current) addToast("Already generating...", "info");
            return;
        }
        // ✅ Pre-check model readiness BEFORE trimming messages or setting loading state
        if (!isModelReadyForGeneration()) {
            addToast("Model is not ready yet. Please wait.", "error");
            return;
        }
        
        const history = chatData.chatMessageHistory;
        const targetIndex = history.findIndex(m => m.id === messageId);

        if (targetIndex === -1) {
            addToast("Message not found.", "error");
            return;
        }

        const targetMessage = history[targetIndex];
        const isTargetAI = targetMessage.character.id !== chatData.protagonist.id;

        let trimIndex: number;
        let messagesToDelete: ChatMessage[] = [];

        if (type === 'ai' && isTargetAI) {
            trimIndex = targetIndex;
            messagesToDelete = history.slice(trimIndex);
        } else if (type === 'user' && !isTargetAI) {
            trimIndex = targetIndex + 1;
            messagesToDelete = history.slice(trimIndex);
        } else {
            addToast("Mismatched regeneration type.", "error");
            return;
        }

        if (messagesToDelete.length > 0) {
            try { 
                await Promise.all(messagesToDelete.map(m => deleteRawChatMessage(m.id))); 
            } catch (err) { 
                console.error("Failed to delete old messages:", err); 
            }
        }

        const trimmedData: ChatData = { 
            ...chatData, 
            chatMessageHistory: history.slice(0, trimIndex), 
            lastUpdatedTimestamp: Date.now() 
        };
        
        setChatData(trimmedData);
        setIsLoading(true);
        setStreamingText("");
        setStreamingCharacter(null);
        setGenerationSpeed(0);
        
        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            const executor = async (data: ChatData, char: Character, signal: AbortSignal, onToken: (t:string)=>void) => {
                return handleServerResponse(data, char, signal, onToken, undefined, undefined);
            };

            const updatedData = await runTurnSequence(trimmedData, executor, controller, setStreamingCharacter, setStreamingText, setChatData);

            if (updatedData) {
                await saveRawChatData(updatedData);
                setChatData(updatedData);
            } else if (!controller.signal.aborted) {
                addToast("Regeneration failed: No output generated.", "error");
            }
        } catch (err) { 
            const errorMsg = (err as Error).message;
            if (errorMsg !== 'AbortError') {
                console.error("Regeneration failed:", err); 
                addToast(`Regeneration error: ${errorMsg}`, "error");
            }
        } finally { 
            if (abortControllerRef.current === controller) abortControllerRef.current = null; 
            setIsLoading(false); 
            setStreamingText(""); 
            setStreamingCharacter(null); 
        }
    }, [chatData, handleServerResponse, addToast, isModelReadyForGeneration]);

    const currentTokenCount = chatData ? chatData.chatMessageHistory.reduce((acc, msg) => acc + estimateTokens(msg.textContent), 0) : 0;
    const maxContextTokens = selectedModel?.contextLength || 4096;

    return {
        chatData, setChatData, currentCharacter, setCurrentCharacter, isLoading, streamingText, streamingCharacter,
        sendMessage, stopGeneration, regenerateFromMessage, messageEndRef, parentChatMessageIds,
        generationSpeed, messageCount: chatData?.chatMessageHistory.length || 0, tokenCount: currentTokenCount,
        maximumNumberOfTokens: maxContextTokens, startNewChat,
        sendActionAndGetResponse,
        setActiveBudgetStrategy,
        setSelectedGlobalModel,
        updateRunningModels,
        numberOfCacheInvalidations: stats.numberOfCacheInvalidations,
        numberOfRequests: stats.numberOfRequests,
        totalCost: stats.totalCost,
        costWithoutCacheMisses: stats.costWithoutCacheMisses,
    };
}