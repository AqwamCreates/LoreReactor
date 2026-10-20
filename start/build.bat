@echo off
setlocal EnableDelayedExpansion
title LoreReactor Builder

:: ── Navigate to project root ─
if exist "%~dp0package.json" (
    cd /d "%~dp0"
) else (
    cd /d "%~dp0.."
)
set "ROOT=%CD%"

echo.
echo   ========================================
echo           LoreReactor Full Build
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

:: ── [2/3] Verify Project Files & Dependencies ───────────────
echo   [2/3] Verifying dependencies ...
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

:: ── [3/3] Run Full Release / Build Pipeline ─────────────────
echo.
echo   [3/3] Running full build and release pipeline ...
call npm run release

if %errorlevel% neq 0 (
    echo.
    echo   [ERROR] Build/Release failed!
    echo.
    pause
    exit /b 1
)

echo.
echo   ========================================
echo     LoreReactor Full Build Successful!
echo   ========================================
echo.

endlocal
exit /b 0