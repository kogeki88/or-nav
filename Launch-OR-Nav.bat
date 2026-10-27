@echo off
title OR-Nav Clinical Assistant Launcher
cd /d "%~dp0"

echo =======================================================
echo    OR-Nav - CVOR Clinical Assistant Launcher
echo =======================================================
echo [1/3] Starting FastAPI Backend on port 8000 + HTTPS Tunnel...
start "OR-Nav Backend" /min cmd /c "cd /d "%~dp0backend" && .\venv\Scripts\activate.bat && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"

echo [2/3] Starting Next.js Production Frontend on port 3000 (0.0.0.0 LAN)...
start "OR-Nav Frontend" /min cmd /c "cd /d "%~dp0frontend" && npm run start -- -H 0.0.0.0 -p 3000"

echo [3/3] Waiting 4 seconds for services and HTTPS tunnel to initialize...
timeout /t 4 /nobreak >nul

echo [OK] Opening OR-Nav in default browser...
start http://localhost:3000

echo =======================================================
echo  OR-Nav is running live!
echo  - Desktop:       http://localhost:3000
echo  - Mobile LAN:    http://192.168.1.217:3000
echo  - HTTPS Tunnel:  Active automatically (Scan QR in top-right)
echo  - Android .apk:  Run Build-Android-APK.bat to compile
echo  - Single Proxy:  Port 3000 proxies /api to Port 8000
echo  To stop all servers, run Stop-OR-Nav.bat
echo =======================================================
timeout /t 5
exit
