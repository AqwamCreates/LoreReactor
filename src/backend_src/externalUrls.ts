// src/backend_src/downloadUrls.ts

export const GITHUB_REPOSITORIES = {
  LLAMA_CPP: 'ggml-org/llama.cpp',
  LLAMA_CPP_FALLBACK_TAG: 'v0.4.1',
  MISTRAL_RS: 'EricLBuehler/mistral.rs',
  OLLAMA: 'ollama/ollama',
  LOCAL_AI: 'mudler/LocalAI',
};

export const DOCKER_IMAGES = {
  TENSOR_RT_LLM: 'nvcr.io/nvidia/tritonserver:24.05-trtllm-python-backend',
  TRANSFORMERS_TGI: 'ghcr.io/huggingface/text-generation-inference:latest',
};

export const DIRECT_DOWNLOADS = {
  UV: {
    WINDOWS: 'uv-x86_64-pc-windows-msvc.zip',
    MACOS_ARM: 'uv-aarch64-apple-darwin.tar.gz',
    MACOS_X64: 'uv-x86_64-apple-darwin.tar.gz',
    LINUX_ARM: 'uv-aarch64-unknown-linux-gnu.tar.gz',
    LINUX_X64: 'uv-x86_64-unknown-linux-gnu.tar.gz',
    BASE_URL: 'https://github.com/astral-sh/uv/releases/latest/download',
  },
  MISTRAL_RS_INSTALLER: 'https://mistral.rs.dev/install.sh',
  OLLAMA_WINDOWS: 'https://ollama.com/download/ollama-windows-amd64.zip',
  EXLLAMA_TABBY_API: 'https://github.com/theroyallab/tabbyAPI/archive/refs/heads/main.zip',
  FFMPEG_WINDOWS: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
};

export const TEXT_TO_SPEECH_MODELS = {
  BASE_URL: 'https://huggingface.co/mradermacher/Qwen3-TTS-12Hz-0.6B-Base-GGUF/resolve/main',
  MAIN_MODEL_FILE: 'Qwen3-TTS-12Hz-0.6B-Base.Q8_0.gguf',
  MMPROJ_VOICE_ENCODER_FILE: 'Qwen3-TTS-12Hz-0.6B-Base.mmproj-F16.gguf',
};