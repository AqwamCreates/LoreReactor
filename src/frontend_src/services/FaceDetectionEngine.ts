// src/frontend_src/services/FaceDetectionEngine.ts
import * as ort from 'onnxruntime-web';
import type { deviceType } from '../types';

// UltraFace RFB-640 ONNX model hosted on Hugging Face (Apache-2.0 Licensed)
const FACE_MODEL_URL = 'https://huggingface.co/onnxmodelzoo/version-RFB-640/resolve/main/version-RFB-640.onnx';
const MODEL_INPUT_WIDTH = 640;
const MODEL_INPUT_HEIGHT = 480;
const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_PROBABILITY_THRESHOLD = 0.75;
const IDLE_UNLOAD_MS = 3 * 60 * 1000; // 3 minutes

export type FaceDetectionStatus = 'idle' | 'loading' | 'monitoring';

export interface FaceDetectionMonitorOptions {
    getVideoElement: () => Promise<HTMLVideoElement | null> | HTMLVideoElement | null;
    onPresenceChange: (isDetected: boolean, probability: number) => void;
    intervalMs?: number;
    probabilityThreshold?: number;
    devicePreference?: deviceType;
}

async function isWebGpuAvailable(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false;
    try {
        const adapter = await navigator.gpu.requestAdapter();
        return adapter !== null;
    } catch {
        return false;
    }
}

function clampInterval(ms?: number): number {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return DEFAULT_INTERVAL_MS;
    return Math.max(50, Math.round(ms));
}

function clampThreshold(threshold?: number): number {
    if (typeof threshold !== 'number' || !Number.isFinite(threshold)) return DEFAULT_PROBABILITY_THRESHOLD;
    return Math.max(0, Math.min(1, threshold));
}

class FaceDetectionEngine {
    private session: ort.InferenceSession | null = null;
    private loading: Promise<void> | null = null;
    private loadError: string | null = null;
    private usingWebGpu = false;
    private sessionEpoch = 0;
    private inferPromise: Promise<number> | null = null;

    private currentDevicePreference: deviceType = 'auto';

    // Reusable preprocessing buffers to avoid per-tick GC allocations
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private inputBuffer: Float32Array | null = null;

    // Monitoring state
    private status: FaceDetectionStatus = 'idle';
    private statusListeners = new Set<(status: FaceDetectionStatus) => void>();
    private monitoringActive = false;
    private monitorEpoch = 0;
    private tickTimer: ReturnType<typeof setTimeout> | null = null;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;

    private getVideoElement: (() => Promise<HTMLVideoElement | null> | HTMLVideoElement | null) | null = null;
    private onPresenceChange: ((isDetected: boolean, probability: number) => void) | null = null;
    private intervalMs = DEFAULT_INTERVAL_MS;
    private probabilityThreshold = DEFAULT_PROBABILITY_THRESHOLD;
    private lastDetectedStatus: boolean | null = null;

    constructor() {
        // Point to CDN to avoid bundler WASM 404 errors in production
        if (!ort.env.wasm.wasmPaths) {
            ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
        }
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.simd = true;
    }

    private setStatus(status: FaceDetectionStatus): void {
        if (this.status !== status) {
            this.status = status;
            for (const listener of this.statusListeners) {
                try {
                    listener(status);
                } catch {
                    // ignore subscriber errors
                }
            }
        }
    }

    onStatusChange(listener: (status: FaceDetectionStatus) => void): () => void {
        this.statusListeners.add(listener);
        listener(this.status);
        return () => {
            this.statusListeners.delete(listener);
        };
    }

    getStatus(): FaceDetectionStatus {
        return this.status;
    }

    setDevicePreference(preference: deviceType): void {
        if (this.currentDevicePreference !== preference) {
            this.currentDevicePreference = preference;

            if (this.session || this.loading) {
                const isGpu = this.usingWebGpu;
                const wantsCpu = preference === 'cpu';
                const wantsGpu = preference === 'gpu';

                if ((wantsCpu && isGpu) || (wantsGpu && !isGpu) || preference === 'auto') {
                    console.log(`[FaceDetectionEngine] Device preference changed to ${preference}. Unloading to lazy-reload.`);
                    void this.unloadSession();
                }
            }
        }
    }

