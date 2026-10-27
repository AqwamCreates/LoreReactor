import type { cloudBackend, localBackend } from "../types";

export const spatiotemporalLocalBackends: localBackend[] = [
    'stable-diffusion.cpp',
];

export const spatiotemporalCloudBackends: cloudBackend[] = [
    'OpenRouter', 'NovelAI', 'Other',
];

export const spatiotemporalCloudImageEndpoints: Record<string, string> = {
    'OpenRouter': 'https://openrouter.ai/api/v1/images',
    'NovelAI': 'https://image.novelai.net/ai/generate-image',
};

export const spatiotemporalCloudVideoEndpoints: Record<string, string> = {
    'OpenRouter': 'https://openrouter.ai/api/v1/videos',
};

// ⚠️ IMPORTANT! Video generation is asynchronous. Submit a job to the endpoint above,
// then poll the job status URL returned in the response until completion.
export const spatiotemporalCloudVideoPollEndpoints: Record<string, string> = {
    'OpenRouter': 'https://openrouter.ai/api/v1/videos/{jobId}',
};

export const spatiotemporalCloudVideoModelEndpoints: Record<string, string> = {
    'OpenRouter': 'https://openrouter.ai/api/v1/videos/models',
};

export const openAiCompatibleSpatiotemporalLocalBackends = new Set<string>([
    'stable-diffusion.cpp',
]);

// sd-server also exposes /sdapi/v1/txt2img for advanced users who need negative prompts,
// highres fix, and per-request LoRA tags that the OpenAI endpoint doesn't support.
export const sdapiCompatibleSpatiotemporalLocalBackends = new Set<string>([
    'stable-diffusion.cpp',
]);

export const spatiotemporalBackends = [...spatiotemporalLocalBackends, ...spatiotemporalCloudBackends];