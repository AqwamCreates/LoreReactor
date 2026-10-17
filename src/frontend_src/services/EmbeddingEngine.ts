// src/frontend_src/services/EmbeddingEngine.ts
import type { deviceType } from '../types';

const HF_MODEL_ID = 'onnx-community/embeddinggemma-300m'; 
const IDLE_UNLOAD_MS = 3 * 60 * 1000; // 3 minute

type FeatureExtractionPipeline = (text: string | string[], options?: any) => Promise<any>;

async function isWebGpuAvailable(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false;
    try {
        const adapter = await navigator.gpu.requestAdapter();
        return adapter !== null;
    } catch {
        return false;
    }
}

class EmbeddingEngine {
    private extractor: FeatureExtractionPipeline | null = null;
    private loading: Promise<void> | null = null;
    private loadError: string | null = null;
    private usingWebGpu = false;
    private currentDevicePreference: deviceType = 'auto';
    private idleTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Updates the target execution device. 
     * If the engine is already loaded on a different device than the new preference,
     * it immediately unloads the pipeline so the next embed call lazy-loads the correct backend.
     */
    setDevicePreference(preference: deviceType): void {
        if (this.currentDevicePreference !== preference) {
            this.currentDevicePreference = preference;
            
            if (this.extractor) {
                const isGpu = this.usingWebGpu;
                const wantsCpu = preference === 'cpu';
                const wantsGpu = preference === 'gpu';
                
                if ((wantsCpu && isGpu) || (wantsGpu && !isGpu)) {
                    console.log(`[EmbeddingEngine] Device preference changed to ${preference}. Unloading current pipeline to lazy-reload on next use.`);
                    this.unload(); 
                }
            }
        }
    }

    async initialize(): Promise<void> {
        if (this.extractor) {
            this.resetIdleTimer();
            return;
        }
        if (this.loading) return this.loading;

        this.loading = (async () => {
            const { pipeline } = await import('@huggingface/transformers');
            
            const devicePreference = this.currentDevicePreference; 
            const webGpuAvailable = devicePreference !== 'cpu' ? await isWebGpuAvailable() : false;

            if (webGpuAvailable && devicePreference !== 'cpu') {
                try {
                    console.log('[EmbeddingEngine] Loading with WebGPU...');
                    this.extractor = await pipeline('feature-extraction', HF_MODEL_ID, {
                        dtype: 'q8', // Quantized 8-bit is usually best for embeddings on WebGPU
                        device: 'webgpu',
                    }) as FeatureExtractionPipeline;
                    this.usingWebGpu = true;
                    console.log('[EmbeddingEngine] Ready (WebGPU).');
                    return;
                } catch (e) {
                    console.warn('[EmbeddingEngine] WebGPU failed, falling back to CPU:', e instanceof Error ? e.message : String(e));
                    this.extractor = null;
                    if (devicePreference === 'gpu') {
                        this.loadError = 'WebGPU forced but failed. Falling back to CPU.';
                    }
                }
            }

            try {
                console.log('[EmbeddingEngine] Loading with CPU/WASM...');
                this.extractor = await pipeline('feature-extraction', HF_MODEL_ID, {
                    dtype: 'q8',
                    device: 'cpu',
                }) as FeatureExtractionPipeline;
                this.usingWebGpu = false;
                console.log('[EmbeddingEngine] Ready (CPU).');
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error('[EmbeddingEngine] Initialization failed:', msg);
                this.loadError = msg;
                this.extractor = null;
            } finally {
                this.loading = null;
            }
        })();

        return this.loading;
    }

    async unload(): Promise<void> {
        this.clearIdleTimer();
        if (this.loading) {
            try { await this.loading; } catch { /* ignore */ }
        }

        if (this.extractor) console.log('[EmbeddingEngine] Unloaded.');

        this.extractor = null;
        this.loading = null;
        this.loadError = null;
        this.usingWebGpu = false;
    }

    private resetIdleTimer(): void {
        this.clearIdleTimer();
        this.idleTimer = setTimeout(() => {
            console.log('[EmbeddingEngine] Idle for 2 minutes, unloading to free VRAM/RAM.');
            this.unload();
        }, IDLE_UNLOAD_MS);
    }

    private clearIdleTimer(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    /**
     * Generates embeddings for the given text.
     * Returns a 1D array of numbers for a single string, or a 2D array for multiple strings.
     */
    async embed(text: string): Promise<number[] | null>;
    async embed(text: string[]): Promise<number[][] | null>;
    async embed(text: string | string[]): Promise<number[] | number[][] | null> {
        if (!this.extractor && !this.loading) {
            await this.initialize();
        }
        
        if (!this.extractor) return null;

        this.resetIdleTimer();

        try {
            // pooling: 'mean' averages the token vectors. normalize: true ensures cosine similarity works via dot product.
            const result = await this.extractor(text, { pooling: 'mean', normalize: true });
            
            const dims = result.dims;
            const data = result.data as Float32Array;

            if (typeof text === 'string') {
                // Single string: dims is usually [1, hidden_size] or [hidden_size]
                return Array.from(data);
            } else {
                // Array of strings: dims is [batch_size, hidden_size]
                const batchSize = dims[0];
                const hiddenSize = dims.length > 1 ? dims[1] : data.length / batchSize;
                const vectors: number[][] = [];
                
                for (let i = 0; i < batchSize; i++) {
                    vectors.push(Array.from(data.slice(i * hiddenSize, (i + 1) * hiddenSize)));
                }
                return vectors;
            }
        } catch (e) {
            console.warn('[EmbeddingEngine] Embedding generation failed:', e);
            return null;
        }
    }

    isReady(): boolean {
        return this.extractor !== null;
    }

    isUsingWebGpu(): boolean {
        return this.usingWebGpu;
    }

    getError(): string | null {
        return this.loadError;
    }
}

export const embeddingEngine = new EmbeddingEngine();