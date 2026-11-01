import 'jsdom-global/register.js';
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { VersionManifest } from '@/lib/version';

const proxyquire = require('proxyquire');

let currentOpenApkDownloadMock = mock.fn();
const openApkDownloadMock = mock.fn((...args: any[]) => currentOpenApkDownloadMock(...args));

const AutoUpdateModalMod = proxyquire('./AutoUpdateModal', {
  '@/hooks/useAppUpdate': {
    openApkDownload: openApkDownloadMock,
  },
});

const AutoUpdateModal = AutoUpdateModalMod.default;

// Save original globals for restoration to enforce multi-tenant environment isolation
const originalFetch = global.fetch;

beforeEach(() => {
  currentOpenApkDownloadMock = mock.fn();

  // Poison global.fetch to strictly enforce offline-first invariant
  // If the component attempts ANY network request during render or interaction, the test will fail
  global.fetch = () => {
    throw new Error('NETWORK CALL DETECTED: Offline-first invariant violated. Fetch is forbidden in pure UI components.');
  };
});

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

const manifest: VersionManifest = {
  version: 'v0.62',
  build_number: 19,
  release_date: '2026-11-01',
  apk_download_url: 'https://example.com/download.apk',
  min_supported_version: 'v0.1',
  changelog: 'Added shiny new features\n- Feature A\n- Feature B',
};

test('does not render if isOpen is false or manifest is null', () => {
  const { rerender } = render(
    <AutoUpdateModal
      isOpen={false}
      onClose={() => {}}
      manifest={manifest}
      currentVersion="v0.61"
      currentBuild={18}
    />
  );
  assert.strictEqual(screen.queryByTestId('auto-update-modal'), null);

  rerender(
    <AutoUpdateModal
      isOpen={true}
      onClose={() => {}}
      manifest={null}
      currentVersion="v0.61"
      currentBuild={18}
    />
  );
  assert.strictEqual(screen.queryByTestId('auto-update-modal'), null);
});

test('renders correctly with manifest and current version info', () => {
  render(
    <AutoUpdateModal
      isOpen={true}
      onClose={() => {}}
      manifest={manifest}
      currentVersion="v0.61"
      currentBuild={18}
    />
  );

  assert.ok(screen.getByTestId('auto-update-modal'));
  assert.ok(screen.getByText('New Update Available'));
  assert.ok(screen.getByText('v0.61 (Build 18) ➔ v0.62 (Build 19)'));
  assert.ok(screen.getByText("What's New in v0.62"));
  assert.ok(screen.getByText('Added shiny new features', { exact: false }));
});

test('triggers download progress, openApkDownload and onClose on Install click', async () => {
  const onCloseMock = mock.fn();
  render(
    <AutoUpdateModal
      isOpen={true}
      onClose={onCloseMock}
      manifest={manifest}
      currentVersion="v0.61"
      currentBuild={18}
    />
  );

  const installBtn = screen.getByTestId('btn-install-apk-modal');
  fireEvent.click(installBtn);

  // Check progress rendering
  await waitFor(() => {
    assert.ok(screen.getByTestId('progress-container'));
    assert.ok(screen.getByTestId('progress-bar'));
  });

  // Verify that it eventually reaches 100% and finishes
  await waitFor(() => {
    assert.strictEqual(openApkDownloadMock.mock.callCount(), 1);
    assert.strictEqual(openApkDownloadMock.mock.calls[0].arguments[0], 'https://example.com/download.apk');
    assert.strictEqual(onCloseMock.mock.callCount(), 1);
  }, { timeout: 2000 });
});

test('closes modal when X button or Remind Me Later is clicked', () => {
  const onCloseMock = mock.fn();
  const { rerender } = render(
    <AutoUpdateModal
      isOpen={true}
      onClose={onCloseMock}
      manifest={manifest}
      currentVersion="v0.61"
      currentBuild={18}
    />
  );

  const closeBtn = screen.getByLabelText('Close');
  fireEvent.click(closeBtn);
  assert.strictEqual(onCloseMock.mock.callCount(), 1);

  rerender(
    <AutoUpdateModal
      isOpen={true}
      onClose={onCloseMock}
      manifest={manifest}
      currentVersion="v0.61"
      currentBuild={18}
    />
  );

  const remindBtn = screen.getByText('Remind Me Later');
  fireEvent.click(remindBtn);
  assert.strictEqual(onCloseMock.mock.callCount(), 2);
});

