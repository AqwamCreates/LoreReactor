@echo off
setlocal EnableDelayedExpansion
title LoreReactor

:: ============================================================
::  LoreReactor — One-Click Launcher + Backend Installer (Windows)
::  Double-click this file. No VS Code required.
:: ============================================================

:: ── Navigate to the project root (one level above this script) ─
cd /d "%~dp0.."
set "ROOT=%CD%"
set "BACKENDS_DIR=%ROOT%\local_backends"

:: ── Detect Windows architecture ─────────────────────────────
:: PROCESSOR_ARCHITECTURE = AMD64 on 64-bit, x86 on 32-bit
:: PROCESSOR_ARCHITEW6432 = AMD64 when a 32-bit process runs on 64-bit OS
set "WIN_ARCH=x86"
if "%PROCESSOR_ARCHITECTURE%"=="AMD64" set "WIN_ARCH=x64"
if "%PROCESSOR_ARCHITEW6432%"=="AMD64" set "WIN_ARCH=x64"
if "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "WIN_ARCH=arm64"

:: ── Banner ──────────────────────────────────────────────────
echo.
echo   ========================================
echo           LoreReactor Launcher
echo           Windows !WIN_ARCH!
echo   ========================================
echo.

:: ── [1/4] Check Node.js ─────────────────────────────────────
echo   [1/4] Checking Node.js ...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   [ERROR] Node.js is NOT installed.
    echo.
    echo   LoreReactor requires Node.js v18 or newer.
    echo   Download it from:
    echo   https://nodejs.org/en/download
    echo.
    echo   Choose the "LTS" installer and run it.
    echo   After installing, close this window and
    echo   double-click start.bat again.
    echo.
    pause
    exit /b 1
)

