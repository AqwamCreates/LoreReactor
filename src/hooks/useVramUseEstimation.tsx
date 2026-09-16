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

function getCacheMultiplier(cacheType: string): number {
    const lower = cacheType.toLowerCase();
    switch (lower) {
        case 'f16':
        case 'fp16':
            return 1.0;
        case 'f32':
        case 'fp32':
            return 2.0;
        case 'bf16':
            return 1.0;
        case 'fp8':
        case 'e4m3':
        case 'e5m2':
            return 0.5;
        case 'q8_0':
        case 'q8':
            return 0.5;
        case 'q6_k':
        case 'q6':
            return 0.375;
        case 'q5_k':
        case 'q5_0':
        case 'q5_1':
        case 'q5':
            return 0.3125;
        case 'q4_k':
        case 'q4_0':
        case 'q4_1':
        case 'q4':
            return 0.25;
        case 'q4_nl':
            return 0.3;
        case 'q3_k':
        case 'q3':
            return 0.1875;
        case 'q2_k':
        case 'q2':
            return 0.125;
        case 'iq1_s':
        case 'iq1_m':
            return 0.0625;
        case 'iq2_s':
        case 'iq2_m':
        case 'iq2_xs':
            return 0.125;
        case 'iq3_s':
        case 'iq3_m':
        case 'iq3_xs':
            return 0.1875;
        case 'iq4_s':
        case 'iq4_m':
        case 'iq4_xs':
            return 0.25;
        default:
            return 1.0;
    }
}

const calculateVRAM = (modelName: string, gpuLayers: number, keyCacheType: string, valueCacheType: string, contextSize: number): string => {
    const sizeMatch = modelName.match(/(\d+\.?\d*)\s*[Bb]/);
    let parameterCount: number;
    
    if (sizeMatch) {
        parameterCount = Number.parseFloat(sizeMatch[1]);
    } else {
        return 'Unknown';
    }

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

    let quantization = 'Unknown';
    for (const { pattern, value } of quantizationPatterns) {
        if (pattern.test(modelName)) {
            quantization = value;
            break;
        }
    }
    
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
    const bytesPerParam = 2 * quantizationMultiplier;
    const modelSizeGB = (parameterCount * 1e9 * bytesPerParam) / (1024 * 1024 * 1024);
    
    const kvCachePerTokenBase = 0.0005 * (parameterCount / 7);
    const keyCacheMultiplier = getCacheMultiplier(keyCacheType);
    const valueCacheMultiplier = getCacheMultiplier(valueCacheType);
    const avgCacheMultiplier = (keyCacheMultiplier + valueCacheMultiplier) / 2;
    const kvCacheGB = (kvCachePerTokenBase * avgCacheMultiplier * contextSize) / 1024;
    
    const totalLayers = Math.ceil(parameterCount * 0.8);
    const gpuLayerRatio = gpuLayers === -1 ? 1 : Math.min(gpuLayers / totalLayers, 1);
    const gpuMemoryGB = modelSizeGB * gpuLayerRatio + kvCacheGB * 0.5;
    
    const overhead = 1.5;
    const totalVRAMGB = gpuMemoryGB + overhead;
    
    return totalVRAMGB.toFixed(1);
};

export function useVramUseEstimation({
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
                await new Promise(resolve => setTimeout(resolve, 100));
                
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