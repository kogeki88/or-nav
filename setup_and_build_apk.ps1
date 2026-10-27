# setup_and_build_apk.ps1
# Sets up portable OpenJDK 21 and Android SDK in .android-sdk, then compiles or-nav.apk

$ErrorActionPreference = "Stop"
$rootDir = "C:\Users\igles\.gemini\antigravity\scratch\or-nav"
$sdkDir = "$rootDir\.android-sdk"
$downloadsDir = "$sdkDir\downloads"

New-Item -ItemType Directory -Force -Path $downloadsDir | Out-Null

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  OR-Nav Portable Android SDK Setup & APK Build (JDK 21)" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

# 1. Download & Extract OpenJDK 21 if not already present
$jdkTargetDir = "$sdkDir\jdk-21"
if (-not (Test-Path "$jdkTargetDir\bin\java.exe")) {
    $jdkZip = "$downloadsDir\microsoft-jdk-21.zip"
    if (-not (Test-Path $jdkZip)) {
        Write-Host "[1/3] Downloading OpenJDK 21 (~190MB)..." -ForegroundColor Yellow
        curl.exe -L "https://aka.ms/download-jdk/microsoft-jdk-21.0.4-windows-x64.zip" -o $jdkZip
    }
    Write-Host "[1/3] Extracting OpenJDK 21..." -ForegroundColor Yellow
    $tempExtract = "$downloadsDir\jdk21_temp"
    New-Item -ItemType Directory -Force -Path $tempExtract | Out-Null
    tar.exe -xf $jdkZip -C $tempExtract
    $extractedFolder = (Get-ChildItem $tempExtract | Where-Object { $_.PSIsContainer } | Select-Object -First 1).FullName
    New-Item -ItemType Directory -Force -Path $jdkTargetDir | Out-Null
    Copy-Item "$extractedFolder\*" -Destination $jdkTargetDir -Recurse -Force
    Remove-Item $tempExtract -Recurse -Force
}

$javaExe = "$jdkTargetDir\bin\java.exe"
if (-not (Test-Path $javaExe)) {
    throw "Java binary not found at $javaExe"
}
Write-Host "[OK] OpenJDK 21 ready at $jdkTargetDir" -ForegroundColor Green

# Set Java & Android environment
$env:JAVA_HOME = $jdkTargetDir
$env:ANDROID_HOME = $sdkDir
$env:ANDROID_SDK_ROOT = $sdkDir
$cmdlineToolsDir = "$sdkDir\cmdline-tools\latest"
$env:PATH = "$jdkTargetDir\bin;$cmdlineToolsDir\bin;$sdkDir\platform-tools;" + $env:PATH

Write-Host "Java version:"
& $javaExe -version

# 2. Verify Android SDK configuration
$androidProjectDir = "$rootDir\frontend\android"
Set-Location $androidProjectDir

# Write local.properties to explicitly point to the portable SDK
"sdk.dir=$($sdkDir.Replace('\', '/'))" | Set-Content -Path "$androidProjectDir\local.properties" -Encoding ASCII

# 3. Compile the APK via Gradle
Write-Host "[2/3] Building APK via Gradle assembleDebug..." -ForegroundColor Yellow
& .\gradlew.bat assembleDebug

$compiledApk = "$androidProjectDir\app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $compiledApk)) {
    throw "Gradle completed but $compiledApk was not generated!"
}

# 4. Copy to frontend/public/or-nav.apk
Write-Host "[3/3] Publishing to frontend\public\or-nav.apk..." -ForegroundColor Yellow
$finalApkPath = "$rootDir\frontend\public\or-nav.apk"
Copy-Item $compiledApk $finalApkPath -Force
$apkItem = Get-Item $finalApkPath
$apkSizeMb = [math]::Round($apkItem.Length / 1MB, 2)

Write-Host "=======================================================" -ForegroundColor Green
Write-Host "  SUCCESS: OR-Nav Android APK Compiled!" -ForegroundColor Green
Write-Host "  Path: $finalApkPath" -ForegroundColor Green
Write-Host "  Size: $apkSizeMb MB ($($apkItem.Length) bytes)" -ForegroundColor Green
Write-Host "=======================================================" -ForegroundColor Green
