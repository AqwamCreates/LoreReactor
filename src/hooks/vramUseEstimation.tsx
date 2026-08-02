// src/hooks/vramUseEstimation.ts
import { useState, useEffect } from 'react';

interface VRAMEstimationParams {
    modelName: string;
    gpuLayers: number;
    cacheType: string;
    contextSize: number;
    backend: string;
}

interface VRAMEstimationResult {
    estimatedVRAM: string;
    isEstimating: boolean;
    error: string | null;
}

// Detect quantization from model name.
const detectQuantization = (modelName: string): string => {
    const quantizationPatterns = [
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
        { pattern: /[_-]?GGUF[_-]?/i, value: 'GGUF' },
    ];

    for (const { pattern, value } of quantizationPatterns) {
        if (pattern.test(modelName)) {
            return value;
        }
    }
    
    return 'Unknown';
};

// Estimate VRAM usage for llama.cpp models.
const calculateVRAM = (modelName: string, gpuLayers: number, cacheType: string, contextSize: number): string => {
    // Extract parameter count using regex - case insensitive.
    const sizeMatch = modelName.match(/(\d+\.?\d*)\s*[Bb]/);
    let parameterCount: number;
    
    if (sizeMatch) {
        parameterCount = Number.parseFloat(sizeMatch[1]);
    } else {
        return 'Unknown';
    }

    // Detect quantization from model name.
    const quantization = detectQuantization(modelName);
    
    // Quantization size multipliers (relative to FP16).
    const quantizationMultipliers: Record<string, number> = {
        'FP32': 2.0,
        'F32': 2.0,
        'FP16': 1.0,
        'F16': 1.0,
        'BF16': 1.0,
        'Q8_0': 0.5,
        'Q8_1': 0.5,
        'Q6_K': 0.375,
        'Q5_K': 0.3125,
        'Q5_0': 0.3125,
        'Q5_1': 0.3125,
        'Q4_K': 0.25,
        'Q4_0': 0.25,
        'Q4_1': 0.25,
        'Q3_K': 0.1875,
        'Q2_K': 0.125,
        'IQ1_S': 0.0625,
        'IQ1_M': 0.0625,
        'IQ2_S': 0.125,
        'IQ2_M': 0.125,
        'IQ2_XS': 0.125,
        'IQ3_S': 0.1875,
        'IQ3_M': 0.1875,
        'IQ3_XS': 0.1875,
        'IQ4_S': 0.25,
        'IQ4_M': 0.25,
        'IQ4_XS': 0.25,
        'GGUF': 0.8,
    };

    const quantizationMultiplier = quantizationMultipliers[quantization] || 1.0;

    // Calculate model size in GB based on quantization.
    // Base: FP16 = 2 bytes per parameter.
    const bytesPerParam = 2 * quantizationMultiplier;
    const modelSizeGB = (parameterCount * 1e9 * bytesPerParam) / (1024 * 1024 * 1024);
    
    // KV cache size per token: ~0.5 MB per 1k context for 7B model.
    const kvCachePerToken = 0.0005 * (parameterCount / 7);
    const kvCacheGB = (kvCachePerToken * contextSize) / 1024;
    
    // Adjust for cache type.
    let cacheMultiplier = 1.0;
    const cacheLower = cacheType.toLowerCase();
    if (cacheLower === 'q8_0' || cacheLower === 'q8') {
        cacheMultiplier = 0.5;
    } else if (cacheLower === 'q4_0' || cacheLower === 'q4') {
        cacheMultiplier = 0.25;
    } else if (cacheLower === 'q6') {
        cacheMultiplier = 0.375;
    } else if (cacheLower === 'q3') {
        cacheMultiplier = 0.1875;
    } else if (cacheLower === 'q2') {
        cacheMultiplier = 0.125;
    } else if (cacheLower === 'fp8') {
        cacheMultiplier = 0.5;
    }
    
    const adjustedKVCacheGB = kvCacheGB * cacheMultiplier;
    
    // Calculate GPU layers memory.
    const totalLayers = Math.ceil(parameterCount * 0.8); // Rough estimate: ~0.8 layers per billion parameters.
    const gpuLayerRatio = gpuLayers === -1 ? 1 : Math.min(gpuLayers / totalLayers, 1);
    const gpuMemoryGB = modelSizeGB * gpuLayerRatio + adjustedKVCacheGB * 0.5;
    
    // Total VRAM estimate with overhead.
    const overhead = 1.5; // Additional overhead for CUDA, activations, etc.
    const totalVRAMGB = gpuMemoryGB + overhead;
    
    return totalVRAMGB.toFixed(1);
};

export function vramUseEstimation({
    modelName,
    gpuLayers,
    cacheType,
    contextSize,
    backend,
}: VRAMEstimationParams): VRAMEstimationResult {
    const [estimatedVRAM, setEstimatedVRAM] = useState<string>('N/A');
    const [isEstimating, setIsEstimating] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const estimateVRAM = async () => {
            // Only estimate for Llama.cpp backend.
            if (backend !== 'Llama.cpp') {
                setEstimatedVRAM('N/A');
                setIsEstimating(false);
                setError(null);
                return;
            }

            setIsEstimating(true);
            setError(null);

            try {
                // Simulate async operation (in case we want to add API calls later).
                await new Promise(resolve => setTimeout(resolve, 100));
                
                const result = calculateVRAM(
                    modelName || '7B',
                    gpuLayers,
                    cacheType,
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
    }, [modelName, gpuLayers, cacheType, contextSize, backend]);

    return {
        estimatedVRAM,
        isEstimating,
        error,
    };
}