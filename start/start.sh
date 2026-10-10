#!/usr/bin/env bash
set -euo pipefail

# ── Navigate to project root (handles root or scripts/ folder) ─
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/package.json" ]; then
    cd "$SCRIPT_DIR"
else
    cd "$SCRIPT_DIR/.."
fi
ROOT="$PWD"

# ── Detect OS & Architecture ──────────────────────────────────
OS="Linux"
[[ "$OSTYPE" == "darwin"* ]] && OS="macOS"
RAW_ARCH="$(uname -m)"

echo ""
echo "  ========================================"
echo "          LoreReactor Launcher"
echo "          $OS ($RAW_ARCH)"
echo "  ========================================"
echo ""

# ── [1/3] Check Node.js ──────────────────────────────────────
echo "  [1/3] Checking Node.js ..."
if ! command -v node &>/dev/null; then
    echo ""
    echo "  [ERROR] Node.js is NOT installed."
    echo "  Download from: https://nodejs.org/en/download"
    echo ""
    exit 1
fi

NODE_MAJOR="$(node -v | sed 's/v//' | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "  [ERROR] Node.js $(node -v) is too old (requires v18+)."
    echo "  Update from: https://nodejs.org/en/download"
    exit 1
fi

# ── [2/3] Verify Project Files ────────────────────────────────
echo "  [2/3] Verifying project structure ..."
if [ ! -f "package.json" ]; then
    echo "  [ERROR] package.json not found in $ROOT."
    exit 1
fi
if [ ! -f "src/backend_src/server.ts" ]; then
    echo "  [ERROR] src/backend_src/server.ts not found in $ROOT."
    exit 1
fi

# ── [3/3] Install / Update Dependencies ───────────────────────
NEED_INSTALL=0
if [ ! -d "node_modules" ]; then
    NEED_INSTALL=1
    echo "  [3/3] Installing dependencies (first run) ..."
elif [ "package.json" -nt "node_modules" ]; then
    NEED_INSTALL=1
    echo "  [3/3] Dependencies outdated — updating ..."
fi

if [ "$NEED_INSTALL" -eq 1 ]; then
    if [ -f "package-lock.json" ]; then
        npm ci
    else
        npm install
    fi
else
    echo "  [3/3] Dependencies up to date."
fi

# ── Launch ───────────────────────────────────────────────────
echo ""
echo "  ========================================"
echo "    LoreReactor is starting!"
echo ""
echo "    API Server: http://localhost:8448"
echo "    Engines   : Managed on-demand in UI"
echo ""
echo "    Press Ctrl + C to stop all servers."
echo "  ========================================"
echo ""

cleanup() {
    echo ""
    echo "  Shutting down LoreReactor ..."
    kill 0 2>/dev/null || true
    wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

npx concurrently \
    --kill-others \
    --kill-signal SIGTERM \
    --names "WEB,API" \
    --prefix-colors "cyan,magenta" \
    "npm run start"