#!/usr/bin/env bash
# ============================================================
#  LoreReactor — One-Click Launcher + Backend Installer
#  Linux / macOS
#  Usage:  ./start.sh
#  First time:  chmod +x start.sh  &&  ./start.sh
# ============================================================
set -euo pipefail

# ── Navigate to the project root (one level above this script) ─
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"
ROOT="$PWD"
BACKENDS_DIR="$ROOT/local_backends"

# ── Detect OS ─────────────────────────────────────────────────
OS="linux"
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
fi

# ── Detect architecture ───────────────────────────────────────
RAW_ARCH="$(uname -m)"
case "$RAW_ARCH" in
    x86_64|amd64)
        ARCH_NORMALIZED="x86_64"
        ARCH_LABEL="x64"
        ;;
    aarch64|arm64)
        ARCH_NORMALIZED="aarch64"
        ARCH_LABEL="ARM64"
        ;;
    i686|i386|x86)
        ARCH_NORMALIZED="x86"
        ARCH_LABEL="x86 (32-bit)"
        ;;
    *)
        ARCH_NORMALIZED="$RAW_ARCH"
        ARCH_LABEL="$RAW_ARCH"
        ;;
esac

# ── Helper: prompt Y/n ────────────────────────────────────────
confirm() {
    local prompt="${1:-Continue?}"
    read -rp "  $prompt [Y/n]: " ans
    [[ -z "$ans" || "$ans" =~ ^[Yy] ]]
}

# ── Helper: fetch latest GitHub release tag ───────────────────
gh_latest_tag() {
    local repo="$1"
    curl -fsSL "https://api.github.com/repos/$repo/releases/latest" \
        | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"//;s/".*//'
}

# ── Helper: download file ─────────────────────────────────────
download() {
    local url="$1" dest="$2"
    echo "  [..] Downloading $(basename "$dest") ..."
    if command -v curl &>/dev/null; then
        curl -fSL --progress-bar -o "$dest" "$url"
    elif command -v wget &>/dev/null; then
        wget --show-progress -O "$dest" "$url"
    else
        echo "  [ERROR] Neither curl nor wget found."
        return 1
    fi
}

# ── Banner ───────────────────────────────────────────────────
echo ""
echo "  ========================================"
echo "          LoreReactor Launcher"
echo "          $( [[ "$OS" == "macos" ]] && echo "macOS" || echo "Linux" ) $ARCH_LABEL"
echo "  ========================================"
echo ""

# ── [1/4] Check Node.js ──────────────────────────────────────
echo "  [1/4] Checking Node.js ..."

if ! command -v node &>/dev/null; then
    echo ""
    echo "  [ERROR] Node.js is NOT installed."
    echo ""
    echo "  LoreReactor requires Node.js v18 or newer."
    echo ""
    if [[ "$OS" == "macos" ]]; then
        echo "  macOS — install via Homebrew:"
        echo "    brew install node"
    else
        echo "  Linux — install via your package manager:"
        echo "    Ubuntu/Debian : sudo apt install nodejs npm"
        echo "    Fedora        : sudo dnf install nodejs npm"
        echo "    Arch          : sudo pacman -S nodejs npm"
    fi
    echo ""
    echo "  Or download from: https://nodejs.org/en/download"
    echo "  After installing, run ./start.sh again."
    echo ""
    exit 1
fi

if ! command -v npm &>/dev/null; then
    echo "  [ERROR] npm not found. Reinstall Node.js from https://nodejs.org"
    exit 1
fi

NODE_MAJOR="$(node -v | sed 's/v//' | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "  [ERROR] Node.js $(node -v) is too old (need v18+)."
    echo "  Update from: https://nodejs.org/en/download"
    exit 1
fi

echo "  [OK] Node $(node -v)  ·  npm $(npm -v)  ·  $ARCH_LABEL"

# ── [2/4] Verify project files ────────────────────────────────
echo "  [2/4] Verifying project files ..."
if [ ! -f "package.json" ]; then
    echo "  [ERROR] package.json not found."
    echo "  Run ./start.sh from the LoreReactor root folder."
    exit 1
