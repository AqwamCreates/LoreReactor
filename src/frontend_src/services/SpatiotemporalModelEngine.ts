// src/frontend_src/services/SpatiotemporalModelEngine.ts
import { localAddress } from "../../configurations";
import {
    spatiotemporalCloudBackends,
    spatiotemporalCloudImageEndpoints,
    spatiotemporalCloudVideoEndpoints,
    spatiotemporalCloudVideoPollEndpoints,
    openAiCompatibleSpatiotemporalLocalBackends,
    sdapiCompatibleSpatiotemporalLocalBackends,
} from "../dictionaries/spatiotemporalModelInformation";
import type { backend, cloudBackend, SpatiotemporalModel } from "../types";

// ─── Internal Constants ─────────────────────────────────────────────

const VIDEO_POLL_INTERVAL_MS = 30000;
const VIDEO_MAX_POLL_ATTEMPTS = 60; // 30 minutes max for long video generations

// ─── Public Interfaces ──────────────────────────────────────────────

export interface SpatiotemporalRequest {
    prompt: string;
    negativePrompt?: string;
    width?: number;
    height?: number;
    steps?: number;
    cfgScale?: number;
    seed?: number;
    samplerName?: string;
    scheduler?: string;
    clipSkip?: number;
    n?: number;
    outputFormat?: 'png' | 'jpeg' | 'webp';
    duration?: number;
    aspectRatio?: string;
    resolution?: string;
    generateAudio?: boolean;
    inputReferences?: string[];
    frameImages?: Array<{ url: string; frameType: 'first_frame' | 'last_frame' }>;
}

export interface SpatiotemporalResult {
    success: boolean;
    images?: string[];
    videoUrl?: string;
    mediaType?: string;
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        cost?: number;
    };
    jobId?: string;
    pollingUrl?: string;
    error?: string;
}

export interface SpatiotemporalCallbacks {
    onProgress?: (status: string, percent?: number) => void;
    onComplete?: (result: SpatiotemporalResult) => void;
}

// ─── Raw API Response Shapes ────────────────────────────────────────

interface OpenRouterImageResponse {
    created: number;
    data: Array<{ b64_json: string; media_type?: string }>;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        cost?: number;
    };
}

interface OpenRouterVideoSubmitResponse {
    id: string;
    polling_url?: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    error?: string;
}

interface OpenRouterVideoPollResponse {
    id: string;
    generation_id?: string;
    polling_url?: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'expired';
    unsigned_urls?: string[];
    urls?: string[];
    error?: string;
    usage?: { cost?: number; is_byok?: boolean };
}

interface SdServerOpenAIResponse {
    created: number;
    output_format: string;
    data: Array<{ b64_json: string }>;
}

interface SdServerSdapiResponse {
    images: string[];
    parameters: Record<string, unknown>;
    info: string;
}

// ─── Engine Class ───────────────────────────────────────────────────

export class SpatiotemporalModelEngine {

    // ─── Model State ──────────────────────────────────────────────

    private model: SpatiotemporalModel | null = null;
    private runtimePort: number | undefined = undefined;
    private runningModels: Record<string, { isRunning: boolean; port?: number }> = {};

    setContext(model: SpatiotemporalModel): void {
        this.model = model;
        const running = model.id ? this.runningModels[model.id] : undefined;
        this.runtimePort = running?.port
            ?? (model.parameters as Record<string, unknown>)?._runtimePort as number | undefined;
    }

    getContext(): SpatiotemporalModel | null {
        return this.model;
    }

    getSelectedModelId(): string | null {
        return this.model?.id ?? null;
    }

    setRunningModels(runningModels: Record<string, { isRunning: boolean; port?: number }>): void {
        this.runningModels = runningModels;
        if (this.model) {
            const running = this.model.id ? this.runningModels[this.model.id] : undefined;
            this.runtimePort = running?.port
                ?? (this.model.parameters as Record<string, unknown>)?._runtimePort as number | undefined;
        }
    }

    // ─── Request Building ─────────────────────────────────────────

    private buildCloudImageRequest(
        apiKey: string,
        backendName: backend,
        modelPath: string | undefined,
        request: SpatiotemporalRequest,
    ): { url: string; headers: HeadersInit; body: string } {
        const templateUrl = spatiotemporalCloudImageEndpoints[backendName];
        if (!templateUrl) throw new Error(`Unsupported spatiotemporal cloud backend: ${backendName}`);

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) {
            headers.Authorization = `Bearer ${apiKey}`;
        }

