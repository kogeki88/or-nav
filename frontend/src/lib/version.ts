/**
 * OR-Nav Official Application Versioning Configuration
 * Version: v0.64
 */

export interface VersionManifest {
  version: string;
  build_number: number;
  release_date: string;
  apk_download_url: string;
  min_supported_version: string;
  changelog: string;
}

export const CURRENT_VERSION = "v0.64";
export const CURRENT_BUILD_NUMBER = 21;
export const CURRENT_RELEASE_DATE = "2026-11-02";

export const GITHUB_REPO_OWNER = "kogeki88";
export const GITHUB_REPO_NAME = "or-nav";
export const CLOUD_MANIFEST_URL = `https://raw.githubusercontent.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/main/frontend/public/version.json`;
export const CLOUD_RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`;
export const CLOUD_APK_DOWNLOAD_URL = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest/download/or-nav.apk`;

export const LOCAL_VERSION_MANIFEST: VersionManifest = {
  version: CURRENT_VERSION,
  build_number: CURRENT_BUILD_NUMBER,
  release_date: CURRENT_RELEASE_DATE,
  apk_download_url: CLOUD_APK_DOWNLOAD_URL,
  min_supported_version: "v0.1",
  changelog:
    "v0.64 (Build 21): Fix Profile Button 404, Restore Quick Department Switcher Pill & Inline Selector, Full-System Interactive UI Audit, and lean Android APK under 10MB.",
};

/**
 * Compare two semver-like version strings or build numbers
 * Returns true if remote is strictly greater than local.
 */
export function isNewerVersion(
  remoteVersion: string,
  remoteBuild?: number,
  localVersion: string = CURRENT_VERSION,
  localBuild: number = CURRENT_BUILD_NUMBER
): boolean {
  // 1. Primary source of truth: monotonic build_number comparison
  if (
    typeof remoteBuild === "number" &&
    typeof localBuild === "number" &&
    remoteBuild > 0 &&
    localBuild > 0
  ) {
    return remoteBuild > localBuild;
  }

  // 2. Fallback: Parse major.minor.patch numeric tags
  const clean = (v: string) => v.trim().replace(/^[vV]/, "");
  const rParts = clean(remoteVersion).split(".").map((n) => parseInt(n, 10) || 0);
  const lParts = clean(localVersion).split(".").map((n) => parseInt(n, 10) || 0);

  for (let i = 0; i < Math.max(rParts.length, lParts.length); i++) {
    const r = rParts[i] || 0;
    const l = lParts[i] || 0;
    if (r > l) return true;
    if (r < l) return false;
  }

  return false;
}