for /f "tokens=1 delims=v" %%v in ('node -v') do set "NODE_VER=%%v"
for /f "tokens=1 delims=." %%m in ("!NODE_VER!") do set "NODE_MAJOR=%%m"
if !NODE_MAJOR! LSS 18 (
    echo.
    echo   [ERROR] Node.js v!NODE_VER! is too old ^(need v18+^).
    echo   Update from: https://nodejs.org/en/download
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node -v') do set "NV=%%v"
for /f "delims=" %%v in ('npm -v')  do set "NPV=%%v"
echo   [OK] Node !NV!  ·  npm !NPV!  ·  Windows !WIN_ARCH!

:: ── [2/4] Verify project files ───────────────────────────────
echo   [2/4] Verifying project files ...
if not exist "package.json" (
    echo   [ERROR] package.json not found.
    echo   Run start.bat from the LoreReactor root folder.
    echo.
    pause
    exit /b 1
)
if not exist "src\server.ts" (
    echo   [ERROR] src\server.ts not found.
    echo   Run start.bat from the LoreReactor root folder.
    echo.
    pause
    exit /b 1
)
echo   [OK] Project files OK

:: ── [3/4] Install dependencies ───────────────────────────────
set "NEED_INSTALL=0"
if not exist "node_modules" (
    set "NEED_INSTALL=1"
    echo   [3/4] First run — installing dependencies ^(this may take a minute^) ...
) else (
    for /f %%t in ('powershell -NoProfile -Command "(Get-Item ''package.json'').LastWriteTime -gt (Get-Item ''node_modules'').LastWriteTime"') do (
        if "%%t"=="True" (
            set "NEED_INSTALL=1"
            echo   [3/4] Dependencies outdated — updating ...
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
        echo   Check your internet connection and try again.
        echo.
        pause
        exit /b 1
    )
    echo   [OK] Dependencies ready
) else (
    echo   [3/4] [OK] Dependencies up to date — skipping install
)

:: ============================================================
::  MAIN MENU
:: ============================================================
:MAIN_MENU
echo.
echo   ========================================
echo   What would you like to do?
echo   ========================================
echo.
echo     [1] Start LoreReactor
echo     [2] Install / manage local inference backends
echo     [3] Exit
echo.
set /p "CHOICE=  Enter choice [1-3]: "

if "!CHOICE!"=="1" goto LAUNCH
if "!CHOICE!"=="2" goto BACKEND_MENU
if "!CHOICE!"=="3" goto EOF
echo   [WARN] Invalid choice. Try again.
goto MAIN_MENU

:: ============================================================
::  LAUNCH
:: ============================================================
:LAUNCH
echo.
echo   ========================================
echo     LoreReactor is starting!
echo.
echo     Web UI    : http://localhost:4444
echo     API Server: http://localhost:8448
echo.
echo     Press Ctrl + C to stop all servers.
echo     Closing this window also stops everything.
echo   ========================================
echo.

npx concurrently ^
    --kill-others ^
    --kill-signal SIGTERM ^
    --names "WEB,API" ^
    --prefix-colors "cyan,magenta" ^
    "npm run dev" ^
    "npm run server"

goto EOF

:: ============================================================
::  BACKEND MENU
:: ============================================================
:BACKEND_MENU
echo.
echo   ========================================
echo   Local Inference Backends  ^(Windows !WIN_ARCH!^)
echo   ========================================
echo.
echo     [1]  Llama.cpp          — GGUF models, CPU/CUDA/Vulkan
echo     [2]  Ollama             — easiest setup, broad model support
echo     [3]  vLLM               — high-throughput, NVIDIA GPU
echo     [4]  ExLlamaV2          — EXL2 quantized models, fast single GPU
echo     [5]  ExLlamaV3          — latest ExLlama, EXL3 format
echo     [6]  ExLlamaV3 HF       — ExLlamaV3 with HuggingFace models
echo     [7]  SGLang             — RadixAttention, structured generation
echo     [8]  mistral.rs         — Rust-based, no Python needed
echo     [9]  LM Studio          — GUI app + lms CLI
echo     [10] LocalAI            — multi-modal OpenAI replacement ^(WSL^)
echo     [11] TensorRT-LLM       — NVIDIA Triton ^(Docker required^)
echo     [12] Transformers/TGI  — HuggingFace TGI ^(Docker required^)
echo     [0]  Back to main menu
echo.
set /p "BCHOICE=  Enter choice [0-12]: "

if "!BCHOICE!"=="0"  goto MAIN_MENU
if "!BCHOICE!"=="1"  goto INSTALL_LLAMACPP
if "!BCHOICE!"=="2"  goto INSTALL_OLLAMA
if "!BCHOICE!"=="3"  goto INSTALL_VLLM
if "!BCHOICE!"=="4"  goto INSTALL_EXLLAMAV2
if "!BCHOICE!"=="5"  goto INSTALL_EXLLAMAV3
if "!BCHOICE!"=="6"  goto INSTALL_EXLLAMAV3HF
if "!BCHOICE!"=="7"  goto INSTALL_SGLANG
if "!BCHOICE!"=="8"  goto INSTALL_MISTRALRS
if "!BCHOICE!"=="9"  goto INSTALL_LMSTUDIO
if "!BCHOICE!"=="10" goto INSTALL_LOCALAI
if "!BCHOICE!"=="11" goto INSTALL_TENSORRT
if "!BCHOICE!"=="12" goto INSTALL_TGI
echo   [WARN] Invalid choice.
goto BACKEND_MENU

:: ============================================================
::  [1] Llama.cpp
::  Uses WIN_ARCH to pick the correct x64 or x86 asset.
::  llama.cpp only publishes x64 Windows builds officially.
::  x86 (32-bit) is not published — we warn the user.
:: ============================================================
:INSTALL_LLAMACPP
echo.
echo   --- Installing Llama.cpp ---
echo.

:: 32-bit guard — llama.cpp does not ship Win32 binaries
if "!WIN_ARCH!"=="x86" (
    echo   [WARN] You are running 32-bit Windows.
    echo   llama.cpp does not publish official 32-bit Windows binaries.
    echo   You would need to build from source:
    echo   https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md
    echo.
    echo   Alternatively, use Ollama which supports 32-bit via its own runtime.
    echo.
    pause
    goto BACKEND_MENU
)

echo   This will download the latest Llama.cpp Windows !WIN_ARCH! build.
echo.
set /p "LLAMA_CONFIRM=  Continue? [Y/n]: "
if /i "!LLAMA_CONFIRM!"=="n" goto BACKEND_MENU

echo   [..] Fetching latest release info ...
for /f "delims=" %%t in ('powershell -NoProfile -Command "(Invoke-RestMethod -Uri ''https://api.github.com/repos/ggml-org/llama.cpp/releases/latest'').tag_name"') do set "LLAMA_TAG=%%t"

if "!LLAMA_TAG!"=="" (
    echo   [ERROR] Could not fetch latest release. Check your internet connection.
    echo   Or download manually from: https://github.com/ggml-org/llama.cpp/releases
    pause
    goto BACKEND_MENU
)

echo   [OK] Latest release: !LLAMA_TAG!

:: Build the arch suffix used in the asset filename
:: llama.cpp assets use "x64" in the filename for 64-bit Windows
set "LLAMA_WIN_ARCH_SUFFIX=x64"
if "!WIN_ARCH!"=="arm64" set "LLAMA_WIN_ARCH_SUFFIX=arm64"

echo.
echo   Which build variant?
if "!WIN_ARCH!"=="arm64" (
    echo     [1] Vulkan    — ARM64 GPU acceleration
    echo     [2] CPU only  — no GPU acceleration
    echo.
    set /p "LLAMA_VARIANT=  Enter choice [1-2]: "
    if "!LLAMA_VARIANT!"=="1" set "LLAMA_ZIP=llama-!LLAMA_TAG:-=_!-bin-win-vulkan-!LLAMA_WIN_ARCH_SUFFIX!.zip"
    if "!LLAMA_VARIANT!"=="2" set "LLAMA_ZIP=llama-!LLAMA_TAG:-=_!-bin-win-avx2-!LLAMA_WIN_ARCH_SUFFIX!.zip"
    if "!LLAMA_ZIP!"=="" (
        echo   [WARN] Invalid choice. Defaulting to CPU.
        set "LLAMA_ZIP=llama-!LLAMA_TAG:-=_!-bin-win-avx2-!LLAMA_WIN_ARCH_SUFFIX!.zip"
    )
) else (
    echo     [1] CUDA 12   — NVIDIA GPU ^(recommended if you have one^)
    echo     [2] Vulkan    — AMD / Intel / NVIDIA GPU
    echo     [3] CPU only  — no GPU acceleration
    echo.
    set /p "LLAMA_VARIANT=  Enter choice [1-3]: "
    if "!LLAMA_VARIANT!"=="1" set "LLAMA_ZIP=llama-!LLAMA_TAG:-=_!-bin-win-cuda-cu12.4.0-!LLAMA_WIN_ARCH_SUFFIX!.zip"
    if "!LLAMA_VARIANT!"=="2" set "LLAMA_ZIP=llama-!LLAMA_TAG:-=_!-bin-win-vulkan-!LLAMA_WIN_ARCH_SUFFIX!.zip"
    if "!LLAMA_VARIANT!"=="3" set "LLAMA_ZIP=llama-!LLAMA_TAG:-=_!-bin-win-avx2-!LLAMA_WIN_ARCH_SUFFIX!.zip"
    if "!LLAMA_ZIP!"=="" (
        echo   [WARN] Invalid choice. Defaulting to CPU.
        set "LLAMA_ZIP=llama-!LLAMA_TAG:-=_!-bin-win-avx2-!LLAMA_WIN_ARCH_SUFFIX!.zip"
    )
)

set "LLAMA_URL=https://github.com/ggml-org/llama.cpp/releases/download/!LLAMA_TAG!/!LLAMA_ZIP!"
set "LLAMA_DEST=%BACKENDS_DIR%\llama"
set "LLAMA_TMP=%TEMP%\lorereactor_llama.zip"

echo   [..] Downloading !LLAMA_ZIP! ...
echo        URL: !LLAMA_URL!
powershell -NoProfile -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '!LLAMA_URL!' -OutFile '!LLAMA_TMP!' -UseBasicParsing }"

if not exist "!LLAMA_TMP!" (
    echo   [ERROR] Download failed. The release asset name may have changed.
    echo   Download manually from: https://github.com/ggml-org/llama.cpp/releases
    pause
    goto BACKEND_MENU
)

echo   [..] Extracting to !LLAMA_DEST! ...
if not exist "!LLAMA_DEST!" mkdir "!LLAMA_DEST!"
powershell -NoProfile -Command "Expand-Archive -Path '!LLAMA_TMP!' -DestinationPath '!LLAMA_DEST!' -Force"
del "!LLAMA_TMP!" 2>nul

set "LLAMA_SERVER_FOUND=0"
for /r "!LLAMA_DEST!" %%f in (llama-server.exe) do (
    set "LLAMA_SERVER_FOUND=1"
    set "LLAMA_SERVER_PATH=%%f"
)

if "!LLAMA_SERVER_FOUND!"=="0" (
    echo   [WARN] llama-server.exe not found in extracted files.
    echo   The release structure may have changed. Check !LLAMA_DEST! manually.
    pause
    goto BACKEND_MENU
)

echo   [OK] Llama.cpp installed at: !LLAMA_DEST!
echo   [OK] Found: !LLAMA_SERVER_PATH!
echo.
echo   NOTE: server.ts expects llama-server.exe directly inside
echo         local_backends\llama\. If it is in a subfolder, move it up.
echo.
pause
goto BACKEND_MENU

:: ============================================================
::  [2] Ollama
:: ============================================================
:INSTALL_OLLAMA
echo.
echo   --- Installing Ollama ---
echo.
echo   This will run the official Ollama Windows installer script.
echo   Ollama will be installed to your user directory.
echo   A copy of ollama.exe will be placed in local_backends\ollama\.
echo.
set /p "OLLAMA_CONFIRM=  Continue? [Y/n]: "
if /i "!OLLAMA_CONFIRM!"=="n" goto BACKEND_MENU

echo   [..] Running official Ollama installer ...
powershell -NoProfile -Command "irm https://ollama.com/install.ps1 | iex"

if %errorlevel% neq 0 (
    echo   [ERROR] Ollama installation failed.
    echo   Try downloading manually from: https://ollama.com/download/windows
    pause
    goto BACKEND_MENU
)

set "OLLAMA_EXE="
if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" (
    set "OLLAMA_EXE=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
) else (
    where ollama >nul 2>&1
    if !errorlevel! equ 0 (
        for /f "delims=" %%p in ('where ollama') do set "OLLAMA_EXE=%%p"
    )
)

