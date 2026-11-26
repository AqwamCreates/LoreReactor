// src/frontend_src/services/FaceDetectionEngine.ts
import * as ort from 'onnxruntime-web';
import type { deviceType } from '../types';

// ─── Permissive Open-Source Models (Zero Copyleft) ───
// 1. UltraFace RFB-640 (MIT)
const FACE_MODEL_URL = 'https://huggingface.co/onnxmodelzoo/version-RFB-640/resolve/main/version-RFB-640.onnx';
// 2. MobileGaze MobileOne-S0 (MIT, 4.8 MB) — yaw/pitch gaze estimation
const GAZE_MODEL_URL = 'https://huggingface.co/yakhyo/uniface-weights/resolve/main/gaze_mobileone_s0.onnx';
// 3. MoveNet SinglePose Lightning (Apache-2.0, 9.4 MB) — 17-keypoint upper-body tracking
const POSE_MODEL_URL = 'https://huggingface.co/Xenova/movenet-singlepose-lightning/resolve/main/onnx/model.onnx';

const MODEL_INPUT_WIDTH = 640;
const MODEL_INPUT_HEIGHT = 480;
const GAZE_INPUT_SIZE = 448;
const POSE_INPUT_SIZE = 192;

const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_PROBABILITY_THRESHOLD = 0.8; // Internal calibrated baseline
const IDLE_UNLOAD_MS = 3 * 60 * 1000; // 3 minutes

// ─── Visual Shutter Thresholds & Cooldowns ───
const DOZING_OFF_SUSTAINED_MS = 1500;       // Eyes closed > 1.5s filters natural blinks
const DOZING_OFF_COOLDOWN_MS = 25000;
const LOOMING_FREEZE_HOLD_MS = 600;         // Object held steady > 600ms
const LOOMING_FREEZE_COOLDOWN_MS = 20000;
const GAZE_AWAY_SUSTAINED_MS = 8000;        // Gaze locked away / down at phone > 8s
const GAZE_AWAY_COOLDOWN_MS = 30000;
const GAZE_YAW_THRESHOLD_DEG = 34;          // Looking far left/right
const GAZE_PITCH_THRESHOLD_DEG = 28;        // Looking down at phone / away
const WRIST_STRETCH_HOLD_MS = 500;          // Both wrists raised above head > 500ms
const WRIST_STRETCH_COOLDOWN_MS = 25000;

const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

export type FaceDetectionStatus = 'idle' | 'loading' | 'monitoring';
export type VisualShutterType = 'dozing_off' | 'looming_freeze' | 'gaze_away' | 'wrist_stretch';

export interface FaceDetectionMonitorOptions {
    getVideoElement: () => Promise<HTMLVideoElement | null> | HTMLVideoElement | null;
    onPresenceChange: (isDetected: boolean, probability: number) => void;
    onMotionSpike?: (accumulatedMotion: number) => void;
    onVisualShutter?: (shutterType: VisualShutterType) => void;
    intervalMs?: number;
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

class FaceDetectionEngine {
    private session: ort.InferenceSession | null = null;
    private gazeSession: ort.InferenceSession | null = null;
    private poseSession: ort.InferenceSession | null = null;

    private loading: Promise<void> | null = null;
    private loadError: string | null = null;
    private usingWebGpu = false;
    private gazeUsingWebGpu = false;
    private poseUsingWebGpu = false;
    private sessionEpoch = 0;
    private inferPromise: Promise<number> | null = null;

    private currentDevicePreference: deviceType = 'auto';

    // Reusable preprocessing buffers to avoid per-tick GC allocations
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private inputBuffer: Float32Array | null = null;

    private gazeCanvas: HTMLCanvasElement | null = null;
    private gazeCtx: CanvasRenderingContext2D | null = null;
    private gazeBuffer: Float32Array | null = null;

    private poseCanvas: HTMLCanvasElement | null = null;
    private poseCtx: CanvasRenderingContext2D | null = null;

    // Head Movement, Full-Frame Scene Delta & Motion Accumulator State
    private previousBox: { cx: number; cy: number; area: number } | null = null;
    private previousLumaSample: Float32Array | null = null;
    private ambientLumaBaseline: Float32Array | null = null;
    private accumulatedMotion = 0;
    private lastMotionDelta = 0;
    private onMotionSpike: ((accumulatedMotion: number) => void) | null = null;

    // ─── Visual Moment Shutter States ───
    private onVisualShutter: ((shutterType: VisualShutterType) => void) | null = null;
    private eyesClosedStartTime: number | null = null;
    private lastDozingOffTriggerAt = 0;
    private loomingFreezeStartTime: number | null = null;
    private lastLoomingFreezeTriggerAt = 0;
    private gazeAwayStartTime: number | null = null;
    private lastGazeAwayTriggerAt = 0;
    private wristStretchStartTime: number | null = null;
    private lastWristStretchTriggerAt = 0;

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
    private readonly probabilityThreshold = DEFAULT_PROBABILITY_THRESHOLD;
    private lastDetectedStatus: boolean | null = null;

