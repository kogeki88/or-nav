# publish-release.ps1
# Automates the entire OR-Nav Cloud OTA Release lifecycle via GitHub Releases
# Usage:
#   .\publish-release.ps1 -Version "v0.41" -BuildNumber 6 -Changelog "Cloud OTA Auto-Update verified via GitHub Releases"
# Or run with no arguments for auto-increment & interactive prompts.

param(
    [Parameter(Mandatory=$false)][string]$Version = "",
    [Parameter(Mandatory=$false)][int]$BuildNumber = 0,
    [Parameter(Mandatory=$false)][string]$Changelog = "",
    [switch]$SkipBuild,
    [switch]$SkipGitPush
)

$ErrorActionPreference = "Stop"
$rootDir = $PSScriptRoot
if (-not $rootDir) { $rootDir = (Get-Location).Path }
$owner = "kogeki88"
$repo = "or-nav"
$cloudApkUrl = "https://github.com/$owner/$repo/releases/latest/download/or-nav.apk"

# Ensure gh and git are in PATH
if ($env:PATH -notlike "*Programs\gh\bin*") {
    $env:PATH = "$env:PATH;C:\Users\igles\AppData\Local\Programs\gh\bin"
}

# 1. Parse or prompt for Version, BuildNumber, and Changelog
$vJsonPath = "$rootDir\frontend\public\version.json"
$currentManifest = Get-Content $vJsonPath -Raw | ConvertFrom-Json

if (-not $Version) {
    $suggestedVersion = "v0.41"
    $inputVer = Read-Host "Release Version (Press Enter for $suggestedVersion)"
    if ($inputVer) { $Version = $inputVer } else { $Version = $suggestedVersion }
}

if ($BuildNumber -le 0) {
    $suggestedBuild = [int]$currentManifest.build_number + 1
    $inputBuild = Read-Host "Build Number (Press Enter for $suggestedBuild)"
    if ($inputBuild) { $BuildNumber = [int]$inputBuild } else { $BuildNumber = $suggestedBuild }
}

if (-not $Changelog) {
    $suggestedNotes = "Release $Version (Build $BuildNumber)"
    $inputNotes = Read-Host "Changelog Notes (Press Enter for '$suggestedNotes')"
    if ($inputNotes) { $Changelog = $inputNotes } else { $Changelog = $suggestedNotes }
}

$releaseDate = (Get-Date).ToString("yyyy-MM-dd")

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  OR-Nav Cloud OTA Publisher" -ForegroundColor Cyan
Write-Host "  Target Release: $Version (Build $BuildNumber)" -ForegroundColor Cyan
Write-Host "  Release Date:   $releaseDate" -ForegroundColor Cyan
Write-Host "  Changelog:      $Changelog" -ForegroundColor Cyan
Write-Host "  Cloud APK URL:  $cloudApkUrl" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

# 2. Update Version Metadata in frontend/public/version.json
Write-Host "`n[1/5] Updating version manifest metadata..." -ForegroundColor Yellow
$newManifest = [ordered]@{
    version = $Version
    build_number = $BuildNumber
    release_date = $releaseDate
    apk_download_url = $cloudApkUrl
    min_supported_version = "v0.1"
    changelog = $Changelog
}
$newManifest | ConvertTo-Json -Depth 5 | Set-Content -Path $vJsonPath -Encoding UTF8
Write-Host "  [OK] Updated $vJsonPath" -ForegroundColor Green

# Update frontend/src/lib/version.ts
$versionTsPath = "$rootDir\frontend\src\lib\version.ts"
$versionTs = Get-Content $versionTsPath -Raw
$versionTs = $versionTs -replace 'export const CURRENT_VERSION = "[^"]*";', "export const CURRENT_VERSION = `"$Version`";"
$versionTs = $versionTs -replace 'export const CURRENT_BUILD_NUMBER = \d+;', "export const CURRENT_BUILD_NUMBER = $BuildNumber;"
$versionTs = $versionTs -replace 'export const CURRENT_RELEASE_DATE = "[^"]*";', "export const CURRENT_RELEASE_DATE = `"$releaseDate`";"
Set-Content -Path $versionTsPath -Value $versionTs -Encoding UTF8
Write-Host "  [OK] Updated $versionTsPath" -ForegroundColor Green

# Update backend/app/main.py
$mainPyPath = "$rootDir\backend\app\main.py"
$mainPy = Get-Content $mainPyPath -Raw
$mainPy = $mainPy -replace '("version":\s*")[^"]*(",\s*"build_number":\s*)\d+', "`${1}$Version`${2}$BuildNumber"
Set-Content -Path $mainPyPath -Value $mainPy -Encoding UTF8
Write-Host "  [OK] Updated $mainPyPath" -ForegroundColor Green

