Write-Host "Creating Tauri binaries directory if missing..." -ForegroundColor Cyan
if (!(Test-Path src-tauri/binaries)) { 
    New-Item -ItemType Directory src-tauri/binaries | Out-Null
}

Write-Host "Building sidecar for Windows (x64)..." -ForegroundColor Yellow
bun build --compile --external vigemclient --external @mapbox/node-pre-gyp --external mock-aws-s3 --external aws-sdk --external nock ./src/backend_src/server.ts --outfile src-tauri/binaries/server-x86_64-pc-windows-msvc.exe

Write-Host "Building sidecar for Linux (x64)..." -ForegroundColor Yellow
bun build --compile --target=bun-linux-x64 --external vigemclient --external @mapbox/node-pre-gyp --external mock-aws-s3 --external aws-sdk --external nock ./src/backend_src/server.ts --outfile src-tauri/binaries/server-x86_64-unknown-linux-gnu

Write-Host "Building sidecar for macOS (Apple Silicon)..." -ForegroundColor Yellow
bun build --compile --target=bun-darwin-arm64 --external vigemclient --external @mapbox/node-pre-gyp --external mock-aws-s3 --external aws-sdk --external nock ./src/backend_src/server.ts --outfile src-tauri/binaries/server-aarch64-apple-darwin

Write-Host "Building sidecar for macOS (Intel)..." -ForegroundColor Yellow
bun build --compile --target=bun-darwin-x64 --external vigemclient --external @mapbox/node-pre-gyp --external mock-aws-s3 --external aws-sdk --external nock ./src/backend_src/server.ts --outfile src-tauri/binaries/server-x86_64-apple-darwin

Write-Host "All cross-platform sidecar binaries successfully compiled!" -ForegroundColor Green