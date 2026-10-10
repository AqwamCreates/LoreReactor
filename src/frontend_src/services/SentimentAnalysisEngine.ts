// frontend_src/services/SentimentAnalysisEngine.ts
import type { deviceType } from '../types';

const EMOTION_LABELS = [
    'admiration', 'amusement', 'anger', 'annoyance', 'approval',
    'caring', 'confusion', 'curiosity', 'desire', 'disappointment',
    'disapproval', 'disgust', 'embarrassment', 'excitement', 'fear',
    'gratitude', 'grief', 'joy', 'love', 'nervousness',
    'optimism', 'pride', 'realization', 'relief', 'remorse',
    'sadness', 'surprise', 'neutral'
] as const;

export type EmotionLabel = typeof EMOTION_LABELS[number];

export interface SentimentResult {
    emotions: Record<EmotionLabel, number>;
    topEmotion: EmotionLabel;
    topScore: number;
}

const HF_MODEL_ID = 'Cohee/distilbert-base-uncased-go-emotions-onnx';

type TextClassificationPipeline = (text: string | string[]) => Promise<Array<{ label: string; score: number }>>;

async function isWebGpuAvailable(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false;
    try {
        const adapter = await navigator.gpu.requestAdapter();
        return adapter !== null;
    } catch {
        return false;
    }
}

class SentimentAnalysisEngine {
    private classifier: TextClassificationPipeline | null = null;
    private loading: Promise<void> | null = null;
    private loadError: string | null = null;
    private usingWebGpu = false;
    
    // Internal state tracker for hardware execution preference
    private currentDevicePreference: deviceType = 'auto';

    /**
     * Updates the target execution device. 
     * If the engine is already loaded on a different device than the new preference,
     * it immediately unloads the pipeline so the next analysis call lazy-loads the correct backend.
     */
    setDevicePreference(preference: deviceType): void {
        if (this.currentDevicePreference !== preference) {
            this.currentDevicePreference = preference;
            
            if (this.classifier) {
                const isGpu = this.usingWebGpu;
                const wantsCpu = preference === 'cpu';
                const wantsGpu = preference === 'gpu';
                
                if ((wantsCpu && isGpu) || (wantsGpu && !isGpu)) {
                    console.log(`[SentimentEngine] Device preference changed to ${preference}. Unloading current pipeline to lazy-reload on next use.`);
                    this.unload(); 
                }
            }
        }
    }

    async initialize(): Promise<void> {
        if (this.classifier) return;
        if (this.loading) return this.loading;

        this.loading = (async () => {
            const { pipeline } = await import('@huggingface/transformers');
            
            const devicePreference = this.currentDevicePreference; 
            const webGpuAvailable = devicePreference !== 'cpu' ? await isWebGpuAvailable() : false;

            if (webGpuAvailable && devicePreference !== 'cpu') {
                try {
                    console.log('[SentimentEngine] Loading with WebGPU...');
                    this.classifier = await pipeline('text-classification', HF_MODEL_ID, {
                        dtype: 'fp32',
                        device: 'webgpu',
                    }) as TextClassificationPipeline;
                    this.usingWebGpu = true;
                    console.log('[SentimentEngine] Ready (WebGPU).');
                    return;
                } catch (e) {
                    console.warn('[SentimentEngine] WebGPU failed, falling back to CPU:', e instanceof Error ? e.message : String(e));
                    this.classifier = null;
                    if (devicePreference === 'gpu') {
                        this.loadError = 'WebGPU forced but failed. Falling back to CPU.';
                    }
                }
            }

            try {
                console.log('[SentimentEngine] Loading with CPU/WASM...');
                this.classifier = await pipeline('text-classification', HF_MODEL_ID, {
                    dtype: 'fp32',
                    device: 'cpu',
                }) as TextClassificationPipeline;
                this.usingWebGpu = false;
                console.log('[SentimentEngine] Ready (CPU).');
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error('[SentimentEngine] Initialization failed:', msg);
                this.loadError = msg;
                this.classifier = null;
            } finally {
                this.loading = null;
            }
        })();

        return this.loading;
    }

    async unload(): Promise<void> {
        if (this.loading) {
            try { await this.loading; } catch { /* ignore */ }
        }

        if (this.classifier) console.log('[SentimentEngine] Unloaded.');

        this.classifier = null;
        this.loading = null;
        this.loadError = null;
        this.usingWebGpu = false;
    }

    async analyze(text: string): Promise<SentimentResult | null> {
        // Trigger lazy loading if the pipeline is not currently active or mid-flight
        if (!this.classifier && !this.loading) {
            await this.initialize();
        }
        
        if (!this.classifier) return null;

        try {
            const results = await this.classifier(text);

            const emotions = {} as Record<EmotionLabel, number>;
            let topEmotion: EmotionLabel = 'neutral';
            let topScore = Number.NEGATIVE_INFINITY;

            for (const label of EMOTION_LABELS) {
                emotions[label] = 0;
            }

            const resultList = Array.isArray(results) ? results : [results];
            for (const item of resultList) {
                const label = item.label.toLowerCase() as EmotionLabel;
                if (label in emotions) {
                    emotions[label] = item.score;
                    if (item.score > topScore) {
                        topScore = item.score;
                        topEmotion = label;
                    }
                }
            }

            return { emotions, topEmotion, topScore };
        } catch (e) {
            console.warn('[SentimentEngine] Analysis failed:', e);
            return null;
        }
    }

    isReady(): boolean {
        return this.classifier !== null;
    }

    isUsingWebGpu(): boolean {
        return this.usingWebGpu;
    }

    getError(): string | null {
        return this.loadError;
    }
}

export const sentimentEngine = new SentimentAnalysisEngine();