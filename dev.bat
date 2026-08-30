@echo off
echo ========================================
echo   Kurodo Dev Launcher
echo ========================================
echo.

:: Single-server mode — backend serves both API and frontend (dist/)
:: on port 5173.
cd /d %~dp0
call npm start
echo.
echo Server stopped. Press any key to close...
pause >nul
exit /b
