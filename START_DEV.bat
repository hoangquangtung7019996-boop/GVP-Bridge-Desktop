@echo off
setlocal
cd /d "%~dp0"
color 0B

:MENU
cls
echo =======================================================
echo    GVP BRIDGE - DEVELOPER COMMAND CENTER
echo =======================================================
echo.
echo   [1] 🚀 Start Dev Server (npm run tauri dev)
echo   [2] 🦀 Run Cargo Check (Rust Syntax/Typo Check)
echo   [3] ⚡ Build Frontend (npx vite build)
echo   [4] 🧹 Clean Rust Cache (cargo clean)
echo   [0] ❌ Exit
echo.
set /p choice="Select an option (0-4): "

if "%choice%"=="1" goto DEV
if "%choice%"=="2" goto CHECK
if "%choice%"=="3" goto VITE
if "%choice%"=="4" goto CLEAN
if "%choice%"=="0" exit

goto MENU

:DEV
echo.
echo 🚀 Starting GVP Bridge Developer Environment...
echo ⚡ Hot-Reloading active for UI changes.
echo 🦀 Incremental compilation active for Rust changes.
:: Added 'call' here so the script doesn't exit when npm finishes/crashes
call npm run tauri dev
if %errorlevel% neq 0 (
    echo ❌ Error: Failed to start. Make sure Node.js and Rust are installed.
)
pause
goto MENU

:CHECK
echo.
echo 🦀 Running Cargo Check...
cd src-tauri
cargo check
cd ..
pause
goto MENU

:VITE
echo.
echo ⚡ Building SolidJS Frontend...
:: Added 'call' here as well
call npx vite build
pause
goto MENU

:CLEAN
echo.
echo 🧹 Cleaning Rust build cache...
cd src-tauri
cargo clean
cd ..
echo ✅ Clean complete!
pause
goto MENU