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
 * Known model architecture parameters for VRAM estimation.
 * Based on oobabooga's empirical formula derived from 19,517 real VRAM measurements.
 * Source: https://oobabooga.github.io/blog/posts/gguf-vram-formula/
 */
interface ModelArch {
    layers: number;
    kvHeads: number;
    embeddingDim: number;
}

const MODEL_ARCHITECTURES: Record<string, ModelArch> = {
    '0.5b': { layers: 24, kvHeads: 8, embeddingDim: 896 },
    '0.6b': { layers: 28, kvHeads: 8, embeddingDim: 1024 },
    '1b': { layers: 16, kvHeads: 8, embeddingDim: 2048 },
    '1.5b': { layers: 28, kvHeads: 4, embeddingDim: 1536 },
    '1.7b': { layers: 24, kvHeads: 8, embeddingDim: 2048 },
    '2b': { layers: 24, kvHeads: 8, embeddingDim: 1536 },
    '3b': { layers: 28, kvHeads: 8, embeddingDim: 3072 },
    '4b': { layers: 36, kvHeads: 8, embeddingDim: 2560 },
    '7b': { layers: 32, kvHeads: 32, embeddingDim: 4096 },
    '7bx': { layers: 32, kvHeads: 8, embeddingDim: 4096 }, // Mistral 7B GQA
    '8b': { layers: 32, kvHeads: 8, embeddingDim: 4096 },
    '9b': { layers: 32, kvHeads: 8, embeddingDim: 4096 },
    '12b': { layers: 40, kvHeads: 8, embeddingDim: 4096 },
    '13b': { layers: 40, kvHeads: 40, embeddingDim: 5120 },
    '14b': { layers: 40, kvHeads: 8, embeddingDim: 5120 },
    '17b': { layers: 48, kvHeads: 8, embeddingDim: 4096 },
    '24b': { layers: 48, kvHeads: 8, embeddingDim: 4096 },
    '30b': { layers: 60, kvHeads: 52, embeddingDim: 8192 },
    '32b': { layers: 64, kvHeads: 8, embeddingDim: 5120 },
    '34b': { layers: 48, kvHeads: 64, embeddingDim: 8192 },
    '35b': { layers: 64, kvHeads: 8, embeddingDim: 5120 },
    '40b': { layers: 60, kvHeads: 8, embeddingDim: 8192 },
    '65b': { layers: 80, kvHeads: 64, embeddingDim: 8192 },
    '70b': { layers: 80, kvHeads: 8, embeddingDim: 8192 },
    '72b': { layers: 80, kvHeads: 8, embeddingDim: 8192 },
};

/**
 * Maps cache type string to numeric value used in oobabooga's formula.
 * fp16=16, q8_0=8, q4_0=4
 * Source: https://oobabooga.github.io/blog/posts/gguf-vram-formula/
 */
function cacheTypeToNumeric(cacheType: string): number {
    const lower = cacheType.toLowerCase();
    switch (lower) {
        case 'f32': case 'fp32': return 32;
        case 'f16': case 'fp16': case 'bf16': return 16;
        case 'fp8': case 'e4m3': case 'e5m2': return 8;
        case 'q8_0': case 'q8': return 8;
        case 'q6_k': case 'q6': return 8; // Closest to q8 in practice
        case 'q5_k': case 'q5_0': case 'q5_1': case 'q5': return 8;
        case 'q4_k': case 'q4_0': case 'q4_1': case 'q4': case 'q4_nl': return 4;
        case 'q3_k': case 'q3': return 4;
        case 'q2_k': case 'q2': return 4;
        case 'iq4_s': case 'iq4_m': case 'iq4_xs': return 4;
        case 'iq3_s': case 'iq3_m': case 'iq3_xs': return 4;
        case 'iq2_s': case 'iq2_m': case 'iq2_xs': return 4;
        case 'iq1_s': case 'iq1_m': return 4;
        default: return 16;
    }
}