        const bodyObj: Record<string, unknown> = {
            model: modelPath || 'default-model',
            prompt: request.prompt,
        };

        if (request.n) bodyObj.n = request.n;
        if (request.width && request.height) {
            bodyObj.size = `${request.width}x${request.height}`;
        } else if (request.resolution) {
            bodyObj.resolution = request.resolution;
        }
        if (request.aspectRatio) bodyObj.aspect_ratio = request.aspectRatio;
        if (request.outputFormat) bodyObj.output_format = request.outputFormat;
        if (request.seed !== undefined) bodyObj.seed = request.seed;
        if (request.inputReferences && request.inputReferences.length > 0) {
            bodyObj.input_references = request.inputReferences.map(url => ({
                type: 'image_url',
                image_url: { url },
            }));
        }

        return { url: templateUrl, headers, body: JSON.stringify(bodyObj) };
    }

    private buildCloudVideoRequest(
        apiKey: string,
        backendName: backend,
        modelPath: string | undefined,
        request: SpatiotemporalRequest,
    ): { url: string; headers: HeadersInit; body: string } {
        const templateUrl = spatiotemporalCloudVideoEndpoints[backendName];
        if (!templateUrl) throw new Error(`Unsupported spatiotemporal video backend: ${backendName}`);

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) {
            headers.Authorization = `Bearer ${apiKey}`;
        }

        const bodyObj: Record<string, unknown> = {
            model: modelPath || 'default-model',
            prompt: request.prompt,
        };

        if (request.duration) bodyObj.duration = request.duration;
        if (request.resolution) bodyObj.resolution = request.resolution;
        if (request.aspectRatio) bodyObj.aspect_ratio = request.aspectRatio;
        if (request.width && request.height) {
            bodyObj.size = `${request.width}x${request.height}`;
        }
        if (request.seed !== undefined) bodyObj.seed = request.seed;
        if (request.generateAudio !== undefined) bodyObj.generate_audio = request.generateAudio;

        if (request.frameImages && request.frameImages.length > 0) {
            bodyObj.frame_images = request.frameImages.map(f => ({
                type: 'image_url',
                image_url: { url: f.url },
                frame_type: f.frameType,
            }));
        } else if (request.inputReferences && request.inputReferences.length > 0) {
            bodyObj.input_references = request.inputReferences.map(url => ({
                type: 'image_url',
                image_url: { url },
            }));
        }

        return { url: templateUrl, headers, body: JSON.stringify(bodyObj) };
    }

    private buildLocalOpenAIRequest(
        port: number | undefined,
        request: SpatiotemporalRequest,
    ): { url: string; headers: HeadersInit; body: string } {
        const headers: HeadersInit = { 'Content-Type': 'application/json' };

        const baseUrl = port
            ? `${localAddress}:${port}`
            : `${localAddress}:8188`;

        const url = `${baseUrl}/v1/images/generations`;

        const defaults = this.model?.defaults || {};
        const width = request.width || defaults.width || 512;
        const height = request.height || defaults.height || 512;

        const bodyObj: Record<string, unknown> = {
            prompt: request.prompt,
            n: request.n || 1,
            size: `${width}x${height}`,
        };

        if (request.outputFormat) bodyObj.output_format = request.outputFormat;

        return { url, headers, body: JSON.stringify(bodyObj) };
    }

    private buildLocalSdapiRequest(
        port: number | undefined,
        request: SpatiotemporalRequest,
    ): { url: string; headers: HeadersInit; body: string } {
        const headers: HeadersInit = { 'Content-Type': 'application/json' };

        const baseUrl = port
            ? `${localAddress}:${port}`
            : `${localAddress}:8188`;

        const url = `${baseUrl}/sdapi/v1/txt2img`;

        const defaults = this.model?.defaults || {};

        const bodyObj: Record<string, unknown> = {
            prompt: request.prompt,
            negative_prompt: request.negativePrompt || '',
            width: request.width || defaults.width || 512,
            height: request.height || defaults.height || 512,
            steps: request.steps || defaults.steps || 20,
            cfg_scale: request.cfgScale || defaults.cfgScale || 7.0,
            seed: request.seed ?? -1,
            sampler_name: request.samplerName || defaults.samplingMethod || 'euler_a',
            scheduler: request.scheduler || defaults.noiseSchedule || 'normal',
            batch_size: request.n || 1,
        };

        if (request.clipSkip || defaults.clipSkip) {
            bodyObj.clip_skip = request.clipSkip || defaults.clipSkip;
        }

        return { url, headers, body: JSON.stringify(bodyObj) };
    }

    private resolveRequest(
        request: SpatiotemporalRequest,
    ): { url: string; headers: HeadersInit; body: string } {
        const apiKey = this.model?.apiKey;
        const backendName = this.model?.backend;

        if (apiKey && backendName && spatiotemporalCloudBackends.includes(backendName as cloudBackend)) {
            const isVideoRequest = this.isVideoModel() || request.duration !== undefined;
            if (isVideoRequest) {
                return this.buildCloudVideoRequest(apiKey, backendName, this.model?.model, request);
            }
            return this.buildCloudImageRequest(apiKey, backendName, this.model?.model, request);
        }

        // Local: prefer sdapi if negative prompt is provided, otherwise OpenAI-compatible
        if (backendName && sdapiCompatibleSpatiotemporalLocalBackends.has(backendName) && request.negativePrompt) {
            return this.buildLocalSdapiRequest(this.runtimePort, request);
        }

        if (backendName && openAiCompatibleSpatiotemporalLocalBackends.has(backendName)) {
            return this.buildLocalOpenAIRequest(this.runtimePort, request);
        }

        return this.buildLocalOpenAIRequest(this.runtimePort, request);
    }

    // ─── Main Generation Entry Point ──────────────────────────────

    async generate(
        request: SpatiotemporalRequest,
        signal?: AbortSignal,
        callbacks?: SpatiotemporalCallbacks,
    ): Promise<SpatiotemporalResult> {
        if (!this.model) {
            return { success: false, error: 'No spatiotemporal model configured' };
        }

        const apiKey = this.model.apiKey;
        const backendName = this.model.backend;
        const isVideoRequest = this.isVideoModel() || request.duration !== undefined;

        // Cloud video requires async polling — handle separately
        if (apiKey && spatiotemporalCloudBackends.includes(backendName as cloudBackend) && isVideoRequest) {
            return this.generateCloudVideo(request, signal, callbacks);
        }

        // Everything else (cloud images + local) is synchronous
        callbacks?.onProgress?.('Starting generation...');

        const { url, headers, body } = this.resolveRequest(request);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body,
                signal,
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMsg = (errorData as any)?.error?.message || (errorData as any)?.error || `HTTP ${response.status}`;
                return { success: false, error: `Generation error: ${errorMsg}` };
            }

            const data = await response.json();

            // OpenAI-compatible response (cloud images + local sd-server /v1/images)
            if ('data' in data && Array.isArray((data as SdServerOpenAIResponse).data)) {
                const openaiData = data as SdServerOpenAIResponse | OpenRouterImageResponse;
                callbacks?.onProgress?.('Generation complete!', 100);
                return {
                    success: true,
                    images: (openaiData as any).data.map((d: any) => d.b64_json),
                    mediaType: (openaiData as any).output_format
                        ? `image/${(openaiData as any).output_format}`
                        : (openaiData as any).data?.[0]?.media_type || 'image/png',
                    usage: (openaiData as any).usage ? {
                        promptTokens: (openaiData as any).usage?.prompt_tokens,
                        completionTokens: (openaiData as any).usage?.completion_tokens,
                        cost: (openaiData as any).usage?.cost,
                    } : undefined,
                };
            }

            // SDAPI response (local sd-server /sdapi/v1/txt2img)
            if ('images' in data && Array.isArray((data as SdServerSdapiResponse).images)) {
                const sdapiData = data as SdServerSdapiResponse;
                callbacks?.onProgress?.('Generation complete!', 100);
                return {
                    success: true,
                    images: sdapiData.images,
                    mediaType: 'image/png',
                };
            }

            return { success: false, error: 'Unknown response format from server' };
        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                return { success: false, error: 'Generation cancelled' };
            }
            return { success: false, error: `Generation failed: ${(error as Error).message}` };
        }
    }

    // ─── Cloud Video Generation (Async Polling) ───────────────────

    private async generateCloudVideo(
        request: SpatiotemporalRequest,
        signal?: AbortSignal,
        callbacks?: SpatiotemporalCallbacks,
    ): Promise<SpatiotemporalResult> {
        if (!this.model?.apiKey) {
            return { success: false, error: 'API key required for cloud video generation' };
        }

        callbacks?.onProgress?.('Submitting video generation job...', 0);

        const { url, headers, body } = this.buildCloudVideoRequest(
            this.model.apiKey,
            this.model.backend,
            this.model.model,
            request,
        );

        try {
            const submitResponse = await fetch(url, {
                method: 'POST',
                headers,
                body,
                signal,
            });

            if (!submitResponse.ok) {
                const errorData = await submitResponse.json().catch(() => ({}));
                return {
                    success: false,
                    error: `Video submit error: ${submitResponse.status} - ${(errorData as any).error?.message || 'Unknown error'}`,
                };
            }

            const submitData = await submitResponse.json() as OpenRouterVideoSubmitResponse;
            callbacks?.onProgress?.(`Job submitted: ${submitData.id}`, 10);

            // Construct polling URL: prefer the one returned by the API, fallback to dictionary template
            let pollingUrl = submitData.polling_url;
            if (!pollingUrl) {
                const templateUrl = spatiotemporalCloudVideoPollEndpoints[this.model.backend];
                if (templateUrl) {
                    pollingUrl = templateUrl.replace('{jobId}', submitData.id);
                } else {
                    return { success: false, error: 'No polling URL provided by backend and no template found.' };
                }
            }

            return await this.pollVideoJob(pollingUrl, signal, callbacks);
        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                return { success: false, error: 'Video generation cancelled' };
            }
            return { success: false, error: `Video generation failed: ${(error as Error).message}` };
        }
    }

    private async pollVideoJob(
        pollingUrl: string,
        signal?: AbortSignal,
        callbacks?: SpatiotemporalCallbacks,
    ): Promise<SpatiotemporalResult> {
        let attempts = 0;
        let lastStatus = '';

        while (attempts < VIDEO_MAX_POLL_ATTEMPTS) {
            if (signal?.aborted) {
                return { success: false, error: 'Video generation cancelled' };
            }

            attempts++;
            const progress = Math.min(10 + (attempts / VIDEO_MAX_POLL_ATTEMPTS) * 80, 90);
            callbacks?.onProgress?.(`Polling job status... (attempt ${attempts})`, progress);

            try {
                const pollResponse = await fetch(pollingUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${this.model?.apiKey}`,
                    },
                    signal,
                });

                if (!pollResponse.ok) {
                    return { success: false, error: `Poll failed: ${pollResponse.status}` };
                }

                const pollData = await pollResponse.json() as OpenRouterVideoPollResponse;

                if (pollData.status !== lastStatus) {
                    callbacks?.onProgress?.(`Status: ${pollData.status}`, progress);
                    lastStatus = pollData.status;
                }

                switch (pollData.status) {
                    case 'completed': {
                        callbacks?.onProgress?.('Video ready!', 95);

                        const videoUrl = pollData.unsigned_urls?.[0] || pollData.urls?.[0];
                        if (!videoUrl) {
                            return { success: false, error: 'No video URL in completed response' };
                        }

                        callbacks?.onProgress?.('Video generation complete!', 100);

                        return {
                            success: true,
                            videoUrl,
                            mediaType: 'video/mp4',
                            jobId: pollData.id,
                            usage: { cost: pollData.usage?.cost },
                        };
                    }

                    case 'failed':
                        return {
                            success: false,
                            error: `Video generation failed: ${pollData.error || 'Unknown error'}`,
                            jobId: pollData.id,
                        };

                    case 'cancelled':
                        return { success: false, error: 'Video generation was cancelled', jobId: pollData.id };

                    case 'expired':
                        return { success: false, error: 'Video generation job expired', jobId: pollData.id };

                    case 'pending':
                    case 'in_progress':
                        await new Promise(resolve => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
                        break;

                    default:
                        return { success: false, error: `Unknown status: ${pollData.status}` };
                }
            } catch (error) {
                if ((error as Error).name === 'AbortError') {
                    return { success: false, error: 'Video generation cancelled during polling' };
                }
                await new Promise(resolve => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
            }
        }

        return { success: false, error: 'Video generation timed out after maximum polling attempts' };
    }

    // ─── Helper Methods ───────────────────────────────────────────

    private isVideoModel(): boolean {
        if (!this.model) return false;
        const modelName = (this.model.model || '').toLowerCase();
        const videoPatterns = ['veo', 'wan', 'hailuo', 'minimax', 'ltx', 'video', 'kling'];
        return videoPatterns.some(pattern => modelName.includes(pattern));
    }
}

// ─── Singleton Accessor ──────────────────────────────────────────────

let instance: SpatiotemporalModelEngine | null = null;

export function getSpatiotemporalModelEngine(): SpatiotemporalModelEngine {
    if (instance) return instance;
    const engine = new SpatiotemporalModelEngine();
    instance = engine;
    return engine;
}

export function reset(): void {
    instance = null;
}