fi
if [ ! -f "src/server.ts" ]; then
    echo "  [ERROR] src/server.ts not found."
    echo "  Run ./start.sh from the LoreReactor root folder."
    exit 1
fi
echo "  [OK] Project files OK"

# ── [3/4] Install dependencies ────────────────────────────────
NEED_INSTALL=0
if [ ! -d "node_modules" ]; then
    NEED_INSTALL=1
    echo "  [3/4] First run — installing dependencies (this may take a minute) ..."
elif [ "package.json" -nt "node_modules" ]; then
    NEED_INSTALL=1
    echo "  [3/4] Dependencies outdated — updating ..."
fi

if [ "$NEED_INSTALL" -eq 1 ]; then
    if [ -f "package-lock.json" ]; then
        npm ci
    else
        npm install
    fi
    echo "  [OK] Dependencies ready"
else
    echo "  [3/4] [OK] Dependencies up to date — skipping install"
fi

# ============================================================
#  MAIN MENU
# ============================================================
main_menu() {
    echo ""
    echo "  ========================================"
    echo "  What would you like to do?"
    echo "  ========================================"
    echo ""
    echo "    [1] Start LoreReactor"
    echo "    [2] Install / manage local inference backends"
    echo "    [3] Exit"
    echo ""
    read -rp "  Enter choice [1-3]: " choice
    case "$choice" in
        1) launch ;;
        2) backend_menu ;;
        3) exit 0 ;;
        *) echo "  [WARN] Invalid choice."; main_menu ;;
    esac
}

# ============================================================
#  LAUNCH
# ============================================================
launch() {
    echo ""
    echo "  ========================================"
    echo "    LoreReactor is starting!"
    echo ""
    echo "    Web UI    : http://localhost:4444"
    echo "    API Server: http://localhost:8448"
    echo ""
    echo "    Press Ctrl + C to stop all servers."
    echo "  ========================================"
    echo ""

    cleanup() {
        echo ""
        echo "  Shutting down LoreReactor ..."
        kill 0 2>/dev/null || true
        wait 2>/dev/null || true
        echo "  [OK] All servers stopped. Goodbye!"
        echo ""
    }
    trap cleanup EXIT INT TERM

    npx concurrently \
        --kill-others \
        --kill-signal SIGTERM \
        --names "WEB,API" \
        --prefix-colors "cyan,magenta" \
        "npx serve dist -l 4444 -s" \
        "npm run server"
}

# ============================================================
#  BACKEND MENU
# ============================================================
backend_menu() {
    echo ""
    echo "  ========================================"
    echo "  Local Inference Backends  ($ARCH_LABEL)"
    echo "  ========================================"
    echo ""
    echo "    [1]  Llama.cpp          — GGUF models, CPU/CUDA/Vulkan/Metal"
    echo "    [2]  Ollama             — easiest setup, broad model support"
    echo "    [3]  vLLM               — high-throughput, NVIDIA GPU"
    echo "    [4]  ExLlamaV2          — EXL2 quantized models, fast single GPU"
    echo "    [5]  ExLlamaV3          — latest ExLlama, EXL3 format"
    echo "    [6]  ExLlamaV3 HF       — ExLlamaV3 with HuggingFace models"
    echo "    [7]  SGLang             — RadixAttention, structured generation"
    echo "    [8]  mistral.rs         — Rust-based, no Python needed"
    echo "    [9]  LM Studio          — GUI app + lms CLI"
    echo "    [10] LocalAI            — multi-modal OpenAI replacement"
    echo "    [11] TensorRT-LLM       — NVIDIA Triton (Docker required)"
    echo "    [12] Transformers/TGI  — HuggingFace TGI (Docker required)"
    echo "    [0]  Back to main menu"
    echo ""
    read -rp "  Enter choice [0-12]: " bchoice
    case "$bchoice" in
        0)  main_menu ;;
        1)  install_llamacpp ;;
        2)  install_ollama ;;
        3)  install_vllm ;;
        4)  install_exllamav2 ;;
        5)  install_exllamav3 ;;
        6)  install_exllamav3hf ;;
        7)  install_sglang ;;
        8)  install_mistralrs ;;
        9)  install_lmstudio ;;
        10) install_localai ;;
        11) install_tensorrt ;;
        12) install_tgi ;;
        *)  echo "  [WARN] Invalid choice."; backend_menu ;;
    esac
}