if "!OLLAMA_EXE!"=="" (
    echo   [WARN] ollama.exe not found automatically.
    echo   Please locate it manually and copy to:
    echo   %BACKENDS_DIR%\ollama\ollama.exe
    pause
    goto BACKEND_MENU
)

set "OLLAMA_DEST=%BACKENDS_DIR%\ollama"
if not exist "!OLLAMA_DEST!" mkdir "!OLLAMA_DEST!"
copy /Y "!OLLAMA_EXE!" "!OLLAMA_DEST!\ollama.exe" >nul

echo   [OK] Ollama installed.
echo   [OK] Copied to: !OLLAMA_DEST!\ollama.exe
echo.
pause
goto BACKEND_MENU

:: ============================================================
::  [3] vLLM
:: ============================================================
:INSTALL_VLLM
echo.
echo   --- Installing vLLM ---
echo.
echo   Requirements:
echo     - Python 3.10 or newer installed and on PATH
echo     - NVIDIA GPU with CUDA 11.8+ ^(strongly recommended^)
echo     - 64-bit Windows ^(vLLM does not support 32-bit^)
echo.

if "!WIN_ARCH!"=="x86" (
    echo   [ERROR] vLLM requires 64-bit Windows. You are running 32-bit.
    echo   See: https://docs.vllm.ai/en/latest/getting_started/installation.html
    pause
    goto BACKEND_MENU
)

