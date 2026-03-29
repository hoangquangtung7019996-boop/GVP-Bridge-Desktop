@echo off
setlocal
cd /d "%~dp0"

echo 🚀 Starting GVP Bridge Developer Environment...
echo ⚡ Hot-Reloading active for UI changes.
echo 🦀 Incremental compilation active for Rust changes.
echo.

npm run tauri dev

if %errorlevel% neq 0 (
    echo.
    echo ❌ Error: Failed to start. Make sure Node.js and Rust are installed.
    pause
)