# ============================================================
#  [1] Llama.cpp
#  Uses ARCH_NORMALIZED to pick the right asset.
#  x86 (32-bit) Linux is not published — warn and bail.
# ============================================================
install_llamacpp() {
    echo ""
    echo "  --- Installing Llama.cpp ---"
    echo ""

    # 32-bit guard
    if [[ "$ARCH_NORMALIZED" == "x86" ]]; then
        echo "  [WARN] You are running 32-bit Linux."
        echo "  llama.cpp does not publish official 32-bit Linux binaries."
        echo "  You would need to build from source:"
        echo "  https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md"
        echo ""
        read -rp "  Press Enter to continue ..."; backend_menu; return
    fi

    local tag
    tag="$(gh_latest_tag "ggml-org/llama.cpp")"
    if [ -z "$tag" ]; then
        echo "  [ERROR] Could not fetch latest release."
        echo "  Download manually from: https://github.com/ggml-org/llama.cpp/releases"
        read -rp "  Press Enter to continue ..."; backend_menu; return
    fi
    echo "  [OK] Latest release: $tag"

    local tag_norm="${tag//-/_}"
    local asset=""

    if [[ "$OS" == "macos" ]]; then
        # macOS: universal binary covers both x64 and ARM64
        echo "  Detected macOS — downloading Metal/universal binary."
        asset="llama-${tag_norm}-bin-macos-universal.tar.gz"
    else
        # Linux: map arch to the suffix used in llama.cpp asset names
        local linux_arch_suffix="x64"
        [[ "$ARCH_NORMALIZED" == "aarch64" ]] && linux_arch_suffix="arm64"

        echo ""
        echo "  Which build variant?"
        if [[ "$ARCH_NORMALIZED" == "aarch64" ]]; then
            echo "    [1] Vulkan  — ARM64 GPU acceleration"
            echo "    [2] CPU     — no GPU acceleration"
            echo ""
            read -rp "  Enter choice [1-2]: " variant
            case "$variant" in
                1) asset="llama-${tag_norm}-bin-ubuntu-vulkan-${linux_arch_suffix}.tar.gz" ;;
                2) asset="llama-${tag_norm}-bin-ubuntu-avx2-${linux_arch_suffix}.tar.gz" ;;
                *) echo "  Defaulting to CPU."; asset="llama-${tag_norm}-bin-ubuntu-avx2-${linux_arch_suffix}.tar.gz" ;;
            esac
        else
            echo "    [1] CUDA    — NVIDIA GPU (recommended if available)"
            echo "    [2] Vulkan  — AMD / Intel / NVIDIA GPU"
            echo "    [3] CPU     — no GPU acceleration"
            echo ""
            read -rp "  Enter choice [1-3]: " variant
            case "$variant" in
                1) asset="llama-${tag_norm}-bin-ubuntu-cuda-cu12.4.0-${linux_arch_suffix}.tar.gz" ;;
                2) asset="llama-${tag_norm}-bin-ubuntu-vulkan-${linux_arch_suffix}.tar.gz" ;;
                3) asset="llama-${tag_norm}-bin-ubuntu-avx2-${linux_arch_suffix}.tar.gz" ;;
                *) echo "  Defaulting to CPU."; asset="llama-${tag_norm}-bin-ubuntu-avx2-${linux_arch_suffix}.tar.gz" ;;
            esac
        fi
    fi

    local url="https://github.com/ggml-org/llama.cpp/releases/download/${tag}/${asset}"
    local dest="$BACKENDS_DIR/llama"
    local tmp="/tmp/lorereactor_llama.tar.gz"

    mkdir -p "$dest"
    download "$url" "$tmp" || {
        echo "  [ERROR] Download failed. Asset name may have changed."
        echo "  Download manually from: https://github.com/ggml-org/llama.cpp/releases"
        read -rp "  Press Enter to continue ..."; backend_menu; return
    }

    echo "  [..] Extracting to $dest ..."
    tar -xzf "$tmp" -C "$dest" --strip-components=0 2>/dev/null || tar -xzf "$tmp" -C "$dest"
    rm -f "$tmp"

    if find "$dest" -name "llama-server" 2>/dev/null | grep -q .; then
        echo "  [OK] Llama.cpp installed at: $dest"
    else
        echo "  [WARN] llama-server binary not found in extracted files."
        echo "  Check $dest manually — the release layout may have changed."
    fi
    echo ""
    read -rp "  Press Enter to continue ..."; backend_menu
}

