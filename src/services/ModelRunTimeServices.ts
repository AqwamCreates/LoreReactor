// src/services/ModelRuntimeService.ts
import type { LanguageModelData } from '../types';
import { localURL } from '../configurations';

interface ModelState {
    isRunning: boolean;
    port?: number;
}

/**
 * Pure service for model load/unload operations.
 * No React dependencies. Used by both useModelManager (UI) and BudgetStrategyEngine (inference).
 */
export class ModelRuntimeService {
    private runningModels: Record<string, ModelState> = {};

    /** Update the known running models state (called by useModelManager's polling). */
    setRunningModels(models: Record<string, ModelState>): void {
        this.runningModels = { ...models };
    }

    /** Get current running models snapshot. */
    getRunningModels(): Record<string, ModelState> {
        return { ...this.runningModels };
    }

    /** Check if a model has an active port. */
    isReady(model: LanguageModelData): boolean {
        const isCloud = !!model.apiKey && model.backend;
        if (isCloud) return true;
        const state = this.runningModels[model.id];
        return !!(state?.port || (model.parameters as Record<string, unknown>)?._runtimePort);
    }

    /** Get the runtime port for a model, or undefined if not loaded. */
    getPort(model: LanguageModelData): number | undefined {
        const isCloud = !!model.apiKey && model.backend;
        if (isCloud) return undefined;
        const state = this.runningModels[model.id];
        return state?.port || (model.parameters as Record<string, unknown>)?._runtimePort as number | undefined;
    }

    /** Request the backend to load a model. Returns port on success, null on failure. */
    async loadModel(model: LanguageModelData): Promise<number | null> {
        // Already loaded?
        const existingPort = this.getPort(model);
        if (existingPort) return existingPort;

        // Cloud models don't need loading
        if (model.apiKey && model.backend) return null;

        const modelPath = model.model || '';
        const args = buildModelLoadArgs(model);

        try {
            const res = await fetch(`${localURL}/models/load`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: model.id, modelPath, args }),
            });

            if (res.ok) {
                const data = await res.json();
                const port = data.port ?? null;
                if (port !== null) {
                    this.runningModels[model.id] = { isRunning: true, port };
                }
                return port;
            }
        } catch (e) {
            console.warn(`Failed to load model ${model.name}:`, e);
        }
        return null;
    }

    /** Request the backend to unload a model. Returns true on success. */
    async unloadModel(modelId: string): Promise<boolean> {
        try {
            const res = await fetch(`${localURL}/models/unload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: modelId }),
            });

            if (res.ok) {
                delete this.runningModels[modelId];
                return true;
            }
        } catch (e) {
            console.warn(`Failed to unload model ${modelId}:`, e);
        }
        return false;
    }
}

/** Build llama-server CLI args from a LanguageModelData's parameters. */
export function buildModelLoadArgs(model: LanguageModelData): string[] {
    const params = model.parameters || {};
    const args: string[] = ['-c', model.contextLength.toString()];

    const ngl = params.gpu_layers !== undefined ? Number(params.gpu_layers) : 99;
    args.push('-ngl', String(ngl));

    if (model.mmproj) args.push('--mmproj', String(model.mmproj).trim());
    if (model.lora) args.push('--lora', String(model.lora).trim());
    if (params.cache_type_k) args.push('-ctk', String(params.cache_type_k));
    if (params.cache_type_v) args.push('-ctv', String(params.cache_type_v));

    const splitMode = params.split_mode ? String(params.split_mode) : '';
    if (splitMode && splitMode !== 'layer') args.push('-sm', splitMode);

    if (params.ik === true) args.push('-ik');

    const specType = params.spec_type ? String(params.spec_type) : '';
    if (specType && specType !== 'none') args.push('-st', specType);
    if (params.draft_max) args.push('-dm', String(params.draft_max));
    const draftModel = params.draft_model ? String(params.draft_model).trim() : '';
    if (draftModel) args.push('-md', draftModel);
    if (params.gpu_layers_draft !== undefined) args.push('-ngld', String(params.gpu_layers_draft));
    const deviceDraft = params.device_draft ? String(params.device_draft).trim() : '';
    if (deviceDraft) args.push('-devd', deviceDraft);

    if (params.parallel && Number(params.parallel) > 1) args.push('-np', String(params.parallel));
    if (params.threads && Number(params.threads) > 0) args.push('-t', String(params.threads));
    if (params.threads_batch && Number(params.threads_batch) > 0) args.push('-tb', String(params.threads_batch));

    if (params.batch_size && Number(params.batch_size) !== 1024) args.push('-b', String(params.batch_size));
    if (params.ubatch_size && Number(params.ubatch_size) !== 1024) args.push('-ub', String(params.ubatch_size));

    const fitTarget = params.fit_target ? String(params.fit_target).trim() : '';
    if (fitTarget) args.push('-fit', fitTarget);

    const tensorSplit = params.tensor_split ? String(params.tensor_split).trim() : '';
    if (tensorSplit) args.push('-ts', tensorSplit);

    if (params.cpu_moe === true) args.push('-cmoe');
    if (params.no_kv_offload === true) args.push('-nkvo');
    if (params.no_mmap === true) args.push('--no-mmap');
    if (params.mlock === true) args.push('--mlock');
    if (params.numa === true) args.push('--numa');

    const extraFlags = params.extra_flags ? String(params.extra_flags).trim() : '';
    if (extraFlags) args.push(...extraFlags.split(/\s+/));

    return args;
}

/** Singleton instance shared across the application. */
export const modelRuntime = new ModelRuntimeService();