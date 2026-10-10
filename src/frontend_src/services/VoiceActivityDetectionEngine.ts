// frontend_src/services/VoiceActivityDetectionEngine.ts
import * as ort from 'onnxruntime-web';
import type { deviceType } from '../types';

// Silero VAD ONNX model hosted on Hugging Face (MIT Licensed)
const VAD_MODEL_URL = 'https://huggingface.co/onnx-community/silero-vad/resolve/main/onnx/model.onnx';

class VoiceActivityDetectionEngine {
    private session: ort.InferenceSession | null = null;
    private loading: Promise<void> | null = null;
    private loadError: string | null = null;
    private usingWebGpu = false;
    
    private currentDevicePreference: deviceType = 'auto';
    
    // RNN State tensors for Silero VAD (Shape: [2, 1, 128])
    private state: ort.Tensor | null = null;
    private sampleRateTensor: ort.Tensor | null = null;

    constructor() {
        // Point to CDN to avoid bundler WASM 404 errors in production
        ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
        ort.env.wasm.numThreads = 1; // Keep it lightweight for real-time audio processing
        ort.env.wasm.simd = true;
    }

    setDevicePreference(preference: deviceType): void {
        if (this.currentDevicePreference !== preference) {
            this.currentDevicePreference = preference;
            if (this.session) {
                console.log(`[VADEngine] Device preference changed to ${preference}. Unloading to lazy-reload.`);
                this.unload();
            }
        }
    }

    async initialize(): Promise<boolean> {
        if (this.session) return true;
        if (this.loading) {
            await this.loading;
            return this.session !== null;
        }

        this.loading = (async () => {
            try {
                const devicePreference = this.currentDevicePreference;
                const eps: string[] = [];
                
                if (devicePreference !== 'cpu') {
                    // Attempt WebGPU if available and not forced to CPU
                    const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
                    if (hasWebGpu) eps.push('webgpu');
                }
                eps.push('wasm'); // Guaranteed WASM fallback

                console.log(`[VADEngine] Loading Silero VAD with EPs: ${eps.join(', ')}`);
                
                this.session = await ort.InferenceSession.create(VAD_MODEL_URL, {
                    executionProviders: eps,
                });

                this.usingWebGpu = eps[0] === 'webgpu';
                
                // Initialize RNN State (Shape: [2, 1, 128])
                this.state = new ort.Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
                this.sampleRateTensor = new ort.Tensor('int64', BigInt64Array.from([16000n]), [1]);
                
                console.log(`[VADEngine] Ready (${this.usingWebGpu ? 'WebGPU' : 'WASM'}).`);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error('[VADEngine] Initialization failed:', msg);
                this.loadError = msg;
                this.session = null;
            } finally {
                this.loading = null;
            }
        })();

        await this.loading;
        return this.session !== null;
    }

    async unload(): Promise<void> {
        if (this.loading) {
            try { await this.loading; } catch {}
        }
        if (this.session) {
            try { await this.session.release(); } catch {}
        }
        this.session = null;
        this.loading = null;
        this.loadError = null;
        this.usingWebGpu = false;
        this.state = null;
        this.sampleRateTensor = null;
        console.log('[VADEngine] Unloaded.');
    }

    /**
     * Resets the RNN hidden state tensors to zero.
     * Must be called between recording sessions to prevent temporal context bleed 
     * from the previous audio stream into the new one.
     */
    resetState(): void {
        if (this.session) {
            this.state = new ort.Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
        }
    }

    /**
     * Processes a 512-sample audio chunk at 16kHz.
     * Returns the speech probability (0.0 to 1.0).
     * Returns -1 if the model is not ready or inference fails.
     */
    async processChunk(chunk512: Float32Array): Promise<number> {
        if (!this.session || !this.state || !this.sampleRateTensor) return -1;
        if (chunk512.length !== 512) {
            console.warn('[VADEngine] Silero VAD strictly requires 512-sample chunks at 16kHz.');
            return -1;
        }

        try {
            const inputTensor = new ort.Tensor('float32', chunk512, [1, 512]);
            
            const feeds: Record<string, ort.Tensor> = {
                input: inputTensor,
                state: this.state,
                sr: this.sampleRateTensor
            };

            const results = await this.session.run(feeds);
            
            // Update state for the next chunk
            this.state = results.stateN as ort.Tensor;
            
            // Output probability
            const output = results.output as ort.Tensor;
            return output.data[0] as number;
        } catch (e) {
            console.warn('[VADEngine] Inference failed:', e);
            return -1;
        }
    }

    isReady(): boolean {
        return this.session !== null;
    }
    
    isUsingWebGpu(): boolean {
        return this.usingWebGpu;
    }

    getError(): string | null {
        return this.loadError;
    }
}

export const voiceActivityDetectionEngine = new VoiceActivityDetectionEngine();