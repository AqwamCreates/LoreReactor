// src/services/BaseLanguageModel.ts
export interface GenerationRequest {
    prompt: string;
    n_predict?: number;
    stop?: string[];
    file_data?: { data: string; id: number }[];
    [key: string]: unknown;
}

export interface GenerationResponse {
    text: string;
    modelUsed: string;
    promptTokens?: number;
    completionTokens?: number;
    cacheMiss?: boolean;
    msPerToken?: number;
    timeToFirstToken?: number;
}

export interface StreamStats {
    fullText: string;
    msPerToken: number;
    timeToFirstToken?: number;
}

export interface StreamCallbacks {
    onToken?: (stats: StreamStats) => void | Promise<void>;
    onFinish?: (response: GenerationResponse) => void;
}

export interface ModelPortResolver {
    getPort(modelId: string): number | undefined;
    loadModel(modelId: string): Promise<number | null>;
    isReady(modelId: string): boolean;
}

/**
 * Abstract base class for all language model generation strategies.
 * Defines both completion and streaming interfaces.
 * Subclasses handle their own model selection and inference logic.
 * Loading is NOT handled here — caller provides ModelPortResolver via DI.
 */
export abstract class BaseLanguageModel {
    abstract readonly name: string;

    /**
     * Generate a complete response (non-streaming).
     * Tools are NOT handled here — caller processes tool invocations after.
     */
    abstract generateCompletion(
        request: GenerationRequest,
        signal?: AbortSignal,
    ): Promise<GenerationResponse>;

    /**
     * Stream a response token-by-token.
     * Tools are NOT handled here — caller processes tool invocations between chunks.
     */
    abstract generateStream(
        request: GenerationRequest,
        callbacks?: StreamCallbacks,
        signal?: AbortSignal,
    ): Promise<GenerationResponse>;
}