    constructor() {
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
                try { listener(status); } catch {}
            }
        }
    }

    onStatusChange(listener: (status: FaceDetectionStatus) => void): () => void {
        this.statusListeners.add(listener);
        listener(this.status);
        return () => { this.statusListeners.delete(listener); };
    }

    getStatus(): FaceDetectionStatus {
        return this.status;
    }

    setDevicePreference(preference: deviceType): void {
        if (this.currentDevicePreference !== preference) {
            this.currentDevicePreference = preference;

            if (this.session || this.gazeSession || this.poseSession || this.loading) {
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
        if (typeof document !== 'undefined') {
            if (!this.canvas) {
                this.canvas = document.createElement('canvas');
                this.canvas.width = MODEL_INPUT_WIDTH;
                this.canvas.height = MODEL_INPUT_HEIGHT;
                this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
            }
            if (!this.gazeCanvas) {
                this.gazeCanvas = document.createElement('canvas');
                this.gazeCanvas.width = GAZE_INPUT_SIZE;
                this.gazeCanvas.height = GAZE_INPUT_SIZE;
                this.gazeCtx = this.gazeCanvas.getContext('2d', { willReadFrequently: true });
            }
            if (!this.poseCanvas) {
                this.poseCanvas = document.createElement('canvas');
                this.poseCanvas.width = POSE_INPUT_SIZE;
                this.poseCanvas.height = POSE_INPUT_SIZE;
                this.poseCtx = this.poseCanvas.getContext('2d', { willReadFrequently: true });
            }
        }
        if (!this.inputBuffer) {
            this.inputBuffer = new Float32Array(3 * MODEL_INPUT_HEIGHT * MODEL_INPUT_WIDTH);
        }
        if (!this.gazeBuffer) {
            this.gazeBuffer = new Float32Array(3 * GAZE_INPUT_SIZE * GAZE_INPUT_SIZE);
        }
    }

    private async createSessionWithFallback(
        modelUrl: string,
        label: string,
        forceWasm = false
    ): Promise<{ session: ort.InferenceSession; usingWebGpu: boolean } | null> {
        const devicePreference = forceWasm ? 'cpu' : this.currentDevicePreference;
        const webGpuAvailable = devicePreference !== 'cpu' ? await isWebGpuAvailable() : false;

        if (webGpuAvailable && devicePreference !== 'cpu') {
            try {
                console.log(`[FaceDetectionEngine] Loading ${label} with WebGPU...`);
                const session = await ort.InferenceSession.create(modelUrl, {
                    executionProviders: ['webgpu'],
                });
                return { session, usingWebGpu: true };
            } catch (e) {
                console.warn(`[FaceDetectionEngine] ${label} WebGPU failed, falling back to WASM:`, e instanceof Error ? e.message : String(e));
                if (devicePreference === 'gpu' && label === 'UltraFace-640') {
                    this.loadError = 'WebGPU forced but failed. Falling back to CPU/WASM.';
                }
            }
        }

        try {
            console.log(`[FaceDetectionEngine] Loading ${label} with WASM...`);
            const session = await ort.InferenceSession.create(modelUrl, {
                executionProviders: ['wasm'],
            });
            return { session, usingWebGpu: false };
        } catch (e) {
            console.warn(`[FaceDetectionEngine] Failed to load ${label}:`, e);
            return null;
        }
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
                // Load UltraFace (core), MobileGaze (gaze), and MoveNet (pose) in parallel
                const [faceCreated, gazeCreated, poseCreated] = await Promise.all([
                    this.createSessionWithFallback(FACE_MODEL_URL, 'UltraFace-640'),
                    this.createSessionWithFallback(GAZE_MODEL_URL, 'MobileGaze-S0'),
                    this.createSessionWithFallback(POSE_MODEL_URL, 'MoveNet-Lightning'),
                ]);

                if (epoch !== this.sessionEpoch) {
                    try { await faceCreated?.session.release(); } catch {}
                    try { await gazeCreated?.session.release(); } catch {}
                    try { await poseCreated?.session.release(); } catch {}
                    return;
                }

                if (faceCreated) {
                    this.session = faceCreated.session;
                    this.usingWebGpu = faceCreated.usingWebGpu;
                }
                if (gazeCreated) {
                    this.gazeSession = gazeCreated.session;
                    this.gazeUsingWebGpu = gazeCreated.usingWebGpu;
                }
                if (poseCreated) {
                    this.poseSession = poseCreated.session;
                    this.poseUsingWebGpu = poseCreated.usingWebGpu;
                }

                this.ensureBuffers();
                console.log(
                    `[FaceDetectionEngine] Ready | Face: ${this.session ? (this.usingWebGpu ? 'WebGPU' : 'WASM') : 'off'} | ` +
                    `Gaze: ${this.gazeSession ? (this.gazeUsingWebGpu ? 'WebGPU' : 'WASM') : 'off'} | ` +
                    `Pose: ${this.poseSession ? (this.poseUsingWebGpu ? 'WebGPU' : 'WASM') : 'off'}`
                );
            } catch (e) {
                if (epoch === this.sessionEpoch) {
                    const msg = e instanceof Error ? e.message : String(e);
                    console.error('[FaceDetectionEngine] Initialization failed:', msg);
                    this.loadError = msg;
                    this.session = null;
                    this.gazeSession = null;
                    this.poseSession = null;
                    this.usingWebGpu = false;
                    this.gazeUsingWebGpu = false;
                    this.poseUsingWebGpu = false;
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

        const sFace = this.session;
        const sGaze = this.gazeSession;
        const sPose = this.poseSession;

        this.session = null;
        this.gazeSession = null;
        this.poseSession = null;
        this.loading = null;
        this.usingWebGpu = false;
        this.gazeUsingWebGpu = false;
        this.poseUsingWebGpu = false;

        if (sFace) { try { await sFace.release(); } catch {} }
        if (sGaze) { try { await sGaze.release(); } catch {} }
        if (sPose) { try { await sPose.release(); } catch {} }
    }

    async unload(): Promise<void> {
        this.clearIdleTimer();
        this.stopMonitoring(false);
        await this.unloadSession();

        this.loadError = null;
        this.canvas = null;
        this.ctx = null;
        this.inputBuffer = null;
        this.gazeCanvas = null;
        this.gazeCtx = null;
        this.gazeBuffer = null;
        this.poseCanvas = null;
        this.poseCtx = null;
        this.previousBox = null;
        this.previousLumaSample = null;
        this.ambientLumaBaseline = null;
        this.accumulatedMotion = 0;
        this.lastMotionDelta = 0;
        this.eyesClosedStartTime = null;
        this.loomingFreezeStartTime = null;
        this.gazeAwayStartTime = null;
        this.wristStretchStartTime = null;
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

    private extractBoxesTensor(results: ort.InferenceSession.OnnxValueMapType): ort.Tensor | null {
        if (results.boxes) return results.boxes;
        for (const tensor of Object.values(results)) {
            if (tensor && tensor.dims.length === 3 && tensor.dims[2] === 4) {
                return tensor;
            }
        }
        return null;
    }

    /** Returns current accumulated visual motion (0.0 to 5.0) */
    getAccumulatedMotion(): number {
        return this.accumulatedMotion;
    }

    /** Clears motion energy and resets pending shutter timers once an AI responds */
    resetAccumulatedMotion(): void {
        this.accumulatedMotion = 0;
        this.lastMotionDelta = 0;
        this.previousBox = null;
        this.previousLumaSample = null;
        this.eyesClosedStartTime = null;
        this.loomingFreezeStartTime = null;
        this.gazeAwayStartTime = null;
        this.wristStretchStartTime = null;
    }

    /**
     * Measures contrast variance in the eye strip of the detected face.
     * Open eyes have high contrast (pupil/iris vs sclera); closed eyelids are flat skin folds.
     */
    private evaluateEyeClosure(
        imageData: Uint8ClampedArray,
        x1: number,
        y1: number,
        x2: number,
        y2: number
    ): boolean {
        const fw = x2 - x1;
        const fh = y2 - y1;
        if (fw < 40 || fh < 40) return false;

        const ey1 = Math.max(0, Math.min(MODEL_INPUT_HEIGHT - 1, Math.floor(y1 + fh * 0.28)));
        const ey2 = Math.max(0, Math.min(MODEL_INPUT_HEIGHT - 1, Math.floor(y1 + fh * 0.48)));
        const ex1 = Math.max(0, Math.min(MODEL_INPUT_WIDTH - 1, Math.floor(x1 + fw * 0.18)));
        const ex2 = Math.max(0, Math.min(MODEL_INPUT_WIDTH - 1, Math.floor(x1 + fw * 0.82)));

        let sampleCount = 0;
        let sumLuma = 0;
        let sumLumaSq = 0;

        for (let y = ey1; y < ey2; y += 2) {
            const rowOffset = y * MODEL_INPUT_WIDTH * 4;
            for (let x = ex1; x < ex2; x += 2) {
                const idx = rowOffset + x * 4;
                const luma = (0.299 * imageData[idx] + 0.587 * imageData[idx + 1] + 0.114 * imageData[idx + 2]) / 255;
                sumLuma += luma;
                sumLumaSq += luma * luma;
                sampleCount++;
            }
        }

        if (sampleCount === 0) return false;

        const mean = sumLuma / sampleCount;
        const variance = (sumLumaSq / sampleCount) - (mean * mean);
        const stdDev = Math.sqrt(Math.max(0, variance));

        return stdDev < 0.075;
    }

    /**
     * Detects when an object enters the central optical field and holds still (Show-and-Tell).
     */
    private evaluateLoomingFreeze(
        currentLuma: Float32Array,
        now: number
    ): void {
        const sampleCount = currentLuma.length;
        if (!this.ambientLumaBaseline || this.ambientLumaBaseline.length !== sampleCount) {
            this.ambientLumaBaseline = new Float32Array(currentLuma);
            return;
        }

        const cols = Math.floor(MODEL_INPUT_WIDTH / 32);
        const rows = Math.floor(sampleCount / cols);

        let centerDiffSum = 0;
        let centerMotionSum = 0;
        let centerSampleCount = 0;

        for (let r = Math.floor(rows * 0.25); r < Math.floor(rows * 0.85); r++) {
            for (let c = Math.floor(cols * 0.25); c < Math.floor(cols * 0.75); c++) {
                const idx = r * cols + c;
                if (idx < sampleCount) {
                    const luma = currentLuma[idx];
                    const baseline = this.ambientLumaBaseline[idx];
                    const prev = this.previousLumaSample ? this.previousLumaSample[idx] : luma;

                    centerDiffSum += Math.abs(luma - baseline);
                    centerMotionSum += Math.abs(luma - prev);
                    centerSampleCount++;
                }
            }
        }

        if (centerSampleCount === 0) return;

        const meanCenterDiff = centerDiffSum / centerSampleCount;
        const meanCenterMotion = centerMotionSum / centerSampleCount;

        const isCenterOccupied = meanCenterDiff > 0.11;
        const isItemFrozen = meanCenterMotion < 0.022;

        if (isCenterOccupied && isItemFrozen) {
            if (this.loomingFreezeStartTime === null) {
                this.loomingFreezeStartTime = now;
            } else if (now - this.loomingFreezeStartTime >= LOOMING_FREEZE_HOLD_MS) {
                if (now - this.lastLoomingFreezeTriggerAt > LOOMING_FREEZE_COOLDOWN_MS) {
                    this.lastLoomingFreezeTriggerAt = now;
                    console.log('[FaceDetectionEngine] 📸 Looming Freeze Shutter Triggered (Show-and-Tell)');
                    this.onVisualShutter?.('looming_freeze');
                }
                this.loomingFreezeStartTime = null;
            }
        } else {
            this.loomingFreezeStartTime = null;
            if (meanCenterDiff < 0.04) {
                for (let i = 0; i < sampleCount; i++) {
                    this.ambientLumaBaseline[i] = (this.ambientLumaBaseline[i] * 0.95) + (currentLuma[i] * 0.05);
                }
            }
        }
    }

    private decodeGazeAngleDeg(logits: Float32Array): number {
        const bins = logits.length; // 90 bins for Gaze360
        let maxLogit = -Infinity;
        for (let i = 0; i < bins; i++) {
            if (logits[i] > maxLogit) maxLogit = logits[i];
        }
        let sumExp = 0;
        let weightedSum = 0;
        for (let i = 0; i < bins; i++) {
            const e = Math.exp(logits[i] - maxLogit);
            sumExp += e;
            weightedSum += e * i;
        }
        const expectedBin = sumExp > 0 ? weightedSum / sumExp : bins / 2;
        return expectedBin * 4 - 180;
    }

    /**
     * Runs MobileGaze (MIT) on the cropped face region to detect sustained gaze aversion
     * (e.g., looking down at phone or staring away from monitor > 8s).
     */
    private async evaluateGazeAway(
        video: HTMLVideoElement,
        faceBoxPixels: [number, number, number, number],
        runEpoch: number,
        now: number
    ): Promise<void> {
        const gazeSession = this.gazeSession;
        if (!gazeSession || !this.gazeCtx || !this.gazeBuffer) return;

        const [px1, py1, px2, py2] = faceBoxPixels;
        const padX = (px2 - px1) * 0.1;
        const padY = (py2 - py1) * 0.1;

        const sx = Math.max(0, ((px1 - padX) / MODEL_INPUT_WIDTH) * video.videoWidth);
        const sy = Math.max(0, ((py1 - padY) / MODEL_INPUT_HEIGHT) * video.videoHeight);
        const ex = Math.min(video.videoWidth, ((px2 + padX) / MODEL_INPUT_WIDTH) * video.videoWidth);
        const ey = Math.min(video.videoHeight, ((py2 + padY) / MODEL_INPUT_HEIGHT) * video.videoHeight);
        const sw = Math.max(1, ex - sx);
        const sh = Math.max(1, ey - sy);

        let inputTensor: ort.Tensor | null = null;
        let results: ort.InferenceSession.OnnxValueMapType | null = null;

        try {
            this.gazeCtx.drawImage(video, sx, sy, sw, sh, 0, 0, GAZE_INPUT_SIZE, GAZE_INPUT_SIZE);
            const data = this.gazeCtx.getImageData(0, 0, GAZE_INPUT_SIZE, GAZE_INPUT_SIZE).data;
            const planeSize = GAZE_INPUT_SIZE * GAZE_INPUT_SIZE;
            const buf = this.gazeBuffer;

            for (let i = 0; i < planeSize; i++) {
                const rgbaIdx = i * 4;
                buf[i] = ((data[rgbaIdx] / 255) - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
                buf[planeSize + i] = ((data[rgbaIdx + 1] / 255) - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
                buf[planeSize * 2 + i] = ((data[rgbaIdx + 2] / 255) - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
            }

            const inputName = gazeSession.inputNames[0] || 'input';
            inputTensor = new ort.Tensor('float32', buf, [1, 3, GAZE_INPUT_SIZE, GAZE_INPUT_SIZE]);
            results = await gazeSession.run({ [inputName]: inputTensor });

            if (runEpoch !== this.sessionEpoch) return;

            const outNames = gazeSession.outputNames;
            const yawTensor = results.yaw ?? results[outNames[0]];
            const pitchTensor = results.pitch ?? results[outNames[1]];
            if (!yawTensor || !pitchTensor) return;

            const yawDeg = this.decodeGazeAngleDeg(yawTensor.data as Float32Array);
            const pitchDeg = this.decodeGazeAngleDeg(pitchTensor.data as Float32Array);

            const isLookingAway =
                Math.abs(yawDeg) > GAZE_YAW_THRESHOLD_DEG ||
                Math.abs(pitchDeg) > GAZE_PITCH_THRESHOLD_DEG;

            if (isLookingAway) {
                if (this.gazeAwayStartTime === null) {
                    this.gazeAwayStartTime = now;
                } else if (now - this.gazeAwayStartTime >= GAZE_AWAY_SUSTAINED_MS) {
                    if (now - this.lastGazeAwayTriggerAt > GAZE_AWAY_COOLDOWN_MS) {
                        this.lastGazeAwayTriggerAt = now;
                        console.log(`[FaceDetectionEngine] 📸 Gaze Lock-Away Shutter Triggered (yaw=${yawDeg.toFixed(1)}°, pitch=${pitchDeg.toFixed(1)}°)`);
                        this.onVisualShutter?.('gaze_away');
                    }
                    this.gazeAwayStartTime = null;
                }
            } else {
                this.gazeAwayStartTime = null;
            }
        } catch (e) {
            console.warn('[FaceDetectionEngine] Gaze inference failed:', e);
            if (this.gazeUsingWebGpu && runEpoch === this.sessionEpoch) {
                console.warn('[FaceDetectionEngine] Falling back MobileGaze to WASM.');
                this.gazeUsingWebGpu = false;
                try { await gazeSession.release(); } catch {}
                if (runEpoch === this.sessionEpoch) {
                    const fallback = await this.createSessionWithFallback(GAZE_MODEL_URL, 'MobileGaze-S0', true);
                    if (runEpoch === this.sessionEpoch) {
                        this.gazeSession = fallback?.session ?? null;
                    }
                }
            }
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
    }

    /**
     * Runs MoveNet SinglePose Lightning (Apache-2.0) to detect when both wrists rise above
     * head/nose plane (upper-body arm stretch apex).
     */
    private async evaluateWristStretch(
        video: HTMLVideoElement,
        runEpoch: number,
        now: number
    ): Promise<void> {
        const poseSession = this.poseSession;
        if (!poseSession || !this.poseCtx) return;

        let inputTensor: ort.Tensor | null = null;
        let results: ort.InferenceSession.OnnxValueMapType | null = null;

        try {
            this.poseCtx.drawImage(video, 0, 0, POSE_INPUT_SIZE, POSE_INPUT_SIZE);
            const data = this.poseCtx.getImageData(0, 0, POSE_INPUT_SIZE, POSE_INPUT_SIZE).data;
            const planeSize = POSE_INPUT_SIZE * POSE_INPUT_SIZE;

            const meta = (poseSession as any).inputMetadata?.[0];
            const inputType: string = meta?.type || 'int32';
            const rawShape: number[] = Array.isArray(meta?.shape) && meta.shape.length === 4
                ? meta.shape
                : [1, POSE_INPUT_SIZE, POSE_INPUT_SIZE, 3];
            const isNchw = rawShape[1] === 3;
            const shape = isNchw
                ? [1, 3, POSE_INPUT_SIZE, POSE_INPUT_SIZE]
                : [1, POSE_INPUT_SIZE, POSE_INPUT_SIZE, 3];

            if (inputType === 'int32') {
                const buf = new Int32Array(3 * planeSize);
                if (isNchw) {
                    for (let i = 0; i < planeSize; i++) {
                        const rgbaIdx = i * 4;
                        buf[i] = data[rgbaIdx];
                        buf[planeSize + i] = data[rgbaIdx + 1];
                        buf[planeSize * 2 + i] = data[rgbaIdx + 2];
                    }
                } else {
                    for (let i = 0; i < planeSize; i++) {
                        const rgbaIdx = i * 4;
                        const dst = i * 3;
                        buf[dst] = data[rgbaIdx];
                        buf[dst + 1] = data[rgbaIdx + 1];
                        buf[dst + 2] = data[rgbaIdx + 2];
                    }
                }
                inputTensor = new ort.Tensor('int32', buf, shape);
            } else if (inputType === 'uint8') {
                const buf = new Uint8Array(3 * planeSize);
                if (isNchw) {
                    for (let i = 0; i < planeSize; i++) {
                        const rgbaIdx = i * 4;
                        buf[i] = data[rgbaIdx];
                        buf[planeSize + i] = data[rgbaIdx + 1];
                        buf[planeSize * 2 + i] = data[rgbaIdx + 2];
                    }
                } else {
                    for (let i = 0; i < planeSize; i++) {
                        const rgbaIdx = i * 4;
                        const dst = i * 3;
                        buf[dst] = data[rgbaIdx];
                        buf[dst + 1] = data[rgbaIdx + 1];
                        buf[dst + 2] = data[rgbaIdx + 2];
                    }
                }
                inputTensor = new ort.Tensor('uint8', buf, shape);
            } else {
                const buf = new Float32Array(3 * planeSize);
                if (isNchw) {
                    for (let i = 0; i < planeSize; i++) {
                        const rgbaIdx = i * 4;
                        buf[i] = data[rgbaIdx] / 255;
                        buf[planeSize + i] = data[rgbaIdx + 1] / 255;
                        buf[planeSize * 2 + i] = data[rgbaIdx + 2] / 255;
                    }
                } else {
                    for (let i = 0; i < planeSize; i++) {
                        const rgbaIdx = i * 4;
                        const dst = i * 3;
                        buf[dst] = data[rgbaIdx];
                        buf[dst + 1] = data[rgbaIdx + 1];
                        buf[dst + 2] = data[rgbaIdx + 2];
                    }
                }
                inputTensor = new ort.Tensor('float32', buf, shape);
            }

            const inputName = poseSession.inputNames[0] || 'input';
            results = await poseSession.run({ [inputName]: inputTensor });

            if (runEpoch !== this.sessionEpoch) return;

            const outputName = poseSession.outputNames[0] || 'output_0';
            const outTensor = results[outputName] ?? Object.values(results)[0];
            if (!outTensor) return;

            const kps = outTensor.data as Float32Array;
            if (kps.length < 51) return; // [1, 1, 17, 3]

            // COCO indices: 0=nose, 5=left_shoulder, 6=right_shoulder, 9=left_wrist, 10=right_wrist
            const noseY = kps[0];
            const noseScore = kps[2];
            const lShoulderY = kps[5 * 3];
            const lShoulderScore = kps[5 * 3 + 2];
            const rShoulderY = kps[6 * 3];
            const rShoulderScore = kps[6 * 3 + 2];
            const lWristY = kps[9 * 3];
            const lWristScore = kps[9 * 3 + 2];
            const rWristY = kps[10 * 3];
            const rWristScore = kps[10 * 3 + 2];

            const wristsVisible = lWristScore > 0.30 && rWristScore > 0.30;
            const hasAnchor = noseScore > 0.30 || (lShoulderScore > 0.30 && rShoulderScore > 0.30);

            if (wristsVisible && hasAnchor) {
                const anchorY = noseScore > 0.30
                    ? noseY
                    : ((lShoulderY + rShoulderY) / 2) - 0.12;

                const isStretchingUp = lWristY < anchorY && rWristY < anchorY;

                if (isStretchingUp) {
                    if (this.wristStretchStartTime === null) {
                        this.wristStretchStartTime = now;
                    } else if (now - this.wristStretchStartTime >= WRIST_STRETCH_HOLD_MS) {
                        if (now - this.lastWristStretchTriggerAt > WRIST_STRETCH_COOLDOWN_MS) {
                            this.lastWristStretchTriggerAt = now;
                            console.log('[FaceDetectionEngine] 📸 Wrist Apex Stretch Shutter Triggered');
                            this.onVisualShutter?.('wrist_stretch');
                        }
                        this.wristStretchStartTime = null;
                    }
                } else {
                    this.wristStretchStartTime = null;
                }
            } else {
                this.wristStretchStartTime = null;
            }
        } catch (e) {
            console.warn('[FaceDetectionEngine] Pose inference failed:', e);
            if (this.poseUsingWebGpu && runEpoch === this.sessionEpoch) {
                console.warn('[FaceDetectionEngine] Falling back MoveNet to WASM.');
                this.poseUsingWebGpu = false;
                try { await poseSession.release(); } catch {}
                if (runEpoch === this.sessionEpoch) {
                    const fallback = await this.createSessionWithFallback(POSE_MODEL_URL, 'MoveNet-Lightning', true);
                    if (runEpoch === this.sessionEpoch) {
                        this.poseSession = fallback?.session ?? null;
                    }
                }
            }
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
    }

    /**
     * Runs face detection, head motion, full-frame scene diff, eye-closure,
     * looming freeze, gaze aversion, and wrist stretch detection on a video frame.
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

                if (runEpoch !== this.sessionEpoch) return -1;

                const scoresTensor = this.extractScoresTensor(results);
                const boxesTensor = this.extractBoxesTensor(results);
                if (!scoresTensor) return -1;

                const scoresData = scoresTensor.data as Float32Array;
                let maxFaceProb = 0;
                let bestAnchorIdx = -1;

                for (let i = 1; i < scoresData.length; i += 2) {
                    const prob = scoresData[i];
                    if (prob > maxFaceProb) {
                        maxFaceProb = prob;
                        bestAnchorIdx = Math.floor(i / 2);
                    }
                }

                // ─── 1. FULL-FRAME VISUAL SCENE DELTA ───
                const stridePixels = 32;
                const sampleCount = Math.floor(planeSize / stridePixels);
                const currentLuma = new Float32Array(sampleCount);
                let lumaDiffSum = 0;

                for (let s = 0; s < sampleCount; s++) {
                    const rgbaIdx = s * stridePixels * 4;
                    const luma = (0.299 * imageData[rgbaIdx] + 0.587 * imageData[rgbaIdx + 1] + 0.114 * imageData[rgbaIdx + 2]) / 255;
                    currentLuma[s] = luma;
                    if (this.previousLumaSample && this.previousLumaSample.length === sampleCount) {
                        lumaDiffSum += Math.abs(luma - this.previousLumaSample[s]);
                    }
                }

                let sceneDelta = 0;
                if (this.previousLumaSample && this.previousLumaSample.length === sampleCount) {
                    const meanLumaDiff = lumaDiffSum / sampleCount;
                    sceneDelta = meanLumaDiff > 0.035 ? (meanLumaDiff - 0.035) * 6.0 : 0;
                }

                // ─── 2. HEAD MOTION & CENTROID ACCUMULATOR ───
                let faceMotionDelta = 0;
                let faceBoxPixels: [number, number, number, number] | null = null;

                if (maxFaceProb >= this.probabilityThreshold && boxesTensor && bestAnchorIdx >= 0) {
                    const boxesData = boxesTensor.data as Float32Array;
                    const bIdx = bestAnchorIdx * 4;
                    const px1 = Math.max(0, Math.min(1, boxesData[bIdx])) * MODEL_INPUT_WIDTH;
                    const py1 = Math.max(0, Math.min(1, boxesData[bIdx + 1])) * MODEL_INPUT_HEIGHT;
                    const px2 = Math.max(0, Math.min(1, boxesData[bIdx + 2])) * MODEL_INPUT_WIDTH;
                    const py2 = Math.max(0, Math.min(1, boxesData[bIdx + 3])) * MODEL_INPUT_HEIGHT;

                    faceBoxPixels = [px1, py1, px2, py2];

                    const cx = (px1 + px2) / 2;
                    const cy = (py1 + py2) / 2;
                    const area = Math.max(0, (px2 - px1) * (py2 - py1));

                    if (this.previousBox) {
                        const dx = (cx - this.previousBox.cx) / MODEL_INPUT_WIDTH;
                        const dy = (cy - this.previousBox.cy) / MODEL_INPUT_HEIGHT;
                        const dArea = Math.abs(area - this.previousBox.area) / (MODEL_INPUT_WIDTH * MODEL_INPUT_HEIGHT);
                        const dist = Math.sqrt(dx * dx + dy * dy);

                        const rawMotion = dist * 2.5 + dArea * 4.0;
                        faceMotionDelta = rawMotion > 0.02 ? rawMotion : 0;
                    }
                    this.previousBox = { cx, cy, area };
                } else {
                    this.previousBox = null;
                }

                const combinedMotionDelta = Math.max(faceMotionDelta, sceneDelta);
                if (combinedMotionDelta > 0) {
                    this.lastMotionDelta = combinedMotionDelta;
                    this.accumulatedMotion = Math.min(5.0, (this.accumulatedMotion * 0.82) + combinedMotionDelta);
                } else {
                    this.lastMotionDelta = 0;
                    this.accumulatedMotion *= (maxFaceProb >= this.probabilityThreshold ? 0.82 : 0.70);
                }

                const now = Date.now();

                // ─── 3. DOZING OFF SHUTTER (EYE CLOSURE) ───
                if (maxFaceProb >= this.probabilityThreshold && faceBoxPixels && faceMotionDelta < 0.03) {
                    const isEyesClosed = this.evaluateEyeClosure(
                        imageData,
                        faceBoxPixels[0],
                        faceBoxPixels[1],
                        faceBoxPixels[2],
                        faceBoxPixels[3]
                    );

                    if (isEyesClosed) {
                        if (this.eyesClosedStartTime === null) {
                            this.eyesClosedStartTime = now;
                        } else if (now - this.eyesClosedStartTime >= DOZING_OFF_SUSTAINED_MS) {
                            if (now - this.lastDozingOffTriggerAt > DOZING_OFF_COOLDOWN_MS) {
                                this.lastDozingOffTriggerAt = now;
                                console.log('[FaceDetectionEngine] 📸 Dozing Off Shutter Triggered (Eyes Shut > 1.5s)');
                                this.onVisualShutter?.('dozing_off');
                            }
                            this.eyesClosedStartTime = null;
                        }
                    } else {
                        this.eyesClosedStartTime = null;
                    }
                } else {
                    this.eyesClosedStartTime = null;
                }

                // ─── 4. LOOMING FREEZE SHUTTER (SHOW-AND-TELL) ───
                this.evaluateLoomingFreeze(currentLuma, now);

                // ─── 5. GAZE LOCK-AWAY SHUTTER (PHONE / DISTRACTION) ───
                if (maxFaceProb >= this.probabilityThreshold && faceBoxPixels && faceMotionDelta < 0.04) {
                    await this.evaluateGazeAway(video, faceBoxPixels, runEpoch, now);
                } else {
                    this.gazeAwayStartTime = null;
                }

                // ─── 6. WRIST APEX STRETCH SHUTTER (UPPER-BODY POSE) ───
                if (runEpoch === this.sessionEpoch) {
                    await this.evaluateWristStretch(video, runEpoch, now);
                }

                this.previousLumaSample = currentLuma;
                return maxFaceProb;
            } catch (e) {
                console.warn('[FaceDetectionEngine] Inference failed:', e);
                if (this.usingWebGpu && runEpoch === this.sessionEpoch) {
                    console.warn('[FaceDetectionEngine] Falling back UltraFace to WASM after WebGPU runtime failure.');
                    this.currentDevicePreference = 'cpu';
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
        this.onMotionSpike = options.onMotionSpike ?? null;
        this.onVisualShutter = options.onVisualShutter ?? null;
        this.intervalMs = clampInterval(options.intervalMs);
        this.lastDetectedStatus = null;
        this.accumulatedMotion = 0;
        this.lastMotionDelta = 0;
        this.previousBox = null;
        this.previousLumaSample = null;
        this.ambientLumaBaseline = null;
        this.eyesClosedStartTime = null;
        this.loomingFreezeStartTime = null;
        this.gazeAwayStartTime = null;
        this.wristStretchStartTime = null;

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
        options: Partial<Pick<FaceDetectionMonitorOptions, 'intervalMs' | 'devicePreference' | 'getVideoElement' | 'onPresenceChange' | 'onMotionSpike' | 'onVisualShutter'>>
    ): void {
        if (options.getVideoElement) this.getVideoElement = options.getVideoElement;
        if (options.onPresenceChange) this.onPresenceChange = options.onPresenceChange;
        if (options.onMotionSpike !== undefined) this.onMotionSpike = options.onMotionSpike ?? null;
        if (options.onVisualShutter !== undefined) this.onVisualShutter = options.onVisualShutter ?? null;
        if (options.devicePreference !== undefined) this.setDevicePreference(options.devicePreference);
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
        this.onMotionSpike = null;
        this.onVisualShutter = null;
        this.lastDetectedStatus = null;
        this.accumulatedMotion = 0;
        this.lastMotionDelta = 0;
        this.previousBox = null;
        this.previousLumaSample = null;
        this.ambientLumaBaseline = null;
        this.eyesClosedStartTime = null;
        this.loomingFreezeStartTime = null;
        this.gazeAwayStartTime = null;
        this.wristStretchStartTime = null;
        this.setStatus('idle');

        if (scheduleIdleUnload && this.session) {
            this.resetIdleTimer();
        }
    }

    resetBaseline(): void {
        this.lastDetectedStatus = null;
        this.accumulatedMotion = 0;
        this.lastMotionDelta = 0;
        this.previousBox = null;
        this.previousLumaSample = null;
        this.ambientLumaBaseline = null;
        this.eyesClosedStartTime = null;
        this.loomingFreezeStartTime = null;
        this.gazeAwayStartTime = null;
        this.wristStretchStartTime = null;
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
                        this.lastDetectedStatus = isDetected;
                    } else if (isDetected !== this.lastDetectedStatus) {
                        this.lastDetectedStatus = isDetected;
                        this.onPresenceChange?.(isDetected, maxFaceProb);
                    }

                    if (this.lastMotionDelta > 0 && this.accumulatedMotion > 0.1) {
                        this.onMotionSpike?.(this.accumulatedMotion);
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