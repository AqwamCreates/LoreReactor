// src/hooks/vramUseEstimation.ts
import { useState, useEffect } from 'react';

interface VRAMEstimationParams {
    modelName: string;
    gpuLayers: number;
    keyCacheType: string;
    valueCacheType: string;
    contextSize: number;
    backend: string;
}

interface VRAMEstimationResult {
    estimatedVRAM: string;
    isEstimating: boolean;
    error: string | null;
}

/**
 * Known model architecture parameters for accurate KV cache calculation.
 * KV cache (bytes) = 2 × num_layers × num_kv_heads × head_dim × context_length × dtype_bytes
 * Source: https://www.sitepoint.com/kv-cache-survival-guide-local-llms/
 */
interface ModelArch {
    layers: number;
    kvHeads: number;
    headDim: number;
}

const MODEL_ARCHITECTURES: Record<string, ModelArch> = {
    // Llama 2 family
    '7b': { layers: 32, kvHeads: 32, headDim: 128 },
    '6.7b': { layers: 32, kvHeads: 32, headDim: 128 },
    '13b': { layers: 40, kvHeads: 40, headDim: 128 },
    '30b': { layers: 60, kvHeads: 52, headDim: 128 },
    '34b': { layers: 48, kvHeads: 64, headDim: 128 },
    '65b': { layers: 80, kvHeads: 64, headDim: 128 },
    '70b': { layers: 80, kvHeads: 8, headDim: 128 },
    // Llama 3 family (GQA with fewer KV heads)
    '8b': { layers: 32, kvHeads: 8, headDim: 128 },
    '3b': { layers: 28, kvHeads: 8, headDim: 128 },
    '1b': { layers: 16, kvHeads: 8, headDim: 64 },
    '405b': { layers: 126, kvHeads: 16, headDim: 128 },
    // Mistral / Qwen family
    '7bx': { layers: 32, kvHeads: 8, headDim: 128 }, // Mistral 7B uses GQA
    '14b': { layers: 40, kvHeads: 8, headDim: 128 },
    '32b': { layers: 64, kvHeads: 8, headDim: 128 },
    '72b': { layers: 80, kvHeads: 8, headDim: 128 },
    // Small models
    '0.5b': { layers: 24, kvHeads: 8, headDim: 64 },
    '1.5b': { layers: 28, kvHeads: 4, headDim: 64 },
    '2b': { layers: 24, kvHeads: 8, headDim: 64 },
    '4b': { layers: 36, kvHeads: 8, headDim: 128 },
};

/**
 * Extracts architecture from model name by matching parameter count.
 * Falls back to estimation from parameter count if no exact match.
 */
function getModelArchitecture(modelName: string, paramCount: number): ModelArch {
    const lower = modelName.toLowerCase();

    // Try exact matches first (most specific to least)
    const sortedKeys = Object.keys(MODEL_ARCHITECTURES).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
        if (lower.includes(key)) {
            return MODEL_ARCHITECTURES[key];
        }
    }

    // Fallback: estimate from parameter count using common patterns
    // Most modern models use GQA with kvHeads = 8 and headDim = 128
    let layers: number;
    let kvHeads: number;
    const headDim = 128;

    if (paramCount <= 2) {
        layers = Math.round(paramCount * 24);
        kvHeads = 8;
    } else if (paramCount <= 8) {
        layers = Math.round(paramCount * 4.5);
        kvHeads = 8;
    } else if (paramCount <= 15) {
        layers = Math.round(paramCount * 3);
        kvHeads = 8;
    } else if (paramCount <= 35) {
        layers = Math.round(paramCount * 2);
        kvHeads = 8;
    } else if (paramCount <= 75) {
        layers = Math.round(paramCount * 1.15);
        kvHeads = 8;
    } else {
        layers = Math.round(paramCount * 0.31);
        kvHeads = 16;
    }

    return { layers, kvHeads, headDim };
}

/**
 * Returns bytes per element for a given KV cache quantization type.
 * FP16 = 2 bytes, Q8_0 ≈ 1 byte, Q4_0 ≈ 0.5 bytes.
 * Source: https://www.sitepoint.com/kv-cache-survival-guide-local-llms/
 */