/**
 * Quantization size multipliers relative to FP16 (2 bytes per parameter).
 * Used to estimate GGUF file size from parameter count.
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
};

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

function getModelArchitecture(modelName: string, paramCount: number): ModelArch {
    const lower = modelName.toLowerCase();

    const sortedKeys = Object.keys(MODEL_ARCHITECTURES).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
        if (lower.includes(key)) {
            return MODEL_ARCHITECTURES[key];
        }
    }

    // Fallback estimation
    let layers: number;
    let kvHeads: number;
    let embeddingDim: number;

    if (paramCount <= 2) {
        layers = Math.round(paramCount * 24);
        kvHeads = 8;
        embeddingDim = 1536;
    } else if (paramCount <= 8) {
        layers = 32;
        kvHeads = 8;
        embeddingDim = 4096;
    } else if (paramCount <= 15) {
        layers = 40;
        kvHeads = 8;
        embeddingDim = 5120;
    } else if (paramCount <= 35) {
        layers = Math.round(paramCount * 2);
        kvHeads = 8;
        embeddingDim = 5120;
    } else if (paramCount <= 75) {
        layers = 80;
        kvHeads = 8;
        embeddingDim = 8192;
    } else {
        layers = Math.round(paramCount * 0.31);
        kvHeads = 16;
        embeddingDim = 8192;
    }

    return { layers, kvHeads, embeddingDim };
}

/**
 * Estimates GGUF file size in MB from parameter count and quantization.
 */
function estimateGGUFSizeMB(paramCount: number, quantization: string): number {
    const multiplier = QUANTIZATION_MULTIPLIERS[quantization] || 0.25;
    // FP16 = 2 bytes/param, convert to MB
    const sizeMB = (paramCount * 1e9 * 2 * multiplier) / (1024 * 1024);
    return sizeMB;
}

/**
 * Empirically-derived VRAM formula from oobabooga's research.
 * Based on 19,517 real VRAM measurements across 60+ model quants.
 * Median absolute error: 365 MiB.
 * 
 * Formula:
 *   vram_MiB = (
 *     (size_per_layer - 17.996 + 3.149e-05 * kv_cache_factor)
 *     * (gpu_layers + max(0.969, cache_type - (floor(50.778 * embedding_per_context) + 9.988)))
 *     + 1516.523
 *   )
 * 
 * Where:
 *   size_per_layer = size_in_mb / n_layers
 *   kv_cache_factor = n_kv_heads * cache_type * ctx_size
 *   embedding_per_context = embedding_dim / ctx_size
 *   cache_type: fp16=16, q8_0=8, q4_0=4
 * 
 * Source: https://oobabooga.github.io/blog/posts/gguf-vram-formula/
 */
const calculateVRAM = (
    modelName: string,
    gpuLayers: number,
    keyCacheType: string,
    valueCacheType: string,
    contextSize: number
): string => {
    const sizeMatch = modelName.match(/(\d+\.?\d*)\s*[Bb]/);
    if (!sizeMatch) return 'Unknown';

    const paramCount = Number.parseFloat(sizeMatch[1]);
    const arch = getModelArchitecture(modelName, paramCount);
    const quantization = detectQuantization(modelName);
    const sizeInMB = estimateGGUFSizeMB(paramCount, quantization);

    // Use average of key and value cache types for the formula's single cache_type parameter
    const keyCacheNum = cacheTypeToNumeric(keyCacheType);
    const valueCacheNum = cacheTypeToNumeric(valueCacheType);
    const cacheType = (keyCacheNum + valueCacheNum) / 2;

    const sizePerLayer = sizeInMB / arch.layers;
    const kvCacheFactor = arch.kvHeads * cacheType * contextSize;
    const embeddingPerContext = arch.embeddingDim / contextSize;

    // Oobabooga's empirical formula (all constants from symbolic regression)
    const effectiveGpuLayers = gpuLayers === -1 ? arch.layers : Math.min(Math.max(gpuLayers, 0), arch.layers);

    const vramMiB = (
        (sizePerLayer - 17.99552795246051 + 3.148552680382576e-05 * kvCacheFactor)
        * (effectiveGpuLayers + Math.max(0.9690636483914102, cacheType - (Math.floor(50.77817218646521 * embeddingPerContext) + 9.987899908205632)))
        + 1516.522943869404
    );

    // Convert MiB to GB
    const vramGB = vramMiB / 1024;

    // Clamp to reasonable minimum
    return Math.max(0.5, vramGB).toFixed(2);
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