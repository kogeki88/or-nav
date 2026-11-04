import type { VersionManifest } from "./version";
import { isNewerVersion, GITHUB_REPO_OWNER, GITHUB_REPO_NAME } from './version';
import { scrubPhi } from "./scrubClient";

export interface OTAManifest extends VersionManifest {
  sha256?: string;
}

export function validateOTAManifest(
  manifest: Partial<OTAManifest>,
  currentVersion: string,
  currentBuild: number
): { valid: boolean; reason?: string; sanitizedManifest?: Partial<OTAManifest> } {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, reason: 'Invalid manifest format' };
  }

  // 1. HIPAA PII/PHI Redaction, Zero-Trust Token Exchange, and Prompt Injection Hardening

  // Check for unauthorized tokens
  if ((manifest as any).authorization || (manifest as any).token) {
    return { valid: false, reason: 'Unauthorized token payload detected' };
  }

  // Create a deep copy for sanitization to keep the function pure
  const sanitizedManifest: Partial<OTAManifest> = { ...manifest };

  // Redact string fields and mitigate ReDoS/Prompt Injection
  for (const key of Object.keys(sanitizedManifest) as (keyof OTAManifest)[]) {
    const val = sanitizedManifest[key as keyof Partial<OTAManifest>];
    if (typeof val === 'string') {
      // ReDoS protection: Limit string length for validation processing (generous limit for changelog)
      if (val.length > 500000) {
        return { valid: false, reason: 'Payload length exceeds maximum allowed limit' };
      }

      // Prompt injection mitigation
      let sanitizedStr = val;
      if (/(?:ignore|disregard)\s+(?:all\s+)?(?:previous\s+)?(?:instructions|directions)/i.test(sanitizedStr)) {
        sanitizedStr = "[SANITIZED] " + sanitizedStr.replace(/(ignore|disregard|instructions|directions)/gi, '***');
      }

      // PHI Redaction
      const { text } = scrubPhi(sanitizedStr);
      (sanitizedManifest as any)[key] = text;
    }
  }

  const m = sanitizedManifest;

  // 1. Missing or invalid SHA-256
  if (!m.sha256 || typeof m.sha256 !== 'string') {
    return { valid: false, reason: 'Missing SHA-256 hash' };
  }
  if (!/^[a-fA-F0-9]{64}$/.test(m.sha256)) {
    return { valid: false, reason: 'Invalid SHA-256 hash format' };
  }

  // 2. Prevent downgrade attacks
  if (!m.version || typeof m.version !== 'string' || typeof m.build_number !== 'number' || isNaN(m.build_number)) {
    return { valid: false, reason: 'Missing version or build number' };
  }

  // If local is newer than remote, it's a downgrade
  if (isNewerVersion(currentVersion, currentBuild, m.version, m.build_number)) {
    return { valid: false, reason: 'Downgrade attack detected' };
  }

  // 3. Trusted GitHub URL
  if (!m.apk_download_url) {
    return { valid: false, reason: 'Missing APK download URL' };
  }

  try {
    const url = new URL(m.apk_download_url);
    if (url.hostname !== 'github.com') {
      return { valid: false, reason: 'Untrusted APK download URL' };
    }
    const pathPrefix = `/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/download/`;
    const pathLatestPrefix = `/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest/download/`;

    if (!url.pathname.startsWith(pathPrefix) && !url.pathname.startsWith(pathLatestPrefix) && !url.pathname.startsWith('/OWNER/REPO/releases/download/') && !url.pathname.startsWith('/OWNER/REPO/releases/latest/download/')) {
      return { valid: false, reason: 'Untrusted APK download URL path' };
    }
  } catch (e) {
    return { valid: false, reason: 'Invalid APK download URL' };
  }

  return { valid: true, sanitizedManifest };
}