set /p "VLLM_CONFIRM=  Continue? [Y/n]: "
if /i "!VLLM_CONFIRM!"=="n" goto BACKEND_MENU

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Python not found on PATH.
    echo   Install Python 3.10+ from https://www.python.org/downloads/
    echo   Make sure to check "Add Python to PATH" during installation.
    pause
    goto BACKEND_MENU
)

for /f "delims=" %%v in ('python --version 2^>^&1') do set "PYVER=%%v"
echo   [OK] Found: !PYVER!

set "VLLM_DEST=%BACKENDS_DIR%\vllm"
if not exist "!VLLM_DEST!" mkdir "!VLLM_DEST!"

echo   [..] Creating Python virtual environment ...
python -m venv "!VLLM_DEST!\venv"
if %errorlevel% neq 0 (
    echo   [ERROR] Failed to create virtual environment.
    pause
    goto BACKEND_MENU
)

echo   [..] Installing vllm ^(this may take several minutes^) ...
"!VLLM_DEST!\venv\Scripts\python.exe" -m pip install --upgrade pip >nul
"!VLLM_DEST!\venv\Scripts\python.exe" -m pip install vllm

if %errorlevel% neq 0 (
    echo   [ERROR] vllm installation failed.
    echo   If you do not have an NVIDIA GPU, vLLM may not work.
    echo   See: https://docs.vllm.ai/en/latest/getting_started/installation.html
    pause
    goto BACKEND_MENU
)

copy /Y "!VLLM_DEST!\venv\Scripts\python.exe" "!VLLM_DEST!\python.exe" >nul 2>&1

echo   [OK] vLLM installed at: !VLLM_DEST!
echo   [OK] Python executable: !VLLM_DEST!\venv\Scripts\python.exe
echo.
pause
goto BACKEND_MENU

:: ============================================================
::  [4] ExLlamaV2 via TabbyAPI
:: ============================================================
:INSTALL_EXLLAMAV2
echo.
echo   --- Installing ExLlamaV2 ^(TabbyAPI^) ---
echo.
echo   Requirements:
echo     - Python 3.10+ on PATH
echo     - NVIDIA GPU with CUDA 11.8+ ^(required^)
echo     - Git on PATH
echo     - 64-bit Windows
echo.

