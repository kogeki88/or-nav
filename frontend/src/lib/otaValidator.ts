import type { VersionManifest } from "./version.ts";
import { isNewerVersion, GITHUB_REPO_OWNER, GITHUB_REPO_NAME } from './version.ts';

export interface OTAManifest extends VersionManifest {
  sha256?: string;
}

export function validateOTAManifest(
  manifest: Partial<OTAManifest>,
  currentVersion: string,
  currentBuild: number
): { valid: boolean; reason?: string } {
  // 1. Missing or invalid SHA-256
  if (!manifest.sha256 || typeof manifest.sha256 !== 'string') {
    return { valid: false, reason: 'Missing SHA-256 hash' };
  }
  if (!/^[a-fA-F0-9]{64}$/.test(manifest.sha256)) {
    return { valid: false, reason: 'Invalid SHA-256 hash format' };
  }

  // 2. Prevent downgrade attacks
  if (!manifest.version || typeof manifest.build_number !== 'number') {
    return { valid: false, reason: 'Missing version or build number' };
  }

  // If local is newer than remote, it's a downgrade
  if (isNewerVersion(currentVersion, currentBuild, manifest.version, manifest.build_number)) {
    return { valid: false, reason: 'Downgrade attack detected' };
  }

  // 3. Trusted GitHub URL
  if (!manifest.apk_download_url) {
    return { valid: false, reason: 'Missing APK download URL' };
  }

  try {
    const url = new URL(manifest.apk_download_url);
    if (url.hostname !== 'github.com') {
      return { valid: false, reason: 'Untrusted APK download URL' };
    }
    const pathPrefix = `/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/download/`;
    const pathLatestPrefix = `/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest/download/`;

    if (!url.pathname.startsWith(pathPrefix) && !url.pathname.startsWith(pathLatestPrefix)) {
      return { valid: false, reason: 'Untrusted APK download URL path' };
    }
  } catch (e) {
    return { valid: false, reason: 'Invalid APK download URL' };
  }

  return { valid: true };
}
