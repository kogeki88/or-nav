@echo off
title Stop OR-Nav Servers
cd /d "%~dp0"

echo =======================================================
echo    Stopping OR-Nav Clinical Assistant Servers...
echo =======================================================

echo [1/2] Terminating process on port 8000 (FastAPI)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do (
    taskkill /f /pid %%a >nul 2>&1
)

echo [2/2] Terminating process on port 3000 (Next.js)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /f /pid %%a >nul 2>&1
)

echo.
echo [OK] All OR-Nav background server processes terminated.
echo =======================================================
timeout /t 3
exit