if "!WIN_ARCH!"=="x86" (
    echo   [ERROR] ExLlamaV2 requires 64-bit Windows.
    pause
    goto BACKEND_MENU
)

set /p "EXL2_CONFIRM=  Continue? [Y/n]: "
if /i "!EXL2_CONFIRM!"=="n" goto BACKEND_MENU

where git >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Git not found on PATH.
    echo   Install from: https://git-scm.com/download/win
    pause
    goto BACKEND_MENU
)

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Python not found on PATH.
    echo   Install Python 3.10+ from https://www.python.org/downloads/
    pause
    goto BACKEND_MENU
)

set "EXL2_DEST=%BACKENDS_DIR%\exllamav2"

if exist "!EXL2_DEST!\tabbyAPI" (
    echo   [..] Existing install found. Pulling latest changes ...
    cd /d "!EXL2_DEST!\tabbyAPI"
    git pull
    cd /d "%ROOT%"
) else (
    echo   [..] Cloning TabbyAPI ...
    if not exist "!EXL2_DEST!" mkdir "!EXL2_DEST!"
    git clone https://github.com/theroyallab/tabbyAPI.git "!EXL2_DEST!\tabbyAPI"
    if %errorlevel% neq 0 (
        echo   [ERROR] Git clone failed. Check your internet connection.
        pause
        goto BACKEND_MENU
    )
)

echo   [..] Setting up Python environment and installing dependencies ...
cd /d "!EXL2_DEST!\tabbyAPI"

if exist "start.bat" (
    echo   [..] Running TabbyAPI start.bat ^(let deps install, then Ctrl + C to stop^) ...
    call start.bat
) else (
    python -m venv venv
    call venv\Scripts\activate.bat
    pip install --upgrade pip >nul
    pip install -r requirements.txt
    call deactivate
)

cd /d "%ROOT%"

if exist "!EXL2_DEST!\tabbyAPI\venv\Scripts\python.exe" (
    copy /Y "!EXL2_DEST!\tabbyAPI\venv\Scripts\python.exe" "!EXL2_DEST!\python.exe" >nul 2>&1
)
if exist "!EXL2_DEST!\tabbyAPI\start.py" (
    copy /Y "!EXL2_DEST!\tabbyAPI\start.py" "!EXL2_DEST!\start.py" >nul 2>&1
)

echo   [OK] ExLlamaV2 installed at: !EXL2_DEST!
echo.
pause
goto BACKEND_MENU

:: ============================================================
::  [5] ExLlamaV3 via TabbyAPI
:: ============================================================
:INSTALL_EXLLAMAV3
echo.
echo   --- Installing ExLlamaV3 ^(TabbyAPI^) ---
echo.

if "!WIN_ARCH!"=="x86" (
    echo   [ERROR] ExLlamaV3 requires 64-bit Windows.
    pause
    goto BACKEND_MENU
)

set /p "EXL3_CONFIRM=  Continue? [Y/n]: "
if /i "!EXL3_CONFIRM!"=="n" goto BACKEND_MENU

where git >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Git not found. Install from: https://git-scm.com/download/win
    pause
    goto BACKEND_MENU
)

set "EXL3_DEST=%BACKENDS_DIR%\exllamav3"

if exist "!EXL3_DEST!\tabbyAPI" (
    echo   [..] Existing install found. Pulling latest ...
    cd /d "!EXL3_DEST!\tabbyAPI"
    git pull
    cd /d "%ROOT%"
) else (
    echo   [..] Cloning TabbyAPI ...
    if not exist "!EXL3_DEST!" mkdir "!EXL3_DEST!"
    git clone https://github.com/theroyallab/tabbyAPI.git "!EXL3_DEST!\tabbyAPI"
)

echo   [..] Installing dependencies ...
cd /d "!EXL3_DEST!\tabbyAPI"
if exist "start.bat" (
    echo   Let deps install, then Ctrl + C to stop the server.
    call start.bat
) else (
    python -m venv venv
    call venv\Scripts\activate.bat
    pip install --upgrade pip >nul
    pip install -r requirements.txt
    call deactivate
)
cd /d "%ROOT%"

if exist "!EXL3_DEST!\tabbyAPI\venv\Scripts\python.exe" (
    copy /Y "!EXL3_DEST!\tabbyAPI\venv\Scripts\python.exe" "!EXL3_DEST!\python.exe" >nul 2>&1
)
if exist "!EXL3_DEST!\tabbyAPI\start.py" (
    copy /Y "!EXL3_DEST!\tabbyAPI\start.py" "!EXL3_DEST!\start.py" >nul 2>&1
)