    private clearIdleTimer(): void {
        if (this.idleTimer !== null) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    private resetIdleTimer(): void {
        this.clearIdleTimer();
        this.idleTimer = setTimeout(() => {
            if (!this.monitoringActive && this.status === 'idle') {
                console.log('[FaceDetectionEngine] Idle for 3 minutes, unloading.');
                void this.unload();
            }
        }, IDLE_UNLOAD_MS);
    }

    private ensureBuffers(): void {
        if (!this.canvas && typeof document !== 'undefined') {
            this.canvas = document.createElement('canvas');
            this.canvas.width = MODEL_INPUT_WIDTH;
            this.canvas.height = MODEL_INPUT_HEIGHT;
            this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        }
        if (!this.inputBuffer) {
            this.inputBuffer = new Float32Array(3 * MODEL_INPUT_HEIGHT * MODEL_INPUT_WIDTH);
        }
    }

    private async createSessionWithFallback(): Promise<{ session: ort.InferenceSession; usingWebGpu: boolean } | null> {
        const devicePreference = this.currentDevicePreference;
        const webGpuAvailable = devicePreference !== 'cpu' ? await isWebGpuAvailable() : false;

        if (webGpuAvailable && devicePreference !== 'cpu') {
            try {
                console.log('[FaceDetectionEngine] Loading UltraFace-640 with WebGPU...');
                const session = await ort.InferenceSession.create(FACE_MODEL_URL, {
                    executionProviders: ['webgpu'],
                });
                return { session, usingWebGpu: true };
            } catch (e) {
                console.warn('[FaceDetectionEngine] WebGPU failed, falling back to WASM:', e instanceof Error ? e.message : String(e));
                if (devicePreference === 'gpu') {
                    this.loadError = 'WebGPU forced but failed. Falling back to CPU/WASM.';
                }
            }
        }

        console.log('[FaceDetectionEngine] Loading UltraFace-640 with WASM...');
        const session = await ort.InferenceSession.create(FACE_MODEL_URL, {
            executionProviders: ['wasm'],
        });
        return { session, usingWebGpu: false };
    }

    async initialize(): Promise<boolean> {
        if (this.session) {
            if (!this.monitoringActive) this.resetIdleTimer();
            return true;
        }
        if (this.loading) {
            await this.loading;
            return this.session !== null;
        }

        const epoch = ++this.sessionEpoch;
        this.loadError = null;

        this.loading = (async () => {
            try {
                const created = await this.createSessionWithFallback();
                if (!created) return;

                if (epoch !== this.sessionEpoch) {
                    try { await created.session.release(); } catch {}
                    return;
                }

                this.session = created.session;
                this.usingWebGpu = created.usingWebGpu;
                this.ensureBuffers();
                console.log(`[FaceDetectionEngine] Ready (${this.usingWebGpu ? 'WebGPU' : 'WASM'}).`);
            } catch (e) {
                if (epoch === this.sessionEpoch) {
                    const msg = e instanceof Error ? e.message : String(e);
                    console.error('[FaceDetectionEngine] Initialization failed:', msg);
                    this.loadError = msg;
                    this.session = null;
                    this.usingWebGpu = false;
                }
            } finally {
                if (epoch === this.sessionEpoch) {
                    this.loading = null;
                }
            }
        })();

        await this.loading;
        return this.session !== null;
    }

    private async unloadSession(): Promise<void> {
        this.sessionEpoch++;

        if (this.loading) {
            try { await this.loading; } catch {}
        }
        if (this.inferPromise) {
            try { await this.inferPromise; } catch {}
        }

        const activeSession = this.session;
        this.session = null;
        this.loading = null;
        this.usingWebGpu = false;

        if (activeSession) {
            try { await activeSession.release(); } catch {}
        }
    }

    async unload(): Promise<void> {
        this.clearIdleTimer();
        this.stopMonitoring(false);
        await this.unloadSession();

        this.loadError = null;
        this.canvas = null;
        this.ctx = null;
        this.inputBuffer = null;
        this.setStatus('idle');
        console.log('[FaceDetectionEngine] Unloaded.');
    }

    private extractScoresTensor(results: ort.InferenceSession.OnnxValueMapType): ort.Tensor | null {
        if (results.scores) return results.scores;
        for (const tensor of Object.values(results)) {
            if (tensor && tensor.dims.length === 3 && tensor.dims[2] === 2) {
                return tensor;
            }
        }
        return null;
    }

    /**
     * Runs face detection on a live video element frame.
     * Returns the peak face probability (0.0 to 1.0), or -1 if unavailable/failed.
     */
    async detectFromVideo(video: HTMLVideoElement): Promise<number> {
        if (this.inferPromise) {
            return this.inferPromise;
        }

        if (!this.session && !this.loading) {
            await this.initialize();
        } else if (this.loading) {
            await this.loading;
        }

        const session = this.session;
        if (!session) return -1;
        if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return -1;

        this.ensureBuffers();
        if (!this.ctx || !this.inputBuffer) return -1;

        const runEpoch = this.sessionEpoch;

        const task = (async (): Promise<number> => {
            let inputTensor: ort.Tensor | null = null;
            let results: ort.InferenceSession.OnnxValueMapType | null = null;

            try {
                this.ctx!.drawImage(video, 0, 0, MODEL_INPUT_WIDTH, MODEL_INPUT_HEIGHT);
                const imageData = this.ctx!.getImageData(0, 0, MODEL_INPUT_WIDTH, MODEL_INPUT_HEIGHT).data;
                const planeSize = MODEL_INPUT_WIDTH * MODEL_INPUT_HEIGHT;
                const buf = this.inputBuffer!;

                for (let i = 0; i < planeSize; i++) {
                    const rgbaIdx = i * 4;
                    buf[i] = (imageData[rgbaIdx] - 127) / 128;
                    buf[planeSize + i] = (imageData[rgbaIdx + 1] - 127) / 128;
                    buf[planeSize * 2 + i] = (imageData[rgbaIdx + 2] - 127) / 128;
                }

                const inputName = session.inputNames[0] || 'input';
                inputTensor = new ort.Tensor('float32', buf, [1, 3, MODEL_INPUT_HEIGHT, MODEL_INPUT_WIDTH]);
                results = await session.run({ [inputName]: inputTensor });

                if (runEpoch !== this.sessionEpoch) {
                    return -1;
                }

                const scoresTensor = this.extractScoresTensor(results);
                if (!scoresTensor) return -1;

                const scoresData = scoresTensor.data as Float32Array;
                let maxFaceProb = 0;
                for (let i = 1; i < scoresData.length; i += 2) {
                    const prob = scoresData[i];
                    if (prob > maxFaceProb) {
                        maxFaceProb = prob;
                    }
                }

                return maxFaceProb;
            } catch (e) {
                console.warn('[FaceDetectionEngine] Inference failed:', e);
                // If WebGPU failed mid-inference (e.g. unsupported operator), fall back cleanly to WASM
                if (this.usingWebGpu && runEpoch === this.sessionEpoch) {
                    console.warn('[FaceDetectionEngine] Falling back to WASM after WebGPU runtime failure.');
                    this.currentDevicePreference = 'cpu';
                    // Dispose references before releasing session
                    if (results) {
                        for (const tensor of Object.values(results)) {
                            try { tensor?.dispose(); } catch {}
                        }
                        results = null;
                    }
                    if (inputTensor) {
                        try { inputTensor.dispose(); } catch {}
                        inputTensor = null;
                    }
                    try { await session.release(); } catch {}
                    if (runEpoch === this.sessionEpoch) {
                        this.session = null;
                        this.usingWebGpu = false;
                    }
                }
                return -1;
            } finally {
                if (results) {
                    for (const tensor of Object.values(results)) {
                        try { tensor?.dispose(); } catch {}
                    }
                }
                if (inputTensor) {
                    try { inputTensor.dispose(); } catch {}
                }
            }
        })();

        this.inferPromise = task;
        try {
            return await task;
        } finally {
            if (this.inferPromise === task) {
                this.inferPromise = null;
            }
        }
    }

    async startMonitoring(options: FaceDetectionMonitorOptions): Promise<boolean> {
        const epoch = ++this.monitorEpoch;
        this.clearIdleTimer();

        if (this.tickTimer !== null) {
            clearTimeout(this.tickTimer);
            this.tickTimer = null;
        }

        this.getVideoElement = options.getVideoElement;
        this.onPresenceChange = options.onPresenceChange;
        this.intervalMs = clampInterval(options.intervalMs);
        this.probabilityThreshold = clampThreshold(options.probabilityThreshold);
        this.lastDetectedStatus = null;

        if (options.devicePreference) {
            this.setDevicePreference(options.devicePreference);
        }

        this.monitoringActive = true;
        this.setStatus('loading');

        const loaded = await this.initialize();
        if (epoch !== this.monitorEpoch || !this.monitoringActive) {
            return false;
        }

        if (!loaded) {
            this.monitoringActive = false;
            this.setStatus('idle');
            return false;
        }

        this.setStatus('monitoring');
        this.scheduleNextTick(epoch, 0);
        return true;
    }

    updateMonitoringOptions(
        options: Partial<Pick<FaceDetectionMonitorOptions, 'intervalMs' | 'probabilityThreshold' | 'devicePreference' | 'getVideoElement' | 'onPresenceChange'>>
    ): void {
        if (options.getVideoElement) {
            this.getVideoElement = options.getVideoElement;
        }
        if (options.onPresenceChange) {
            this.onPresenceChange = options.onPresenceChange;
        }
        if (options.probabilityThreshold !== undefined) {
            this.probabilityThreshold = clampThreshold(options.probabilityThreshold);
        }
        if (options.devicePreference !== undefined) {
            this.setDevicePreference(options.devicePreference);
        }
        if (options.intervalMs !== undefined) {
            const nextInterval = clampInterval(options.intervalMs);
            if (nextInterval !== this.intervalMs) {
                this.intervalMs = nextInterval;
                if (this.monitoringActive && this.tickTimer !== null) {
                    clearTimeout(this.tickTimer);
                    this.tickTimer = null;
                    this.scheduleNextTick(this.monitorEpoch, this.intervalMs);
                }
            }
        }
    }

    stopMonitoring(scheduleIdleUnload = true): void {
        this.monitorEpoch++;
        this.monitoringActive = false;

        if (this.tickTimer !== null) {
            clearTimeout(this.tickTimer);
            this.tickTimer = null;
        }

        this.getVideoElement = null;
        this.onPresenceChange = null;
        this.lastDetectedStatus = null;
        this.setStatus('idle');

        if (scheduleIdleUnload && this.session) {
            this.resetIdleTimer();
        }
    }

    resetBaseline(): void {
        this.lastDetectedStatus = null;
    }

    private scheduleNextTick(epoch: number, delayMs: number): void {
        if (!this.monitoringActive || epoch !== this.monitorEpoch) return;

        if (this.tickTimer !== null) {
            clearTimeout(this.tickTimer);
            this.tickTimer = null;
        }

        this.tickTimer = setTimeout(() => {
            this.tickTimer = null;
            void this.runTick(epoch);
        }, delayMs);
    }

    private async runTick(epoch: number): Promise<void> {
        if (!this.monitoringActive || epoch !== this.monitorEpoch) return;

        const tickStart = performance.now();

        try {
            const video = await this.getVideoElement?.();
            if (!this.monitoringActive || epoch !== this.monitorEpoch) return;

            if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
                const maxFaceProb = await this.detectFromVideo(video);
                if (!this.monitoringActive || epoch !== this.monitorEpoch) return;

                if (maxFaceProb >= 0) {
                    const isDetected = maxFaceProb >= this.probabilityThreshold;

                    if (this.lastDetectedStatus === null) {
                        // First read silently establishes baseline
                        this.lastDetectedStatus = isDetected;
                    } else if (isDetected !== this.lastDetectedStatus) {
                        this.lastDetectedStatus = isDetected;
                        this.onPresenceChange?.(isDetected, maxFaceProb);
                    }
                }
            }
        } catch (e) {
            console.warn('[FaceDetectionEngine] Tick error:', e);
        } finally {
            if (this.monitoringActive && epoch === this.monitorEpoch) {
                const elapsed = performance.now() - tickStart;
                const nextDelay = Math.max(50, this.intervalMs - elapsed);
                this.scheduleNextTick(epoch, nextDelay);
            }
        }
    }

    isReady(): boolean {
        return this.session !== null;
    }

    isMonitoring(): boolean {
        return this.monitoringActive;
    }

    getLastDetectedStatus(): boolean | null {
        return this.lastDetectedStatus;
    }

    isUsingWebGpu(): boolean {
        return this.usingWebGpu;
    }

    getError(): string | null {
        return this.loadError;
    }
}

export const faceDetectionEngine = new FaceDetectionEngine();