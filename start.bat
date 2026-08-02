@echo off
setlocal enabledelayedexpansion
title Kurodo - Dev Launcher
color 0B

:: ═══════════════════════════════════════════════════════════════════
::  Kurōdo  ·  Anime + Manga Streaming App
::  One-click launcher — builds, starts server, opens browser
::
::  Flags:  start.bat --build       force rebuild
::          start.bat --no-open     don't open browser
::          start.bat --kill-port   kill process on port before starting
:: ═══════════════════════════════════════════════════════════════════

set "APP_NAME=Kurodo"
set "SERVER_PORT=5173"
set "SERVER_URL=http://localhost:%SERVER_PORT%"
set "NODE_MIN=18"
set "FORCE_BUILD=0"
set "NO_OPEN=0"
set "KILL_PORT=0"

:: ── Parse flags ──────────────────────────────────────────────────
:parse_flags
if "%~1"=="" goto :flags_done
if /i "%~1"=="--build"    set "FORCE_BUILD=1"
if /i "%~1"=="--no-open"   set "NO_OPEN=1"
if /i "%~1"=="--kill-port" set "KILL_PORT=1"
shift
goto :parse_flags
:flags_done

echo.
echo   ╔══════════════════════════════════════════════╗
echo   ║                                              ║
echo   ║      %APP_NAME%                               ║
echo   ║      Anime ^& Manga  ·  Stream ^& Read        ║
echo   ║                                              ║
echo   ╚══════════════════════════════════════════════╝
echo.

:: ── Step 0: Check Node.js ───────────────────────────────────────
echo   [1/6] Checking Node.js...

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo   [FAIL] Node.js is not installed.
    echo.
    echo   Please install Node.js v%NODE_MIN%+ from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

for /f "tokens=1 delims=v." %%a in ('node -v 2^>^&1') do set NODE_MAJOR=%%a
set NODE_MAJOR=%NODE_MAJOR:v=%
if %NODE_MAJOR% lss %NODE_MIN% (
    echo   [WARN] Node.js v%NODE_MAJOR% detected ^(minimum: v%NODE_MIN%^)
) else (
    echo   [ OK ] Node.js v%NODE_MAJOR%
)

:: ── Step 1: cd to script directory ──────────────────────────────
cd /d "%~dp0"

:: ── Step 2: Kill stale port if requested ────────────────────────
if %KILL_PORT% equ 1 (
    echo.
    echo   [2/6] Cleaning port %SERVER_PORT%...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%SERVER_PORT% " ^| findstr "LISTENING" 2^>nul') do (
        echo         Killing PID %%a...
        taskkill /F /PID %%a >nul 2>&1
    )
    echo   [ OK ] Port cleared
) else (
    echo.
    echo   [2/6] Port %SERVER_PORT% — skipping cleanup (use --kill-port to force)
)

:: ── Step 3: Install / update dependencies ───────────────────────
echo.
echo   [3/6] Checking dependencies...

if not exist "node_modules" (
    echo         Installing packages ^(first run — ~30s^)...
    call npm install --silent 2>nul
    if %ERRORLEVEL% neq 0 (
        echo   [FAIL] npm install failed. Try running 'npm install' manually.
        pause
        exit /b 1
    )
    echo   [ OK ] Dependencies installed
) else (
    echo   [ OK ] Dependencies ready
)

:: ── Step 4: .env.local ──────────────────────────────────────────
echo.
echo   [4/6] Checking environment...

if not exist ".env.local" (
    echo         Creating .env.local template...
    (
        echo # AniList API — get credentials at https://anilist.co/settings/developer
        echo VITE_ANILIST_CLIENT_ID=your_client_id_here
        echo ANILIST_CLIENT_SECRET=your_secret_here
        echo.
        echo # HiAnime fallback scraper ^(self-hosted: https://github.com/MSMods-Pro/hianime-api^)
        echo # HIANIME_API_URL=http://localhost:3060
    ) > .env.local
    echo   [ OK ] Created .env.local ^(edit to add your AniList + HiAnime keys^)
) else (
    echo   [ OK ] .env.local found
)