echo   [OK] ExLlamaV3 installed at: !EXL3_DEST!
echo.
pause
goto BACKEND_MENU

:: ============================================================
::  [6] ExLlamaV3 HF
:: ============================================================
:INSTALL_EXLLAMAV3HF
echo.
echo   --- Installing ExLlamaV3 HF ^(TabbyAPI^) ---
echo.

if "!WIN_ARCH!"=="x86" (
    echo   [ERROR] ExLlamaV3 HF requires 64-bit Windows.
    pause
    goto BACKEND_MENU
)

set /p "EXL3HF_CONFIRM=  Continue? [Y/n]: "
if /i "!EXL3HF_CONFIRM!"=="n" goto BACKEND_MENU

where git >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Git not found. Install from: https://git-scm.com/download/win
    pause
    goto BACKEND_MENU
)

set "EXL3HF_DEST=%BACKENDS_DIR%\exllamav3_hf"

if exist "!EXL3HF_DEST!\tabbyAPI" (
    echo   [..] Existing install found. Pulling latest ...
    cd /d "!EXL3HF_DEST!\tabbyAPI"
    git pull
    cd /d "%ROOT%"
) else (
    echo   [..] Cloning TabbyAPI ...
    if not exist "!EXL3HF_DEST!" mkdir "!EXL3HF_DEST!"
    git clone https://github.com/theroyallab/tabbyAPI.git "!EXL3HF_DEST!\tabbyAPI"
)

echo   [..] Installing dependencies ...
cd /d "!EXL3HF_DEST!\tabbyAPI"
if exist "start.bat" (
    echo   Let deps install, then Ctrl + C to stop the server.
    call start.bat
) else (
    python -m venv venv
    call venv\Scripts\activate.bat
    pip install --upgrade pip >nul
    pip install -r requirements.txt
    call deactivate
)
cd /d "%ROOT%"

if exist "!EXL3HF_DEST!\tabbyAPI\venv\Scripts\python.exe" (
    copy /Y "!EXL3HF_DEST!\tabbyAPI\venv\Scripts\python.exe" "!EXL3HF_DEST!\python.exe" >nul 2>&1
)
if exist "!EXL3HF_DEST!\tabbyAPI\start.py" (
    copy /Y "!EXL3HF_DEST!\tabbyAPI\start.py" "!EXL3HF_DEST!\start.py" >nul 2>&1
)

echo   [OK] ExLlamaV3 HF installed at: !EXL3HF_DEST!
echo.
pause
goto BACKEND_MENU

:: ============================================================
::  [7] SGLang
:: ============================================================
:INSTALL_SGLANG
echo.
echo   --- Installing SGLang ---
echo.
echo   Requirements:
echo     - Python 3.10+ on PATH
echo     - NVIDIA GPU recommended
echo     - 64-bit Windows
echo.

if "!WIN_ARCH!"=="x86" (
    echo   [ERROR] SGLang requires 64-bit Windows.
    pause
    goto BACKEND_MENU
)

set /p "SGLANG_CONFIRM=  Continue? [Y/n]: "
if /i "!SGLANG_CONFIRM!"=="n" goto BACKEND_MENU

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Python not found. Install from https://www.python.org/downloads/
    pause
    goto BACKEND_MENU
)

set "SGLANG_DEST=%BACKENDS_DIR%\sglang"
if not exist "!SGLANG_DEST!" mkdir "!SGLANG_DEST!"

echo   [..] Creating Python virtual environment ...
python -m venv "!SGLANG_DEST!\venv"

echo   [..] Installing sglang[srt] ^(this may take several minutes^) ...
"!SGLANG_DEST!\venv\Scripts\python.exe" -m pip install --upgrade pip >nul
"!SGLANG_DEST!\venv\Scripts\python.exe" -m pip install "sglang[srt]"

if %errorlevel% neq 0 (
    echo   [ERROR] SGLang installation failed.
    echo   See: https://docs.sglang.ai/get_started/install.html
    pause
    goto BACKEND_MENU
)

copy /Y "!SGLANG_DEST!\venv\Scripts\python.exe" "!SGLANG_DEST!\python.exe" >nul 2>&1

echo   [OK] SGLang installed at: !SGLANG_DEST!
echo.
pause
goto BACKEND_MENU

:: ============================================================
::  [8] mistral.rs
::  Uses WIN_ARCH to select the correct binary asset.
:: ============================================================
:INSTALL_MISTRALRS
echo.
echo   --- Installing mistral.rs ---
echo.

