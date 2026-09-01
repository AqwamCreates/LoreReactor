export const cloudBackends = [
    'Google', 'DeepSeek', 'Qwen', 'Kimi', 'OpenAI', 'Anthropic', 'Mistral', 'Groq', 'OpenRouter', 'Inworld', 'Cohere', 'AI21', 'Perplexity', 'NovelAI', 'Other'
];

export const cloudEndpoints: Record<string, string> = {
  'Google': 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  'DeepSeek': 'https://api.deepseek.com/chat/completions',
  'Qwen': 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  'Kimi': 'https://api.moonshot.ai/v1/chat/completions',
  'GLM': 'https://api.z.ai/api/paas/v4/chat/completions',
  'MiMo': 'https://api.xiaomimimo.com/v1/chat/completions',
  'OpenAI': 'https://api.openai.com/v1/chat/completions',
  'Anthropic': 'https://api.anthropic.com/v1/messages',
  'Mistral': 'https://api.mistral.ai/v1/chat/completions',
  'Groq': 'https://api.groq.com/openai/v1/chat/completions',
  'YandexGPT': 'https://ai.api.cloud.yandex.net/v1/chat/completions',
  'OpenRouter': 'https://openrouter.ai/api/v1/chat/completions',
  'Inworld': 'https://api.inworld.ai/v1/chat/completions',
  'Cohere': 'https://api.cohere.com/compatibility/v1/chat/completions',
  'AI21': 'https://api.ai21.com/studio/v1/chat/completions',
  'Perplexity': 'https://api.perplexity.ai/chat/completions',
  'NovelAI': 'https://text.novelai.net/oa/v1/chat/completions',
};