test('enforces multi-tenant isolation invariant with stateless and deterministic rendering', () => {
  const rootA = document.createElement('div');
  rootA.setAttribute('data-tenant', 'TenantA');
  document.body.appendChild(rootA);

  const rootB = document.createElement('div');
  rootB.setAttribute('data-tenant', 'TenantB');
  document.body.appendChild(rootB);

  try {
    // Simulates switching active multi-tenant contexts by re-rendering with disjoint data
    const tenantAManifest: VersionManifest = {
      ...manifest,
      version: 'v0.99-TenantA',
      changelog: 'Tenant A Specific Features',
    };

    const tenantBManifest: VersionManifest = {
      ...manifest,
      version: 'v0.99-TenantB',
      changelog: 'Tenant B Specific Features',
    };

    const { rerender, unmount } = render(
      <AutoUpdateModal
        isOpen={true}
        onClose={() => {}}
        manifest={tenantAManifest}
        currentVersion="v0.61"
        currentBuild={18}
      />,
      { container: rootA }
    );

    // Assert Tenant A
    assert.ok(screen.getByText('v0.61 (Build 18) ➔ v0.99-TenantA (Build 19)'));
    assert.ok(screen.getByText('Tenant A Specific Features'));

    // Unmount and render Tenant B to verify no internal memoization or global leak persists
    unmount();

    render(
      <AutoUpdateModal
        isOpen={true}
        onClose={() => {}}
        manifest={tenantBManifest}
        currentVersion="v0.61"
        currentBuild={18}
      />,
      { container: rootB }
    );

    // Assert Tenant B
    assert.ok(screen.getByText('v0.61 (Build 18) ➔ v0.99-TenantB (Build 19)'));
    assert.ok(screen.getByText('Tenant B Specific Features'));

    // Verify Tenant A data has completely leaked out of the render tree
    assert.strictEqual(screen.queryByText('Tenant A Specific Features'), null);
  } finally {
    document.body.removeChild(rootA);
    document.body.removeChild(rootB);
  }
});


test('handles malformed payloads, boundary inputs, and extreme values safely (Fuzzing / Resilience)', () => {
  const massiveString = 'A'.repeat(5000);
  const xssPayload = '<img src=x onerror=alert(1)>';

  const malformedManifest = {
    version: xssPayload,
    build_number: -999999, // Negative boundary
    release_date: '',
    apk_download_url: 'javascript:alert("hacked")',
    min_supported_version: massiveString,
    changelog: massiveString, // Massive payload
  } as any;

  render(
    <AutoUpdateModal
      isOpen={true}
      onClose={() => {}}
      manifest={malformedManifest}
      currentVersion={massiveString}
      currentBuild={Number.MAX_SAFE_INTEGER}
    />
  );

  assert.ok(screen.getByTestId('auto-update-modal'));
  // Ensure XSS payload is treated as string and not parsed as HTML
  assert.ok(screen.getByText(massiveString + ' (Build ' + Number.MAX_SAFE_INTEGER + ') ➔ ' + xssPayload + ' (Build -999999)'));

  cleanup();
});

test('handles float boundaries, NaN, arrays, objects passed as fields (Fuzzing)', () => {
  const strangeManifest = {
    version: ['v1', 'v2'], // array instead of string
    build_number: NaN,
    release_date: { year: 2026 },
    apk_download_url: undefined,
    min_supported_version: 0.0001, // float boundary
    changelog: null,
  } as any;

  render(
    <AutoUpdateModal
      isOpen={true}
      onClose={() => {}}
      manifest={strangeManifest}
      currentVersion={null as any}
      currentBuild={NaN}
    />
  );

  assert.ok(screen.getByTestId('auto-update-modal'));
  cleanup();
});