:: mistral.rs only ships x64 Windows binaries
if "!WIN_ARCH!"=="x86" (
    echo   [WARN] You are running 32-bit Windows.
    echo   mistral.rs does not publish 32-bit Windows binaries.
    echo   You would need to build from source:
    echo   https://github.com/EricLBuehler/mistral.rs
    echo.
    pause
    goto BACKEND_MENU
)

set /p "MRS_CONFIRM=  Continue? [Y/n]: "
if /i "!MRS_CONFIRM!"=="n" goto BACKEND_MENU

echo   [..] Fetching latest release info ...
for /f "delims=" %%t in ('powershell -NoProfile -Command "(Invoke-RestMethod -Uri ''https://api.github.com/repos/EricLBuehler/mistral.rs/releases/latest'').tag_name"') do set "MRS_TAG=%%t"

if "!MRS_TAG!"=="" (
    echo   [ERROR] Could not fetch latest release.
    echo   Download manually from: https://github.com/EricLBuehler/mistral.rs/releases
    pause
    goto BACKEND_MENU
)

echo   [OK] Latest release: !MRS_TAG!

:: Map WIN_ARCH to the Rust target triple used in asset filenames
set "MRS_TARGET=x86_64-pc-windows-msvc"
if "!WIN_ARCH!"=="arm64" set "MRS_TARGET=aarch64-pc-windows-msvc"

echo.
echo   Which build?
echo     [1] CUDA  — NVIDIA GPU
echo     [2] CPU   — no GPU
echo.
set /p "MRS_VARIANT=  Enter choice [1-2]: "

if "!MRS_VARIANT!"=="1" set "MRS_ASSET=mistralrs-server-!MRS_TARGET!-cuda.exe"
if "!MRS_VARIANT!"=="2" set "MRS_ASSET=mistralrs-server-!MRS_TARGET!.exe"

if "!MRS_ASSET!"=="" (
    echo   [WARN] Invalid choice. Defaulting to CPU.
    set "MRS_ASSET=mistralrs-server-!MRS_TARGET!.exe"
)

set "MRS_URL=https://github.com/EricLBuehler/mistral.rs/releases/download/!MRS_TAG!/!MRS_ASSET!"
set "MRS_DEST=%BACKENDS_DIR%\mistral-rs"
set "MRS_TMP=%TEMP%\lorereactor_mistralrs.exe"

if not exist "!MRS_DEST!" mkdir "!MRS_DEST!"

echo   [..] Downloading !MRS_ASSET! ...
powershell -NoProfile -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '!MRS_URL!' -OutFile '!MRS_TMP!' -UseBasicParsing }"

if not exist "!MRS_TMP!" (
    echo   [ERROR] Download failed. Asset name may have changed.
    echo   Download manually from: https://github.com/EricLBuehler/mistral.rs/releases
    pause
    goto BACKEND_MENU
)

move /Y "!MRS_TMP!" "!MRS_DEST!\mistralrs-server.exe" >nul

echo   [OK] mistral.rs installed at: !MRS_DEST!\mistralrs-server.exe
echo.
pause
goto BACKEND_MENU

:: ============================================================
::  [9] LM Studio
:: ============================================================
:INSTALL_LMSTUDIO
echo.
echo   --- Installing LM Studio ---
echo.
echo   This will run the official LM Studio Windows installer.
echo   LM Studio is a GUI application that includes the lms CLI.
echo   After installation, the lms binary will be located and
echo   linked into local_backends\lmstudio\.
echo.
set /p "LMS_CONFIRM=  Continue? [Y/n]: "
if /i "!LMS_CONFIRM!"=="n" goto BACKEND_MENU

echo   [..] Running official LM Studio installer ...
powershell -NoProfile -Command "irm https://lmstudio.ai/install.ps1 | iex"

set "LMS_EXE="
if exist "%LOCALAPPDATA%\Programs\LM Studio\resources\lms.exe" (
    set "LMS_EXE=%LOCALAPPDATA%\Programs\LM Studio\resources\lms.exe"
) else if exist "%LOCALAPPDATA%\Programs\lm-studio\resources\lms.exe" (
    set "LMS_EXE=%LOCALAPPDATA%\Programs\lm-studio\resources\lms.exe"
) else (
    where lms >nul 2>&1
    if !errorlevel! equ 0 (
        for /f "delims=" %%p in ('where lms') do set "LMS_EXE=%%p"
    )
)

set "LMS_DEST=%BACKENDS_DIR%\lmstudio"
if not exist "!LMS_DEST!" mkdir "!LMS_DEST!"

if "!LMS_EXE!"=="" (
    echo   [WARN] lms.exe not found automatically.
    echo   After LM Studio finishes installing, locate lms.exe and copy to:
    echo   !LMS_DEST!\lms.exe
    echo.
    echo   You can also try: npx lmstudio install-cli
    pause
    goto BACKEND_MENU
)

