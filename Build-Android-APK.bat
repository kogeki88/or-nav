@echo off
title OR-Nav Android APK Builder
cd /d "%~dp0"

echo =======================================================
echo    OR-Nav - Android (.apk) Live-Reload Builder
echo =======================================================
echo.
echo Target Project: frontend\android
echo Live-Reload Server: http://192.168.1.217:3000
echo.

:: 1. Check for Java
where java >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    if not defined JAVA_HOME (
        echo [!] Java Development Kit JDK 17+ was not found in PATH or JAVA_HOME.
        goto :SHOW_INSTRUCTIONS
    )
)

:: 2. Check for Android SDK
if not defined ANDROID_HOME (
    if exist "%LOCALAPPDATA%\Android\Sdk" (
        set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
    ) else (
        echo [!] Android SDK was not found in ANDROID_HOME or LocalAppData.
        goto :SHOW_INSTRUCTIONS
    )
)

echo [OK] Java and Android SDK detected.
echo [*] Purging recursive APK bloat from web and asset directories...
if exist "%~dp0frontend\public\*.apk" del /f /q "%~dp0frontend\public\*.apk" >nul 2>nul
if exist "%~dp0frontend\out\*.apk" del /f /q "%~dp0frontend\out\*.apk" >nul 2>nul
if exist "%~dp0frontend\android\app\src\main\assets\public\*.apk" del /f /q "%~dp0frontend\android\app\src\main\assets\public\*.apk" >nul 2>nul

echo [1/2] Compiling debug APK via Gradle...
cd /d "%~dp0frontend\android"
call gradlew.bat assembleDebug

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [2/2] Copying app-debug.apk to root or-nav.apk...
    if exist "app\build\outputs\apk\debug\app-debug.apk" (
        copy /y "app\build\outputs\apk\debug\app-debug.apk" "%~dp0or-nav.apk" >nul
        copy /y "app\build\outputs\apk\debug\app-debug.apk" "%~dp0or-nav-standalone.apk" >nul
        echo [SUCCESS] Standalone APK built and published to root or-nav.apk and or-nav-standalone.apk!
        echo Clinicians can now download the APK via GET /api/download-apk.
    ) else (
        echo [!] Gradle succeeded, but app-debug.apk was not found in output directory.
    )
) else (
    echo [ERROR] Gradle build failed. Check the error messages above.
)
goto :END

:SHOW_INSTRUCTIONS
echo -------------------------------------------------------
echo  HOW TO BUILD THE ANDROID APK:
echo -------------------------------------------------------
echo  Option 1: Open the project in Android Studio:
echo    - Open Android Studio
echo    - Select: Open -^> "%~dp0frontend\android"
echo    - Click: Build -^> Build Bundle(s) / APK(s) -^> Build APK(s)
echo    - Copy app-debug.apk to frontend\public\or-nav.apk
echo.
echo  Option 2: Use the Instant HTTPS Tunnel (Zero Setup):
echo    - Scan the QR code in OR-Nav on your mobile phone
echo    - Opens the live HTTPS link with full Walkie-Talkie mic
echo    - Tap 'Add to Home Screen' to install as native PWA!
echo -------------------------------------------------------

:: If Android Studio is installed, attempt to launch it directly
set "STUDIO_EXE="
if exist "%ProgramFiles%\Android\Android Studio\bin\studio64.exe" (
    set "STUDIO_EXE=%ProgramFiles%\Android\Android Studio\bin\studio64.exe"
) else if exist "%LOCALAPPDATA%\Programs\Android Studio\bin\studio64.exe" (
    set "STUDIO_EXE=%LOCALAPPDATA%\Programs\Android Studio\bin\studio64.exe"
)

if defined STUDIO_EXE (
    echo.
    echo Found Android Studio! Launching project...
    start "" "%STUDIO_EXE%" "%~dp0frontend\android"
)

:END
echo.
pause