# ============================================================
#  [2] Ollama
# ============================================================
install_ollama() {
    echo ""
    echo "  --- Installing Ollama ---"
    echo ""
    confirm "Install Ollama using the official install script?" || { backend_menu; return; }

    if [[ "$OS" == "macos" ]]; then
        echo "  On macOS, please download the .dmg from:"
        echo "    https://ollama.com/download/mac"
        echo "  After installing, the binary is at /usr/local/bin/ollama"
        local dest="$BACKENDS_DIR/ollama"
        mkdir -p "$dest"
        if [ -f "/usr/local/bin/ollama" ]; then
            cp -f /usr/local/bin/ollama "$dest/ollama"
            echo "  [OK] Copied to: $dest/ollama"
        else
            echo "  [WARN] /usr/local/bin/ollama not found. Install LM Studio first."
        fi
        read -rp "  Press Enter to continue ..."; backend_menu; return
    fi

    echo "  [..] Running official Ollama install script ..."
    curl -fsSL https://ollama.com/install.sh | sh || {
        echo "  [ERROR] Ollama installation failed."
        echo "  See: https://ollama.com/download/linux"
        read -rp "  Press Enter to continue ..."; backend_menu; return
    }

    local ollama_bin
    ollama_bin="$(command -v ollama 2>/dev/null || echo /usr/local/bin/ollama)"
    local dest="$BACKENDS_DIR/ollama"
    mkdir -p "$dest"

    if [ -f "$ollama_bin" ]; then
        cp -f "$ollama_bin" "$dest/ollama"
        echo "  [OK] Ollama copied to: $dest/ollama"
    else
        echo "  [WARN] ollama binary not found at expected location."
        echo "  Locate it and copy to: $dest/ollama"
    fi
    echo ""
    read -rp "  Press Enter to continue ..."; backend_menu
}

# ============================================================
#  [3] vLLM
# ============================================================
install_vllm() {
    echo ""
    echo "  --- Installing vLLM ---"
    echo ""
    echo "  Requirements: Python 3.10+, NVIDIA GPU with CUDA 11.8+ recommended."
    echo "  Architecture: $ARCH_LABEL"
    echo ""

    if [[ "$ARCH_NORMALIZED" == "x86" ]]; then
        echo "  [ERROR] vLLM requires a 64-bit system."
        read -rp "  Press Enter to continue ..."; backend_menu; return
    fi

    confirm "Create a Python venv and install vllm?" || { backend_menu; return; }

    if ! command -v python3 &>/dev/null; then
        echo "  [ERROR] python3 not found. Install Python 3.10+ first."
        read -rp "  Press Enter to continue ..."; backend_menu; return
    fi

    echo "  [OK] Found: $(python3 --version)"
    local dest="$BACKENDS_DIR/vllm"
    mkdir -p "$dest"

    echo "  [..] Creating Python virtual environment ..."
    python3 -m venv "$dest/venv"

    echo "  [..] Installing vllm (this may take several minutes) ..."
    "$dest/venv/bin/python" -m pip install --upgrade pip -q
    "$dest/venv/bin/python" -m pip install vllm || {
        echo "  [ERROR] vllm installation failed."
        echo "  See: https://docs.vllm.ai/en/latest/getting_started/installation.html"
        read -rp "  Press Enter to continue ..."; backend_menu; return
    }

    ln -sf "$dest/venv/bin/python" "$dest/python"
    echo "  [OK] vLLM installed at: $dest"
    echo "  [OK] Python symlink: $dest/python → venv/bin/python"
    echo ""
    read -rp "  Press Enter to continue ..."; backend_menu
}

