import type { cloudBackend, localBackend } from "../types";

export const localBackends: localBackend[] = [
    'stable-diffusion.cpp',
];

export const cloudBackends: cloudBackend[] = [
    'OpenRouter', 'NovelAI', 'Other',
];

// Image generation endpoints (synchronous)
export const cloudEndpoints: Record<string, string> = {
    'OpenRouter': 'https://openrouter.ai/api/v1/images',
    'NovelAI': 'https://image.novelai.net/ai/generate-image',
};

// ⚠️ IMPORTANT! Video generation is asynchronous. Submit a job to the endpoint below,
// then poll the job status URL returned in the response until completion.
export const cloudVideoEndpoints: Record<string, string> = {
    'OpenRouter': 'https://openrouter.ai/api/v1/videos',
};

export const cloudVideoPollEndpoints: Record<string, string> = {
    'OpenRouter': 'https://openrouter.ai/api/v1/videos/{jobId}',
};

export const cloudVideoModelEndpoints: Record<string, string> = {
    'OpenRouter': 'https://openrouter.ai/api/v1/videos/models',
};

export const openAiCompatibleLocalBackends = new Set<string>([
    'stable-diffusion.cpp',
]);

// sd-server also exposes /sdapi/v1/txt2img for advanced users who need negative prompts,
// highres fix, and per-request LoRA tags that the OpenAI endpoint doesn't support.
export const sdapiCompatibleLocalBackends = new Set<string>([
    'stable-diffusion.cpp',
]);

export const backends = [...localBackends, ...cloudBackends];