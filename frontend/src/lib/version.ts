/**
 * OR-Nav Official Application Versioning Configuration
 * Version: v0.4
 */

export interface VersionManifest {
  version: string;
  build_number: number;
  release_date: string;
  apk_download_url: string;
  min_supported_version: string;
  changelog: string;
}

export const CURRENT_VERSION = "v0.61";
export const CURRENT_BUILD_NUMBER = 18;
export const CURRENT_RELEASE_DATE = "2026-10-29";

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
    "v0.61 (Build 18): Full system verification audit, RO Character Select Workshop with pre-loaded Veo 3.1 motion loops verified, and production APK published.",
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

  // 2. Fallback: Semantic version comparison if build_number is missing
  const parse = (v: string): number[] => {
    const raw = v.trim().replace(/^v/i, "");
    return raw.split(".").map((n) => parseInt(n, 10) || 0);
  };

  const [rMajor = 0, rMinor = 0, rPatch = 0] = parse(remoteVersion);
  const [lMajor = 0, lMinor = 0, lPatch = 0] = parse(localVersion);

  if (rMajor !== lMajor) return rMajor > lMajor;
  if (rMinor !== lMinor) return rMinor > lMinor;
  return rPatch > lPatch;
}