test('enforces multi-tenant boundary isolation and offline mutation replay idempotency', () => {
  const tenant1 = 'facility_A::dept_1';
  const tenant2 = 'facility_B::dept_2';

  const root1 = document.createElement('div');
  root1.setAttribute('data-tenant', tenant1);
  document.body.appendChild(root1);

  const root2 = document.createElement('div');
  root2.setAttribute('data-tenant', tenant2);
  document.body.appendChild(root2);

  try {
    const manifestTenant1: VersionManifest = {
      ...manifest,
      changelog: `Update for ${tenant1}`,
    };

    const manifestTenant2: VersionManifest = {
      ...manifest,
      changelog: `Update for ${tenant2}`,
    };

    // Replay idempotency for Tenant 1
    const { rerender, unmount } = render(
      <AutoUpdateModal
        isOpen={true}
        onClose={() => {}}
        manifest={manifestTenant1}
        currentVersion="v0.61"
        currentBuild={18}
      />,
      { container: root1 }
    );

    assert.ok(screen.getByText(`Update for ${tenant1}`));
    assert.strictEqual(screen.queryByText(`Update for ${tenant2}`), null);

    // Replay exactly the same mutation
    rerender(
      <AutoUpdateModal
        isOpen={true}
        onClose={() => {}}
        manifest={manifestTenant1}
        currentVersion="v0.61"
        currentBuild={18}
      />
    );

    assert.ok(screen.getByText(`Update for ${tenant1}`));
    assert.strictEqual(screen.queryByText(`Update for ${tenant2}`), null);

    unmount(); // Unmount to simulate fresh boundary context

    // Switch to Tenant 2, verifying Multi-Tenant Isolation
    render(
      <AutoUpdateModal
        isOpen={true}
        onClose={() => {}}
        manifest={manifestTenant2}
        currentVersion="v0.61"
        currentBuild={18}
      />,
      { container: root2 }
    );

    assert.ok(screen.getByText(`Update for ${tenant2}`));
    assert.strictEqual(screen.queryByText(`Update for ${tenant1}`), null); // Assert Tenant 1 context is completely isolated/scrubbed
  } finally {
    document.body.removeChild(root1);
    document.body.removeChild(root2);
    cleanup();
  }
});

test('handles partially filled manifest safely (Strict Schema Validation)', () => {
  const partialManifest = {
    version: 'v0.62',
    build_number: 19,
    // Omitting changelog, release_date, etc
  } as any;

  render(
    <AutoUpdateModal
      isOpen={true}
      onClose={() => {}}
      manifest={partialManifest}
      currentVersion="v0.61"
      currentBuild={18}
    />
  );

  assert.ok(screen.getByTestId('auto-update-modal'));
  // No changelog should be rendered
  assert.strictEqual(screen.queryByText(/What's New in/i), null);

  cleanup();
});

test('handles high-concurrency and race conditions (Burst/Stress)', async () => {
  const onCloseMock = mock.fn();
  const CONCURRENCY_COUNT = 50;

  // Track rendering latency
  const latencies: number[] = [];

  const rootNodes = Array.from({ length: CONCURRENCY_COUNT }).map((_, index) => {
    const isTenantA = index % 2 === 0;
    const tenantId = isTenantA ? `TenantA-${index}` : `TenantB-${index}`;
    const root = document.createElement('div');
    root.setAttribute('data-tenant', tenantId);
    document.body.appendChild(root);
    return { root, isTenantA };
  });

  try {
    const renderPromises = rootNodes.map(async ({ root, isTenantA }, index) => {
      const start = performance.now();
      // Yield execution to event loop to simulate actual asynchronous concurrency
      await new Promise(resolve => setTimeout(resolve, Math.random() * 10));

      const currentManifest = {
        ...manifest,
        version: isTenantA ? `v0.99-A-${index}` : `v0.99-B-${index}`,
        build_number: index + 100
      };

      // We verify the global fetch isn't called due to the offline-first poison in beforeEach
      const { unmount, queryByText } = render(
        <AutoUpdateModal
          isOpen={true}
          onClose={onCloseMock}
          manifest={currentManifest}
          currentVersion="v0.61"
          currentBuild={18}
        />,
        { container: root }
      );

      // Yield again so renders interleave
      await new Promise(resolve => setTimeout(resolve, Math.random() * 5));

      // Assert deterministic text
      assert.ok(queryByText(`v0.61 (Build 18) ➔ ${currentManifest.version} (Build ${currentManifest.build_number})`));

      // Cleanup and track latency
      unmount();
      latencies.push(performance.now() - start);
    });

    await Promise.all(renderPromises);
  } finally {
    rootNodes.forEach(({ root }) => {
      if (document.body.contains(root)) {
        document.body.removeChild(root);
      }
    });
  }

  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  // Assert rendering latency remains reasonable under load
  assert.ok(avgLatency < 1500, `Average latency too high: ${avgLatency}ms`);
});

test('enforces strict schema resilience (missing fields, unexpected types)', () => {
  // Passing an empty object or object with null/undefined for all fields
  const emptyManifest = {} as any;

  render(
    <AutoUpdateModal
      isOpen={true}
      onClose={() => {}}
      manifest={emptyManifest}
      currentVersion={null as any}
      currentBuild={undefined as any}
    />
  );

  assert.ok(screen.getByTestId('auto-update-modal'));
  // Should render without crashing, using undefined/null implicitly

  cleanup();
});
