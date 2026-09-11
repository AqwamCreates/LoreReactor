// src/hooks/modelLoadArgs.ts
import type { LanguageModel } from '../types';

/**
 * Build llama-server CLI args from a LanguageModel's parameters.
 * Shared between useModelManager (manual load) and useTextGeneration (budget strategy auto-load).
 */
export function buildModelLoadArguments(model: LanguageModel): string[] {
    const params = model.parameters || {};
    const args: string[] = ['-c', model.contextLength.toString()];

    // GPU layers
    const ngl = params.gpu_layers !== undefined ? Number(params.gpu_layers) : 99;
    args.push('-ngl', String(ngl));

    // Multi-modal projector
    if (model.mmproj) args.push('--mmproj', String(model.mmproj).trim());

    // LoRA adapter
    if (model.lora) args.push('--lora', String(model.lora).trim());

    // KV cache quantization
    if (params.cache_type_k) args.push('-ctk', String(params.cache_type_k));
    if (params.cache_type_v) args.push('-ctv', String(params.cache_type_v));

    // Split mode
    const splitMode = params.split_mode ? String(params.split_mode) : '';
    if (splitMode && splitMode !== 'layer') args.push('-sm', splitMode);

    // IK (in-context key caching)
    if (params.ik === true) args.push('-ik');

    // Speculative decoding
    const specType = params.spec_type ? String(params.spec_type) : '';
    if (specType && specType !== 'none') args.push('-st', specType);
    if (params.draft_max) args.push('-dm', String(params.draft_max));
    const draftModel = params.draft_model ? String(params.draft_model).trim() : '';
    if (draftModel) args.push('-md', draftModel);
    if (params.gpu_layers_draft !== undefined) args.push('-ngld', String(params.gpu_layers_draft));
    const deviceDraft = params.device_draft ? String(params.device_draft).trim() : '';
    if (deviceDraft) args.push('-devd', deviceDraft);

    // Parallelism & threading
    if (params.parallel && Number(params.parallel) > 1) args.push('-np', String(params.parallel));
    if (params.threads && Number(params.threads) > 0) args.push('-t', String(params.threads));
    if (params.threads_batch && Number(params.threads_batch) > 0) args.push('-tb', String(params.threads_batch));

    // Batch sizes
    if (params.batch_size && Number(params.batch_size) !== 1024) args.push('-b', String(params.batch_size));
    if (params.ubatch_size && Number(params.ubatch_size) !== 1024) args.push('-ub', String(params.ubatch_size));

    // Fit target
    const fitTarget = params.fit_target ? String(params.fit_target).trim() : '';
    if (fitTarget) args.push('-fit', fitTarget);

    // Tensor split
    const tensorSplit = params.tensor_split ? String(params.tensor_split).trim() : '';
    if (tensorSplit) args.push('-ts', tensorSplit);

    // Boolean flags
    if (params.cpu_moe === true) args.push('-cmoe');
    if (params.no_kv_offload === true) args.push('-nkvo');
    if (params.no_mmap === true) args.push('--no-mmap');
    if (params.mlock === true) args.push('--mlock');
    if (params.numa === true) args.push('--numa');

    // Extra flags (always appended last so they can override anything above)
    const extraFlags = params.extra_flags ? String(params.extra_flags).trim() : '';
    if (extraFlags) args.push(...extraFlags.split(/\s+/));

    return args;
}