# 3. Next.js Static Export & Capacitor Sync
if (-not $SkipBuild) {
    Write-Host "`n[2/5] Building Next.js static export & syncing Capacitor..." -ForegroundColor Yellow
    Set-Location "$rootDir\frontend"
    npm run build
    npx cap sync android

    # 4. Compile Standalone Android APK with OpenJDK 21
    Write-Host "`n[3/5] Compiling Android APK with Gradle (assembleDebug)..." -ForegroundColor Yellow
    $sdkDir = "$rootDir\.android-sdk"
    $jdkDir = "$sdkDir\jdk-21"
    $env:JAVA_HOME = $jdkDir
    $env:ANDROID_HOME = $sdkDir
    $env:ANDROID_SDK_ROOT = $sdkDir
    $cmdlineToolsDir = "$sdkDir\cmdline-tools\latest"
    $env:PATH = "$jdkDir\bin;$cmdlineToolsDir\bin;$sdkDir\platform-tools;" + $env:PATH

    Set-Location "$rootDir\frontend\android"
    & .\gradlew.bat assembleDebug

    $compiledApk = "$rootDir\frontend\android\app\build\outputs\apk\debug\app-debug.apk"
    if (-not (Test-Path $compiledApk)) {
        throw "Build failed: $compiledApk not found!"
    }

    Write-Host "`n[4/5] Copying compiled APK..." -ForegroundColor Yellow
    Copy-Item $compiledApk "$rootDir\or-nav.apk" -Force
    Copy-Item $compiledApk "$rootDir\frontend\public\or-nav.apk" -Force
    $apkItem = Get-Item "$rootDir\or-nav.apk"
    $sizeMb = [math]::Round($apkItem.Length / 1MB, 2)
    Write-Host "  [OK] APK Ready: $sizeMb MB ($($apkItem.Length) bytes)" -ForegroundColor Green
}

# 5. Git Commit & Push (strictly excluding *.apk from git history)
Set-Location $rootDir
if (-not $SkipGitPush) {
    Write-Host "`n[5/5] Committing source updates and pushing to GitHub origin main..." -ForegroundColor Yellow
    git add frontend/public/version.json frontend/src/lib/version.ts backend/app/main.py frontend/android/app/src/main/java/com/ornav/clinical/ApkUpdaterPlugin.java frontend/src/hooks/useAppUpdate.ts publish-release.ps1
    $status = git status --porcelain
    if ($status) {
        git commit -m "chore(release): bump version to $Version (Build $BuildNumber)"
    }
    git push origin main
    Write-Host "  [OK] Pushed manifest and source updates to GitHub main branch." -ForegroundColor Green
}

# 6. Publish / Update GitHub Release Asset via gh CLI
Write-Host "`nPublishing $Version release binary to GitHub Releases..." -ForegroundColor Yellow
$apkFile = "$rootDir\or-nav.apk"
if (-not (Test-Path $apkFile)) {
    throw "APK file $apkFile not found for release upload!"
}

# Check if release already exists
$releaseExists = $false
try {
    $existing = & gh release view $Version 2>&1
    if ($LASTEXITCODE -eq 0) {
        $releaseExists = $true
    }
} catch {
    $releaseExists = $false
}

if ($releaseExists) {
    Write-Host "Updating existing GitHub release $Version with latest binary asset..." -ForegroundColor Cyan
    & gh release upload $Version $apkFile --clobber
    & gh release edit $Version --title "OR-Nav $Version (Build $BuildNumber)" --notes "$Changelog" --latest
} else {
    Write-Host "Creating new GitHub release $Version..." -ForegroundColor Cyan
    & gh release create $Version $apkFile --title "OR-Nav $Version (Build $BuildNumber)" --notes "$Changelog" --latest
}

Write-Host "`n=======================================================" -ForegroundColor Green
Write-Host "  SUCCESS! OR-Nav $Version (Build $BuildNumber) IS LIVE ON GITHUB!" -ForegroundColor Green
Write-Host "  Release URL:  https://github.com/$owner/$repo/releases/tag/$Version" -ForegroundColor Green
Write-Host "  Direct APK:   $cloudApkUrl" -ForegroundColor Green
Write-Host "  Raw Manifest: https://raw.githubusercontent.com/$owner/$repo/main/frontend/public/version.json" -ForegroundColor Green
Write-Host "=======================================================" -ForegroundColor Green