copy /Y "!LMS_EXE!" "!LMS_DEST!\lms.exe" >nul
echo   [OK] LM Studio lms linked at: !LMS_DEST!\lms.exe
echo.
pause
goto BACKEND_MENU

:: ============================================================
::  [10] LocalAI — WSL only on Windows
:: ============================================================
:INSTALL_LOCALAI
echo.
echo   --- Installing LocalAI ---
echo.
echo   WARNING: LocalAI does not provide a native Windows binary.
echo   It must be run via WSL ^(Windows Subsystem for Linux^).
echo.
echo   If you have WSL2 installed, this will download the Linux
echo   binary into local_backends\localai\ and you can run it
echo   from within WSL.
echo.
echo   Alternatively, use Docker:
echo     docker run -p 8080:8080 --name localai localai/localai:latest
echo.
set /p "LOCAI_CONFIRM=  Continue with WSL binary download? [Y/n]: "
if /i "!LOCAI_CONFIRM!"=="n" goto BACKEND_MENU

echo   [..] Fetching latest LocalAI release ...
for /f "delims=" %%t in ('powershell -NoProfile -Command "(Invoke-RestMethod -Uri ''https://api.github.com/repos/mudler/LocalAI/releases/latest'').tag_name"') do set "LOCAI_TAG=%%t"

if "!LOCAI_TAG!"=="" (
    echo   [ERROR] Could not fetch release info.
    echo   Download manually from: https://github.com/mudler/LocalAI/releases
    pause
    goto BACKEND_MENU
)

set "LOCAI_URL=https://github.com/mudler/LocalAI/releases/download/!LOCAI_TAG!/local-ai-Linux-x86_64"
set "LOCAI_DEST=%BACKENDS_DIR%\localai"
set "LOCAI_TMP=%TEMP%\lorereactor_localai"

if not exist "!LOCAI_DEST!" mkdir "!LOCAI_DEST!"

echo   [..] Downloading LocalAI Linux binary ...
powershell -NoProfile -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '!LOCAI_URL!' -OutFile '!LOCAI_TMP!' -UseBasicParsing }"

if not exist "!LOCAI_TMP!" (
    echo   [ERROR] Download failed.
    echo   Download manually from: https://github.com/mudler/LocalAI/releases
    pause
    goto BACKEND_MENU
)

move /Y "!LOCAI_TMP!" "!LOCAI_DEST!\local-ai" >nul
echo   [OK] LocalAI binary saved to: !LOCAI_DEST!\local-ai
echo   [NOTE] Run this binary from within WSL2, not directly in Windows.
echo.
pause
goto BACKEND_MENU

:: ============================================================
::  [11] TensorRT-LLM — Docker only
:: ============================================================
:INSTALL_TENSORRT
echo.
echo   --- TensorRT-LLM ^(Docker^) ---
echo.
echo   TensorRT-LLM requires Docker with NVIDIA Container Toolkit.
echo   There is no standalone binary install.
echo.
echo   Prerequisites:
echo     1. Docker Desktop installed: https://www.docker.com/products/docker-desktop
echo     2. NVIDIA GPU with driver 525+
echo     3. NVIDIA Container Toolkit configured
echo.
echo   To run TensorRT-LLM with Triton:
echo     docker run --gpus all --rm -p 8080:8000 ^
echo       nvcr.io/nvidia/tritonserver:24.05-trtllm-python-backend
echo.
echo   For full setup instructions see:
echo   https://github.com/triton-inference-server/tensorrtllm_backend
echo.
pause
goto BACKEND_MENU

:: ============================================================
::  [12] Transformers / TGI — Docker only
:: ============================================================
:INSTALL_TGI
echo.
echo   --- HuggingFace Text Generation Inference ^(Docker^) ---
echo.
echo   TGI is distributed as a Docker container.
echo.
echo   Prerequisites:
echo     1. Docker Desktop installed: https://www.docker.com/products/docker-desktop
echo     2. NVIDIA GPU with driver 525+ ^(for GPU acceleration^)
echo.
echo   To run TGI:
echo     docker run --gpus all --shm-size 1g -p 8080:80 ^
echo       ghcr.io/huggingface/text-generation-inference:latest ^
echo       --model-id meta-llama/Llama-3-8B-Instruct
echo.
echo   For full docs see:
echo   https://huggingface.co/docs/text-generation-inference
echo.
pause
goto BACKEND_MENU

:: ============================================================
:EOF
endlocal
exit /b 0