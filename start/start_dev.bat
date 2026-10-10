@echo off
setlocal EnableDelayedExpansion
title LoreReactor

:: ── Navigate to project root (handles root or scripts/ folder) ─
if exist "%~dp0package.json" (
    cd /d "%~dp0"
) else (
    cd /d "%~dp0.."
)
set "ROOT=%CD%"

:: ── Detect Architecture ─────────────────────────────────────
set "WIN_ARCH=x86"
if "%PROCESSOR_ARCHITECTURE%"=="AMD64" set "WIN_ARCH=x64"
if "%PROCESSOR_ARCHITEW6432%"=="AMD64" set "WIN_ARCH=x64"
if "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "WIN_ARCH=arm64"

echo.
echo   ========================================
echo           LoreReactor Launcher
echo           Windows !WIN_ARCH!
echo   ========================================
echo.

:: ── [1/3] Check Node.js ─────────────────────────────────────
echo   [1/3] Checking Node.js ...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   [ERROR] Node.js is NOT installed.
    echo   Download LTS from: https://nodejs.org/en/download
    echo.
    pause
    exit /b 1
)

for /f "tokens=1 delims=v" %%v in ('node -v') do set "NODE_VER=%%v"
for /f "tokens=1 delims=." %%m in ("!NODE_VER!") do set "NODE_MAJOR=%%m"
if !NODE_MAJOR! LSS 18 (
    echo.
    echo   [ERROR] Node.js v!NODE_VER! is too old ^(requires v18+^).
    echo   Update from: https://nodejs.org/en/download
    echo.
    pause
    exit /b 1
)

:: ── [2/3] Verify Project Files ───────────────────────────────
echo   [2/3] Verifying project structure ...
if not exist "package.json" (
    echo   [ERROR] package.json not found in !ROOT!.
    pause
    exit /b 1
)
if not exist "src\backend_src\server.ts" (
    echo   [ERROR] src\backend_src\server.ts not found in !ROOT!.
    pause
    exit /b 1
)

:: ── [3/3] Install / Update Dependencies ─────────────────────
set "NEED_INSTALL=0"
if not exist "node_modules" (
    set "NEED_INSTALL=1"
    echo   [3/3] Installing dependencies ^(first run^) ...
) else (
    for /f %%t in ('powershell -NoProfile -Command "(Get-Item ''package.json'').LastWriteTime -gt (Get-Item ''node_modules'').LastWriteTime"') do (
        if "%%t"=="True" (
            set "NEED_INSTALL=1"
            echo   [3/3] Dependencies outdated — updating ...
        )
    )
)

if "!NEED_INSTALL!"=="1" (
    if exist "package-lock.json" (
        call npm ci
    ) else (
        call npm install
    )
    if !errorlevel! neq 0 (
        echo.
        echo   [ERROR] Dependency installation failed.
        pause
        exit /b 1
    )
) else (
    echo   [3/3] Dependencies up to date.
)

:: ── Launch ──────────────────────────────────────────────────
echo.
echo   ========================================
echo     LoreReactor is starting!
echo.
echo     API Server: http://localhost:8448
echo     Engines   : Managed on-demand in UI
echo.
echo     Press Ctrl + C to stop all servers.
echo   ========================================
echo.

npx concurrently ^
    --kill-others ^
    --kill-signal SIGTERM ^
    --names "WEB,API" ^
    --prefix-colors "cyan,magenta" ^
    "npm run dev"

endlocal
exit /b 0