# ============================================================
#  [4] ExLlamaV2 via TabbyAPI
# ============================================================
install_exllamav2() {
    echo ""
    echo "  --- Installing ExLlamaV2 (TabbyAPI) ---"
    echo ""
    echo "  Requirements: Python 3.10+, NVIDIA GPU, Git. Arch: $ARCH_LABEL"
    echo ""

    if [[ "$ARCH_NORMALIZED" == "x86" ]]; then
        echo "  [ERROR] ExLlamaV2 requires a 64-bit system."
        read -rp "  Press Enter to continue ..."; backend_menu; return
    fi

    confirm "Clone TabbyAPI and install dependencies?" || { backend_menu; return; }

    if ! command -v git &>/dev/null; then
        echo "  [ERROR] git not found. Install it first."
        read -rp "  Press Enter to continue ..."; backend_menu; return
    fi
    if ! command -v python3 &>/dev/null; then
        echo "  [ERROR] python3 not found. Install Python 3.10+ first."
        read -rp "  Press Enter to continue ..."; backend_menu; return
    fi

    local dest="$BACKENDS_DIR/exllamav2"
    mkdir -p "$dest"

    if [ -d "$dest/tabbyAPI/.git" ]; then
        echo "  [..] Existing repo found. Pulling latest ..."
        git -C "$dest/tabbyAPI" pull
    else
        echo "  [..] Cloning TabbyAPI ..."
        git clone https://github.com/theroyallab/tabbyAPI.git "$dest/tabbyAPI"
    fi

    echo "  [..] Setting up Python environment ..."
    cd "$dest/tabbyAPI"
    if [ -f "start.sh" ]; then
        echo "  [..] Running TabbyAPI start.sh (let deps install, then Ctrl + C) ..."
        bash start.sh || true
    else
        python3 -m venv venv
        source venv/bin/activate
        pip install --upgrade pip -q
        pip install -r requirements.txt
        deactivate
    fi
    cd "$ROOT"

    [ -f "$dest/tabbyAPI/venv/bin/python" ] && ln -sf "$dest/tabbyAPI/venv/bin/python" "$dest/python"
    [ -f "$dest/tabbyAPI/start.py" ] && cp -f "$dest/tabbyAPI/start.py" "$dest/start.py"

    echo "  [OK] ExLlamaV2 installed at: $dest"
    echo ""
    read -rp "  Press Enter to continue ..."; backend_menu
}

# ============================================================
#  [5] ExLlamaV3 via TabbyAPI
# ============================================================
install_exllamav3() {
    echo ""
    echo "  --- Installing ExLlamaV3 (TabbyAPI) ---"
    echo ""

    if [[ "$ARCH_NORMALIZED" == "x86" ]]; then
        echo "  [ERROR] ExLlamaV3 requires a 64-bit system."
        read -rp "  Press Enter to continue ..."; backend_menu; return
    fi

    confirm "Clone TabbyAPI into exllamav3/ and install deps?" || { backend_menu; return; }

    if ! command -v git &>/dev/null; then
        echo "  [ERROR] git not found."; read -rp "  Press Enter ..."; backend_menu; return
    fi

    local dest="$BACKENDS_DIR/exllamav3"
    mkdir -p "$dest"

    if [ -d "$dest/tabbyAPI/.git" ]; then
        git -C "$dest/tabbyAPI" pull
    else
        git clone https://github.com/theroyallab/tabbyAPI.git "$dest/tabbyAPI"
    fi

    cd "$dest/tabbyAPI"
    if [ -f "start.sh" ]; then
        bash start.sh || true
    else
        python3 -m venv venv && source venv/bin/activate
        pip install --upgrade pip -q && pip install -r requirements.txt
        deactivate
    fi
    cd "$ROOT"

    [ -f "$dest/tabbyAPI/venv/bin/python" ] && ln -sf "$dest/tabbyAPI/venv/bin/python" "$dest/python"
    [ -f "$dest/tabbyAPI/start.py" ] && cp -f "$dest/tabbyAPI/start.py" "$dest/start.py"

    echo "  [OK] ExLlamaV3 installed at: $dest"
    echo ""
    read -rp "  Press Enter to continue ..."; backend_menu
}