function getCacheBytesPerElement(cacheType: string): number {
    const lower = cacheType.toLowerCase();
    switch (lower) {
        case 'f32':
        case 'fp32':
            return 4.0;
        case 'f16':
        case 'fp16':
        case 'bf16':
            return 2.0;
        case 'fp8':
        case 'e4m3':
        case 'e5m2':
        case 'q8_0':
        case 'q8':
            return 1.0;
        case 'q6_k':
        case 'q6':
            return 0.75;
        case 'q5_k':
        case 'q5_0':
        case 'q5_1':
        case 'q5':
            return 0.625;
        case 'q4_k':
        case 'q4_0':
        case 'q4_1':
        case 'q4':
        case 'q4_nl':
            return 0.5;
        case 'q3_k':
        case 'q3':
            return 0.375;
        case 'q2_k':
        case 'q2':
            return 0.25;
        case 'iq4_s':
        case 'iq4_m':
        case 'iq4_xs':
            return 0.5;
        case 'iq3_s':
        case 'iq3_m':
        case 'iq3_xs':
            return 0.375;
        case 'iq2_s':
        case 'iq2_m':
        case 'iq2_xs':
            return 0.25;
        case 'iq1_s':
        case 'iq1_m':
            return 0.125;
        default:
            return 2.0; // Default to FP16
    }
}

/**
 * Quantization size multipliers relative to FP16 (2 bytes per parameter).
 */
const QUANTIZATION_MULTIPLIERS: Record<string, number> = {
    'FP32': 2.0, 'F32': 2.0,
    'FP16': 1.0, 'F16': 1.0, 'BF16': 1.0,
    'Q8_0': 0.5, 'Q8_1': 0.5,
    'Q6_K': 0.375,
    'Q5_K': 0.3125, 'Q5_0': 0.3125, 'Q5_1': 0.3125,
    'Q4_K': 0.25, 'Q4_0': 0.25, 'Q4_1': 0.25,
    'Q3_K': 0.1875,
    'Q2_K': 0.125,
    'IQ1_S': 0.0625, 'IQ1_M': 0.0625,
    'IQ2_S': 0.125, 'IQ2_M': 0.125, 'IQ2_XS': 0.125,
    'IQ3_S': 0.1875, 'IQ3_M': 0.1875, 'IQ3_XS': 0.1875,
    'IQ4_S': 0.25, 'IQ4_M': 0.25, 'IQ4_XS': 0.25,
    'GGUF': 0.8,
};

/**
 * Detects quantization type from model filename.
 */
function detectQuantization(modelName: string): string {
    const patterns = [
        { pattern: /[_-]?Q4_K[_-]?/i, value: 'Q4_K' },
        { pattern: /[_-]?Q5_K[_-]?/i, value: 'Q5_K' },
        { pattern: /[_-]?Q6_K[_-]?/i, value: 'Q6_K' },
        { pattern: /[_-]?Q8_0[_-]?/i, value: 'Q8_0' },
        { pattern: /[_-]?Q4_0[_-]?/i, value: 'Q4_0' },
        { pattern: /[_-]?Q4_1[_-]?/i, value: 'Q4_1' },
        { pattern: /[_-]?Q5_0[_-]?/i, value: 'Q5_0' },
        { pattern: /[_-]?Q5_1[_-]?/i, value: 'Q5_1' },
        { pattern: /[_-]?Q2_K[_-]?/i, value: 'Q2_K' },
        { pattern: /[_-]?Q3_K[_-]?/i, value: 'Q3_K' },
        { pattern: /[_-]?IQ1_S[_-]?/i, value: 'IQ1_S' },
        { pattern: /[_-]?IQ1_M[_-]?/i, value: 'IQ1_M' },
        { pattern: /[_-]?IQ2_S[_-]?/i, value: 'IQ2_S' },
        { pattern: /[_-]?IQ2_M[_-]?/i, value: 'IQ2_M' },
        { pattern: /[_-]?IQ2_XS[_-]?/i, value: 'IQ2_XS' },
        { pattern: /[_-]?IQ3_S[_-]?/i, value: 'IQ3_S' },
        { pattern: /[_-]?IQ3_M[_-]?/i, value: 'IQ3_M' },
        { pattern: /[_-]?IQ3_XS[_-]?/i, value: 'IQ3_XS' },
        { pattern: /[_-]?IQ4_S[_-]?/i, value: 'IQ4_S' },
        { pattern: /[_-]?IQ4_M[_-]?/i, value: 'IQ4_M' },
        { pattern: /[_-]?IQ4_XS[_-]?/i, value: 'IQ4_XS' },
        { pattern: /[_-]?F16[_-]?/i, value: 'F16' },
        { pattern: /[_-]?FP16[_-]?/i, value: 'FP16' },
        { pattern: /[_-]?BF16[_-]?/i, value: 'BF16' },
        { pattern: /[_-]?FP32[_-]?/i, value: 'FP32' },
        { pattern: /[_-]?F32[_-]?/i, value: 'F32' },
    ];

    for (const { pattern, value } of patterns) {
        if (pattern.test(modelName)) return value;
    }
    return 'Unknown';
}

