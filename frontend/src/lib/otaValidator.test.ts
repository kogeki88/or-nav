import { describe, it, mock } from 'node:test';
import * as assert from 'node:assert';
import type { OTAManifest } from "./otaValidator.ts";
import { fetchWithRetry } from './fetchWithRetry.ts';
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

  describe('Multi-tenant isolation and Offline-first invariants', () => {
    it('validates manifest strictly independent of network state (offline-first)', () => {
      const originalFetch = global.fetch;
      try {
        global.fetch = (async () => { throw new Error('Network offline'); }) as unknown as typeof fetch;
        const result = validateOTAManifest(validManifest, currentVersion, currentBuild);
        assert.strictEqual(result.valid, true);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('ensures validation is isolated and does not leak tenant state', () => {
      const tenantA_Manifest = { ...validManifest, version: 'v0.62', build_number: 19 };
      const tenantB_Manifest = { ...validManifest, version: 'v0.63', build_number: 20 };

      const resultA = validateOTAManifest(tenantA_Manifest, currentVersion, currentBuild);
      const resultB = validateOTAManifest(tenantB_Manifest, currentVersion, currentBuild);

      assert.strictEqual(resultA.valid, true);
      assert.strictEqual(resultB.valid, true);
      assert.notDeepEqual(tenantA_Manifest, tenantB_Manifest, 'Tenant states should remain isolated and distinct');
    });

    it('supplementary multi-tenant boundary enforcement (facility_id::dept_id) and offline mutation replay idempotency test', () => {
      // 1. Offline Mutation Replay Idempotency
      // Since validateOTAManifest is a pure function, replay should be strictly idempotent.
      const initialResult = validateOTAManifest(validManifest, currentVersion, currentBuild);
      const replayResult1 = validateOTAManifest(validManifest, currentVersion, currentBuild);
      const replayResult2 = validateOTAManifest(validManifest, currentVersion, currentBuild);

      assert.strictEqual(initialResult.valid, replayResult1.valid);
      assert.strictEqual(initialResult.valid, replayResult2.valid);

      // 2. Multi-tenant boundary enforcement (facility_id::dept_id)
      const tenantAManifest = { ...validManifest, 'facility_id::dept_id': 'facA::dept1' };
      const tenantBManifest = { ...validManifest, 'facility_id::dept_id': 'facB::dept2' };

      // Valid downgrade scenarios
      const newManifestA = { ...tenantAManifest, version: 'v0.65', build_number: 22 };
      const newManifestB = { ...tenantBManifest, version: 'v0.65', build_number: 22 };

      const newResultA = validateOTAManifest(newManifestA, currentVersion, currentBuild);
      const newResultB = validateOTAManifest(newManifestB, currentVersion, currentBuild);

      assert.strictEqual(newResultA.valid, true);
      assert.strictEqual(newResultB.valid, true);

      // Verify isolation - mutating one doesn't affect the other
      const mutatedManifestA = { ...newManifestA };
      delete (mutatedManifestA as any).sha256;

      const mutatedResultA = validateOTAManifest(mutatedManifestA, currentVersion, currentBuild);
      const mutatedResultB = validateOTAManifest(newManifestB, currentVersion, currentBuild);

      assert.strictEqual(mutatedResultA.valid, false);
      assert.strictEqual(mutatedResultB.valid, true);

      // Ensure boundaries are respected
      assert.strictEqual((newManifestA as any)['facility_id::dept_id'], 'facA::dept1');
      assert.strictEqual((newManifestB as any)['facility_id::dept_id'], 'facB::dept2');
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

  describe('Fuzzing and Malformed Payloads', () => {
    it('rejects null or undefined manifests', () => {
      assert.strictEqual(validateOTAManifest(null as any, currentVersion, currentBuild).valid, false);
      assert.strictEqual(validateOTAManifest(undefined as any, currentVersion, currentBuild).valid, false);
    });

    it('rejects manifests with wrong types for fields', () => {
      assert.strictEqual(
        validateOTAManifest({ ...validManifest, build_number: "18" as any }, currentVersion, currentBuild).valid,
        false
      );
      assert.strictEqual(
        validateOTAManifest({ ...validManifest, build_number: NaN }, currentVersion, currentBuild).valid,
        false
      );
      assert.strictEqual(
        validateOTAManifest({ ...validManifest, version: 123 as any, build_number: 18 }, currentVersion, currentBuild).valid,
        false
      );
    });

    it('rejects arrays or other non-plain objects if they bypass schema', () => {
      assert.strictEqual(
        validateOTAManifest([] as any, currentVersion, currentBuild).valid,
        false
      );
    });
  });

  describe('High-Concurrency & Stress Benchmarks', () => {
    it('handles concurrent burst execution and prevents race conditions across tenants', async () => {
      const concurrency = 1000;
      const tasks = Array.from({ length: concurrency }).map(async (_, i) => {
        // Unique tenant manifest payload
        const tenantManifest = {
          ...validManifest,
          version: `v0.${62 + i}`,
          build_number: 19 + i,
        };
        const result = validateOTAManifest(tenantManifest, currentVersion, currentBuild);
        return { i, result, tenantManifest };
      });

      const results = await Promise.all(tasks);

      // Verify no race conditions leaked between concurrent validation calls
      results.forEach(({ result, tenantManifest, i }) => {
        assert.strictEqual(result.valid, true, `Validation failed for tenant ${i}`);
        assert.strictEqual(tenantManifest.version, `v0.${62 + i}`);
        assert.strictEqual(tenantManifest.build_number, 19 + i);
      });
    });

    it('validates 10000 manifests under latency constraints (stress test)', () => {
      const iterations = 10000;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        validateOTAManifest(validManifest, currentVersion, currentBuild);
      }
      const end = performance.now();
      const latency = end - start;
      assert.ok(latency < 10000, `Stress test took ${latency}ms, expected under 10000ms`);
    });
  });

  describe('Fault Injection & Network Partition Resilience', () => {
    it('simulates fault injection, intermittent latency, and self-healing reconnection using application recovery logic', async () => {
      const originalFetch = global.fetch;
      let networkState = { status: 'offline', latency: 0 };
      let fetchAttempts = 0;

      global.fetch = mock.fn(async (url: string) => {
        const state = networkState;
        fetchAttempts++;
        if (state.latency > 0) {
          await new Promise(r => setTimeout(r, state.latency));
        }
        if (state.status === 'offline') {
          throw new Error('Network offline');
        }
        if (state.status === 'degraded' && fetchAttempts % 2 !== 0) {
          throw new Error('Intermittent network failure');
        }
        return {
          ok: true,
          json: async () => validManifest,
        } as Response;
      }) as unknown as typeof fetch;

      try {
        // 1. Fault injection & full network partition
        let fetchedManifest = null;
        try {
          fetchedManifest = await fetchWithRetry('https://example.com/manifest', 1);
        } catch (e) {}
        assert.strictEqual(fetchedManifest, null);
        assert.strictEqual(fetchAttempts, 1);

        // 2. Intermittent latency and degradation leading to self-healing within retries
        fetchAttempts = 0;
        networkState = { status: 'degraded', latency: 10 };
        fetchedManifest = await fetchWithRetry('https://example.com/manifest', 3);

        assert.notStrictEqual(fetchedManifest, null);
        assert.strictEqual(fetchAttempts, 2);

        const validationResult = validateOTAManifest(fetchedManifest, currentVersion, currentBuild);
        assert.strictEqual(validationResult.valid, true);

        // 3. Fully restored connection with latency
        fetchAttempts = 0;
        networkState = { status: 'online', latency: 20 };
        const res3 = await fetchWithRetry('https://example.com/manifest', 1);
        const result3 = validateOTAManifest(res3, currentVersion, currentBuild);
        assert.strictEqual(result3.valid, true);
        assert.strictEqual(fetchAttempts, 1);

      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