# ============================================================
#  [6] ExLlamaV3 HF
# ============================================================
install_exllamav3hf() {
    echo ""
    echo "  --- Installing ExLlamaV3 HF (TabbyAPI) ---"
    echo ""

    if [[ "$ARCH_NORMALIZED" == "x86" ]]; then
        echo "  [ERROR] ExLlamaV3 HF requires a 64-bit system."
        read -rp "  Press Enter to continue ..."; backend_menu; return
    fi

    confirm "Clone TabbyAPI into exllamav3_hf/ and install deps?" || { backend_menu; return; }

    if ! command -v git &>/dev/null; then
        echo "  [ERROR] git not found."; read -rp "  Press Enter ..."; backend_menu; return
    fi

    local dest="$BACKENDS_DIR/exllamav3_hf"
    mkdir -p "$dest"

    if [ -d "$dest/tabbyAPI/.git" ]; then
        git -C "$dest/tabbyAPI" pull
    else
        git clone https://github.com/theroyallab/tabbyAPI.git "$dest/tabbyAPI"
    fi

    cd "$dest/tabbyAPI"
    if [ -f "start.sh" ]; then
        bash start.sh || true
    else
        python3 -m venv venv && source venv/bin/activate
        pip install --upgrade pip -q && pip install -r requirements.txt
        deactivate
    fi
    cd "$ROOT"

    [ -f "$dest/tabbyAPI/venv/bin/python" ] && ln -sf "$dest/tabbyAPI/venv/bin/python" "$dest/python"
    [ -f "$dest/tabbyAPI/start.py" ] && cp -f "$dest/tabbyAPI/start.py" "$dest/start.py"

    echo "  [OK] ExLlamaV3 HF installed at: $dest"
    echo ""
    read -rp "  Press Enter to continue ..."; backend_menu
}

# ============================================================
#  [7] SGLang
# ============================================================
install_sglang() {
    echo ""
    echo "  --- Installing SGLang ---"
    echo ""
    echo "  Requirements: Python 3.10+, NVIDIA GPU recommended. Arch: $ARCH_LABEL"
    echo ""

    if [[ "$ARCH_NORMALIZED" == "x86" ]]; then
        echo "  [ERROR] SGLang requires a 64-bit system."
        read -rp "  Press Enter to continue ..."; backend_menu; return
    fi

    confirm "Create a Python venv and install sglang[srt]?" || { backend_menu; return; }

    if ! command -v python3 &>/dev/null; then
        echo "  [ERROR] python3 not found."; read -rp "  Press Enter ..."; backend_menu; return
    fi

    local dest="$BACKENDS_DIR/sglang"
    mkdir -p "$dest"

    echo "  [..] Creating Python virtual environment ..."
    python3 -m venv "$dest/venv"

    echo "  [..] Installing sglang[srt] (this may take several minutes) ..."
    "$dest/venv/bin/python" -m pip install --upgrade pip -q
    "$dest/venv/bin/python" -m pip install "sglang[srt]" || {
        echo "  [ERROR] SGLang installation failed."
        echo "  See: https://docs.sglang.ai/get_started/install.html"
        read -rp "  Press Enter to continue ..."; backend_menu; return
    }

    ln -sf "$dest/venv/bin/python" "$dest/python"
    echo "  [OK] SGLang installed at: $dest"
    echo ""
    read -rp "  Press Enter to continue ..."; backend_menu
}

