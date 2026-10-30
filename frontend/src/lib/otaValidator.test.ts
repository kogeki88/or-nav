import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import type { OTAManifest } from "./otaValidator.ts";
import { validateOTAManifest } from './otaValidator.ts';
import { CURRENT_VERSION, CURRENT_BUILD_NUMBER, GITHUB_REPO_OWNER, GITHUB_REPO_NAME } from './version.ts';

describe('OTA Validator', () => {
  const currentVersion = 'v0.60';
  const currentBuild = 17;

  const validSha256 = 'a'.repeat(64);
  const trustedUrl = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/download/v0.61/or-nav.apk`;

  const validManifest: OTAManifest = {
    version: 'v0.61',
    build_number: 18,
    release_date: '2026-10-30',
    apk_download_url: trustedUrl,
    min_supported_version: 'v0.1',
    changelog: 'Test update',
    sha256: validSha256
  };

  it('accepts a valid OTA manifest', () => {
    const result = validateOTAManifest(validManifest, currentVersion, currentBuild);
    assert.strictEqual(result.valid, true);
  });

  describe('SHA-256 Validation', () => {
    it('rejects manifest with missing SHA-256', () => {
      const manifest = { ...validManifest };
      delete manifest.sha256;

      const result = validateOTAManifest(manifest, currentVersion, currentBuild);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'Missing SHA-256 hash');
    });

    it('rejects manifest with invalid SHA-256 length', () => {
      const manifest = { ...validManifest, sha256: 'a'.repeat(63) };

      const result = validateOTAManifest(manifest, currentVersion, currentBuild);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'Invalid SHA-256 hash format');
    });

    it('rejects manifest with invalid SHA-256 characters', () => {
      const manifest = { ...validManifest, sha256: 'z'.repeat(64) };

      const result = validateOTAManifest(manifest, currentVersion, currentBuild);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'Invalid SHA-256 hash format');
    });
  });

  describe('Downgrade Attack Prevention', () => {
    it('rejects manifest with older build number', () => {
      const manifest = { ...validManifest, version: 'v0.50', build_number: 16 };

      const result = validateOTAManifest(manifest, currentVersion, currentBuild);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'Downgrade attack detected');
    });

    it('rejects manifest with older version if build number is 0', () => {
      // Test when fallback semver is used (build number 0 bypasses the build check)
      const manifest = { ...validManifest, version: 'v0.50', build_number: 0 };

      const result = validateOTAManifest(manifest, currentVersion, 0); // Both build numbers 0 to force semver check
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'Downgrade attack detected');
    });

    it('accepts manifest with same version and build number', () => {
      const manifest = { ...validManifest, version: currentVersion, build_number: currentBuild };

      const result = validateOTAManifest(manifest, currentVersion, currentBuild);
      assert.strictEqual(result.valid, true);
    });
  });

  describe('APK Download URL Validation', () => {
    it('rejects missing APK download URL', () => {
      const manifest = { ...validManifest };
      delete (manifest as any).apk_download_url;

      const result = validateOTAManifest(manifest, currentVersion, currentBuild);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'Missing APK download URL');
    });

    it('rejects non-GitHub domain URLs', () => {
      const manifest = { ...validManifest, apk_download_url: 'https://evil.com/or-nav.apk' };

      const result = validateOTAManifest(manifest, currentVersion, currentBuild);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'Untrusted APK download URL');
    });

    it('rejects GitHub URLs for other repositories', () => {
      const manifest = { ...validManifest, apk_download_url: 'https://github.com/hacker/malware/releases/download/v1/app.apk' };

      const result = validateOTAManifest(manifest, currentVersion, currentBuild);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'Untrusted APK download URL path');
    });

    it('accepts valid GitHub latest release URL', () => {
      const manifest = {
        ...validManifest,
        apk_download_url: `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest/download/or-nav.apk`
      };

      const result = validateOTAManifest(manifest, currentVersion, currentBuild);
      assert.strictEqual(result.valid, true);
    });

    it('rejects malformed URLs', () => {
      const manifest = { ...validManifest, apk_download_url: 'not-a-url' };

      const result = validateOTAManifest(manifest, currentVersion, currentBuild);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'Invalid APK download URL');
    });
  });
});