:: ── Step 5: Build ──────────────────────────────────────────────
echo.
echo   [5/6] Building frontend...

set "NEEDS_BUILD=0"
if %FORCE_BUILD% equ 1 set "NEEDS_BUILD=1"
if not exist "dist\index.html" set "NEEDS_BUILD=1"

if %NEEDS_BUILD% equ 1 (
    echo         Building ^(Vite + Workbox PWA^)...
    call npm run build 2>&1
    if %ERRORLEVEL% neq 0 (
        echo   [FAIL] Build failed. Check errors above.
        pause
        exit /b 1
    )
    echo   [ OK ] Build complete
) else (
    echo   [ OK ] Build cached ^(use --build to force rebuild^)
)

:: ── Step 6: Start server ───────────────────────────────────────
echo.
echo   [6/6] Starting %APP_NAME%...
echo.
echo   ═══════════════════════════════════════════════
echo     Anime ^& Manga:   %SERVER_URL%
echo     Press Ctrl+C to stop
echo   ═══════════════════════════════════════════════
echo.

:: Check if curl is available
where curl >nul 2>nul
set "CURL_OK=%ERRORLEVEL%"

:: Check if server is already running
if %CURL_OK% equ 0 (
    curl -s -o NUL -w "%%{http_code}" %SERVER_URL%/api/health 2>nul | findstr "200" >nul
    if !ERRORLEVEL! equ 0 (
        echo   [!] Server already running on %SERVER_URL%
        if %NO_OPEN% equ 0 start "" %SERVER_URL%
        goto :done
    )
)

:: Check if port is in use by something else
netstat -ano 2>nul | findstr ":%SERVER_PORT% " | findstr "LISTENING" >nul
if %ERRORLEVEL% equ 0 (
    echo   [!] Port %SERVER_PORT% is in use by another process.
    echo       Run 'start.bat --kill-port' to force-clear it.
    pause
    exit /b 1
)

:: Launch the server
start /B "" cmd /c "npm start 1>con 2>&1"

:: ── Wait loop with spinner ──────────────────────────────────────
if %CURL_OK% neq 0 (
    echo         curl not available — waiting 25s for startup...
    timeout /t 25 /nobreak >nul
    echo   [ OK ] Server should be ready
    if %NO_OPEN% equ 0 start "" %SERVER_URL%
    goto :done
)

echo         Waiting for server ^(checking /api/health^)...
set "ATTEMPTS=0"

:wait_loop
    timeout /t 2 /nobreak >nul
    curl -s -o NUL -w "%%{http_code}" %SERVER_URL%/api/health 2>nul | findstr "200" >nul
    if !ERRORLEVEL! equ 0 goto :server_ready

    set /a ATTEMPTS+=1

    if !ATTEMPTS! geq 30 (
        echo.
        echo   [FAIL] Server did not start within 60 seconds.
        echo.
        echo   Troubleshooting:
        echo     1. Run 'npm start' manually to see errors
        echo     2. Check if port %SERVER_PORT% is free
        echo     3. Check .env.local for valid credentials
        echo.
        pause
        exit /b 1
    )
    :: Show a dot every 3 attempts (6s) to indicate progress
    set /a MOD=!ATTEMPTS! %% 3
    if !MOD! equ 0 (
        set /p "=." <nul
    )
goto :wait_loop

:server_ready
echo.
echo   [ OK ] Server is ready ^(took ~!ATTEMPTS!x2s^)
echo.
echo   ╔══════════════════════════════════════════════╗
echo   ║   Anime  →  %SERVER_URL%             ║
echo   ║   Manga  →  %SERVER_URL%/manga              ║
echo   ║   Health →  %SERVER_URL%/api/health         ║
echo   ╚══════════════════════════════════════════════╝
echo.

if %NO_OPEN% equ 0 (
    echo         Opening browser...
    start "" %SERVER_URL%
)

:done
echo.
echo   %APP_NAME% is running. Close this window to stop.
echo   Tip: start.bat --no-open  ^|  --build  ^|  --kill-port
echo.
pause
endlocal
