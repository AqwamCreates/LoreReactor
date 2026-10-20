#!/usr/bin/env bash
set -euo pipefail

# ── Navigate to project root ─
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/package.json" ]; then
    cd "$SCRIPT_DIR"
else
    cd "$SCRIPT_DIR/.."
fi
ROOT="$PWD"

OS="Linux"
[[ "$OSTYPE" == "darwin"* ]] && OS="macOS"

echo ""
echo "  ========================================"
echo "          LoreReactor Full Build ($OS)"
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

# ── [2/3] Verify Project Files & Dependencies ────────────────
echo "  [2/3] Verifying dependencies ..."
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

# ── [3/3] Run Full Release / Build Pipeline ─────────────────
echo ""
echo "  [3/3] Running full build and release pipeline ..."
npm run release

echo ""
echo "  ========================================"
echo "    LoreReactor Full Build Successful!"
echo "  ========================================"
echo ""