# ============================================================
#  [8] mistral.rs
#  Uses ARCH_NORMALIZED to select the correct binary asset.
# ============================================================
install_mistralrs() {
    echo ""
    echo "  --- Installing mistral.rs ---"
    echo ""

    if [[ "$ARCH_NORMALIZED" == "x86" ]]; then
        echo "  [WARN] You are running a 32-bit system."
        echo "  mistral.rs does not publish 32-bit binaries."
        echo "  Build from source: https://github.com/EricLBuehler/mistral.rs"
        echo ""
        read -rp "  Press Enter to continue ..."; backend_menu; return
    fi

    confirm "Download the latest mistralrs-server binary?" || { backend_menu; return; }

    local tag
    tag="$(gh_latest_tag "EricLBuehler/mistral.rs")"
    if [ -z "$tag" ]; then
        echo "  [ERROR] Could not fetch latest release."
        echo "  Download manually from: https://github.com/EricLBuehler/mistral.rs/releases"
        read -rp "  Press Enter to continue ..."; backend_menu; return
    fi
    echo "  [OK] Latest release: $tag"

    local asset=""

    if [[ "$OS" == "macos" ]]; then
        # macOS: separate assets for Apple Silicon vs Intel
        if [[ "$ARCH_NORMALIZED" == "aarch64" ]]; then
            asset="mistralrs-server-aarch64-apple-darwin"
        else
            asset="mistralrs-server-x86_64-apple-darwin"
        fi
    else
        # Linux: map arch to Rust target triple
        local linux_target="x86_64-unknown-linux-gnu"
        [[ "$ARCH_NORMALIZED" == "aarch64" ]] && linux_target="aarch64-unknown-linux-gnu"

        echo ""
        echo "  Which build?"
        echo "    [1] CUDA  — NVIDIA GPU"
        echo "    [2] CPU   — no GPU"
        echo ""
        read -rp "  Enter choice [1-2]: " variant
        case "$variant" in
            1) asset="mistralrs-server-${linux_target}-cuda" ;;
            2) asset="mistralrs-server-${linux_target}" ;;
            *) asset="mistralrs-server-${linux_target}" ;;
        esac
    fi

    local url="https://github.com/EricLBuehler/mistral.rs/releases/download/${tag}/${asset}"
    local dest="$BACKENDS_DIR/mistral-rs"
    local tmp="/tmp/lorereactor_mistralrs"

    mkdir -p "$dest"
    download "$url" "$tmp" || {
        echo "  [ERROR] Download failed. Asset name may have changed."
        echo "  Download manually from: https://github.com/EricLBuehler/mistral.rs/releases"
        read -rp "  Press Enter to continue ..."; backend_menu; return
    }

    mv -f "$tmp" "$dest/mistralrs-server"
    chmod +x "$dest/mistralrs-server"
    echo "  [OK] mistral.rs installed at: $dest/mistralrs-server"
    echo ""
    read -rp "  Press Enter to continue ..."; backend_menu
}

# ============================================================
#  [9] LM Studio
# ============================================================
install_lmstudio() {
    echo ""
    echo "  --- Installing LM Studio ---"
    echo ""

    if [[ "$OS" == "macos" ]]; then
        echo "  On macOS, download the .dmg from:"
        echo "    https://lmstudio.ai/download"
        echo "  After installing, the lms CLI is at:"
        echo "    /Applications/LM Studio.app/Contents/Resources/lms"
        echo ""
        confirm "Copy lms into local_backends/lmstudio/ now?" || { backend_menu; return; }
        local lms_src="/Applications/LM Studio.app/Contents/Resources/lms"
        if [ -f "$lms_src" ]; then
            local dest="$BACKENDS_DIR/lmstudio"
            mkdir -p "$dest"
            cp -f "$lms_src" "$dest/lms"
            chmod +x "$dest/lms"
            echo "  [OK] lms copied to: $dest/lms"
        else
            echo "  [WARN] LM Studio not found at expected path. Install it first."
        fi
    else
        echo "  On Linux, LM Studio provides an AppImage or .tar.gz."
        echo "  Download from: https://lmstudio.ai/download"
        echo ""
        echo "  After extracting, locate the 'lms' binary and copy to:"
        echo "    $BACKENDS_DIR/lmstudio/lms"
        echo ""
        echo "  Alternatively, install just the CLI:"
        echo "    npx lmstudio install-cli"
    fi

    echo ""
    read -rp "  Press Enter to continue ..."; backend_menu
}