/**
 * Calculates VRAM usage using the accurate KV cache formula:
 * KV cache (bytes) = 2 × num_layers × num_kv_heads × head_dim × context_length × dtype_bytes
 * 
 * Key and Value caches can have different quantization types.
 * Source: https://www.sitepoint.com/kv-cache-survival-guide-local-llms/
 */
const calculateVRAM = (
    modelName: string,
    gpuLayers: number,
    keyCacheType: string,
    valueCacheType: string,
    contextSize: number
): string => {
    // Extract parameter count from model name
    const sizeMatch = modelName.match(/(\d+\.?\d*)\s*[Bb]/);
    if (!sizeMatch) return 'Unknown';

    const paramCount = Number.parseFloat(sizeMatch[1]);
    const arch = getModelArchitecture(modelName, paramCount);

    // --- Model Weights ---
    const quantization = detectQuantization(modelName);
    const quantMultiplier = QUANTIZATION_MULTIPLIERS[quantization] || 1.0;
    const bytesPerParam = 2 * quantMultiplier; // FP16 base = 2 bytes
    const totalWeightsGB = (paramCount * 1e9 * bytesPerParam) / (1024 ** 3);

    // --- KV Cache (accurate formula) ---
    // K and V are stored separately with potentially different quantization
    // KV cache bytes = num_layers × num_kv_heads × head_dim × context_length × dtype_bytes
    // The factor of 2 (K + V) is split so each can have its own dtype
    const keyBytesPerElem = getCacheBytesPerElement(keyCacheType);
    const valueBytesPerElem = getCacheBytesPerElement(valueCacheType);

    const kvPerTokenBytes = arch.layers * arch.kvHeads * arch.headDim * (keyBytesPerElem + valueBytesPerElem);
    const kvCacheGB = (kvPerTokenBytes * contextSize) / (1024 ** 3);

    // --- GPU Layer Allocation ---
    // Estimate total transformer layers from architecture
    const totalLayers = arch.layers;
    const gpuLayerRatio = gpuLayers === -1 ? 1.0 : Math.min(Math.max(gpuLayers, 0) / totalLayers, 1.0);

    // Only the GPU-resident portion of weights goes to VRAM
    const gpuWeightsGB = totalWeightsGB * gpuLayerRatio;

    // KV cache is typically fully on GPU when any layers are offloaded
    const gpuKVCacheGB = gpuLayerRatio > 0 ? kvCacheGB : 0;

    // --- CUDA/Runtime Overhead ---
    // Typical CUDA context + runtime overhead: 500MB–2GB
    // Source: https://www.sitepoint.com/kv-cache-survival-guide-local-llms/
    const cudaOverheadGB = gpuLayerRatio > 0 ? 1.0 : 0;

    // --- Activation Memory ---
    // Temporary buffers for forward pass: scales with hidden_size and batch
    // Rough estimate: ~0.1–0.3 GB for single-batch inference
    const activationGB = gpuLayerRatio > 0 ? 0.2 : 0;

    const totalVRAMGB = gpuWeightsGB + gpuKVCacheGB + cudaOverheadGB + activationGB;

    return totalVRAMGB.toFixed(2);
};

export function vramUseEstimation({
    modelName,
    gpuLayers,
    keyCacheType,
    valueCacheType,
    contextSize,
    backend,
}: VRAMEstimationParams): VRAMEstimationResult {
    const [estimatedVRAM, setEstimatedVRAM] = useState<string>('N/A');
    const [isEstimating, setIsEstimating] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const estimateVRAM = async () => {
            if (backend !== 'Llama.cpp') {
                setEstimatedVRAM('N/A');
                setIsEstimating(false);
                setError(null);
                return;
            }

            const sizeMatch = modelName.match(/(\d+\.?\d*)\s*[Bb]/);
            if (!sizeMatch) {
                setEstimatedVRAM('Unknown');
                setIsEstimating(false);
                setError(null);
                return;
            }

            setIsEstimating(true);
            setError(null);

            try {
                await new Promise(resolve => setTimeout(resolve, 50));

                const result = calculateVRAM(
                    modelName,
                    gpuLayers,
                    keyCacheType,
                    valueCacheType,
                    contextSize || 8192
                );

                setEstimatedVRAM(result);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to estimate VRAM');
                setEstimatedVRAM('Unknown');
            } finally {
                setIsEstimating(false);
            }
        };

        estimateVRAM();
    }, [modelName, gpuLayers, keyCacheType, valueCacheType, contextSize, backend]);

    return {
        estimatedVRAM,
        isEstimating,
        error,
    };
}