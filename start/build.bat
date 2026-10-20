@echo off
setlocal EnableDelayedExpansion
title LoreReactor Builder

:: ── Navigate to project root (handles root or scripts/ folder) ─
if exist "%~dp0package.json" (
    cd /d "%~dp0"
) else (
    cd /d "%~dp0.."
)
set "ROOT=%CD%"

echo.
echo   ========================================
echo           LoreReactor Build Script
echo   ========================================
echo.

:: ── [1/4] Check Node.js ─────────────────────────────────────
echo   [1/4] Checking Node.js ...
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

:: ── [2/4] Verify Project Files & Dependencies ───────────────
echo   [2/4] Verifying dependencies ...
if not exist "package.json" (
    echo   [ERROR] package.json not found in !ROOT!.
    pause
    exit /b 1
)

set "NEED_INSTALL=0"
if not exist "node_modules" (
    set "NEED_INSTALL=1"
    echo   Installing dependencies ^(first run^) ...
) else (
    for /f %%t in ('powershell -NoProfile -Command "(Get-Item ''package.json'').LastWriteTime -gt (Get-Item ''node_modules'').LastWriteTime"') do (
        if "%%t"=="True" (
            set "NEED_INSTALL=1"
            echo   Dependencies outdated — updating ...
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
    echo   Dependencies up to date.
)

:: ── [3/4 & 4/4] Build Execution ─────────────────────────────
set "MODE=%~1"
if "%MODE%"=="" set "MODE=build"

if /i "%MODE%"=="release" (
    echo.
    echo   [3/4] Building Sidecars ...
    call npm run sidecars
    if !errorlevel! neq 0 (
        echo.
        echo   [ERROR] Sidecar build failed.
        pause
        exit /b 1
    )

    echo.
    echo   [4/4] Building Tauri Release package ...
    call npm run release
) else (
    echo.
    echo   [3/4] Skipping sidecars for standard build...
    echo   [4/4] Running application build ^(tsc + vite^) ...
    call npm run build
)

if !errorlevel! neq 0 (
    echo.
    echo   [ERROR] Build process failed!
    echo.
    pause
    exit /b 1
)

echo.
echo   ========================================
echo     LoreReactor Build Successful!
echo   ========================================
echo.

endlocal
exit /b 0