# ============================================================
#  [10] LocalAI
#  Uses ARCH_NORMALIZED to download the correct binary.
# ============================================================
install_localai() {
    echo ""
    echo "  --- Installing LocalAI ---"
    echo ""
    confirm "Download the latest LocalAI binary for $ARCH_LABEL?" || { backend_menu; return; }

    local tag
    tag="$(gh_latest_tag "mudler/LocalAI")"
    if [ -z "$tag" ]; then
        echo "  [ERROR] Could not fetch release."
        echo "  Download manually from: https://github.com/mudler/LocalAI/releases"
        read -rp "  Press Enter to continue ..."; backend_menu; return
    fi

    local os_label="Linux"
    [[ "$OS" == "macos" ]] && os_label="Darwin"

    # LocalAI uses x86_64 / arm64 in their asset names
    local arch_label="x86_64"
    [[ "$ARCH_NORMALIZED" == "aarch64" ]] && arch_label="arm64"

    local asset="local-ai-${os_label}-${arch_label}"
    local url="https://github.com/mudler/LocalAI/releases/download/${tag}/${asset}"
    local dest="$BACKENDS_DIR/localai"
    local tmp="/tmp/lorereactor_localai"

    mkdir -p "$dest"
    download "$url" "$tmp" || {
        echo "  [ERROR] Download failed."
        echo "  Download manually from: https://github.com/mudler/LocalAI/releases"
        read -rp "  Press Enter to continue ..."; backend_menu; return
    }

    mv -f "$tmp" "$dest/local-ai"
    chmod +x "$dest/local-ai"
    echo "  [OK] LocalAI installed at: $dest/local-ai"
    echo ""
    read -rp "  Press Enter to continue ..."; backend_menu
}

# ============================================================
#  [11] TensorRT-LLM — Docker only
# ============================================================
install_tensorrt() {
    echo ""
    echo "  --- TensorRT-LLM (Docker) ---"
    echo ""
    echo "  TensorRT-LLM requires Docker with NVIDIA Container Toolkit."
    echo "  There is no standalone binary."
    echo ""
    echo "  Prerequisites:"
    echo "    1. Docker: https://docs.docker.com/engine/install/"
    echo "    2. NVIDIA Container Toolkit:"
    echo "       https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html"
    echo ""
    echo "  Example run command:"
    echo "    docker run --gpus all --rm -p 8080:8000 \\"
    echo "      nvcr.io/nvidia/tritonserver:24.05-trtllm-python-backend"
    echo ""
    echo "  Full guide:"
    echo "    https://github.com/triton-inference-server/tensorrtllm_backend"
    echo ""
    read -rp "  Press Enter to continue ..."; backend_menu
}

# ============================================================
#  [12] TGI — Docker only
# ============================================================
install_tgi() {
    echo ""
    echo "  --- HuggingFace Text Generation Inference (Docker) ---"
    echo ""
    echo "  TGI runs as a Docker container."
    echo ""
    echo "  Prerequisites:"
    echo "    1. Docker: https://docs.docker.com/engine/install/"
    echo "    2. NVIDIA GPU + NVIDIA Container Toolkit (for GPU mode)"
    echo ""
    echo "  Example run command:"
    echo "    docker run --gpus all --shm-size 1g -p 8080:80 \\"
    echo "      ghcr.io/huggingface/text-generation-inference:latest \\"
    echo "      --model-id meta-llama/Llama-3-8B-Instruct"
    echo ""
    echo "  Full docs:"
    echo "    https://huggingface.co/docs/text-generation-inference"
    echo ""
    read -rp "  Press Enter to continue ..."; backend_menu
}

# ============================================================
#  Entry point
# ============================================================
main_menu