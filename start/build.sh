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

echo ""
echo "  ========================================"
echo "          LoreReactor Build Script ($OS)"
echo "  ========================================"
echo ""

# ── [1/4] Check Node.js ──────────────────────────────────────
echo "  [1/4] Checking Node.js ..."
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

# ── [2/4] Verify Project Files & Dependencies ────────────────
echo "  [2/4] Verifying dependencies ..."
if [ ! -f "package.json" ]; then
    echo "  [ERROR] package.json not found in $ROOT."
    exit 1
fi

NEED_INSTALL=0
if [ ! -d "node_modules" ]; then
    NEED_INSTALL=1
    echo "  Installing dependencies (first run) ..."
elif [ "package.json" -nt "node_modules" ]; then
    NEED_INSTALL=1
    echo "  Dependencies outdated — updating ..."
fi

if [ "$NEED_INSTALL" -eq 1 ]; then
    if [ -f "package-lock.json" ]; then
        npm ci
    else
        npm install
    fi
else
    echo "  Dependencies up to date."
fi

# ── [3/4 & 4/4] Build Execution ───────────────────────────────
MODE="${1:-build}"

if [ "$MODE" = "release" ]; then
    echo ""
    echo "  [3/4] Building Sidecars ..."
    if command -v pwsh &>/dev/null; then
        pwsh -ExecutionPolicy Bypass -File build-all-sidecars.ps1
    elif command -v powershell &>/dev/null; then
        powershell -ExecutionPolicy Bypass -File build-all-sidecars.ps1
    else
        npm run sidecars
    fi

    echo ""
    echo "  [4/4] Building Tauri Release package ..."
    npm run release
else
    echo ""
    echo "  [3/4] Skipping sidecars for standard build..."
    echo "  [4/4] Running application build (tsc + vite) ..."
    npm run build
fi

echo ""
echo "  ========================================"
echo "    LoreReactor Build Successful!"
echo "  ========================================"
echo ""