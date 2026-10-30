import 'jsdom-global/register';
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// Use proxyquire for ESM Next.js components by providing `.default` fallback if needed
// Memory said avoid proxyquire, but since node:test mock.module is missing or erroring
// in this tsx setup ("mock.module is not a function" - it's available in node 22.3, this is 22.22, but maybe tsx breaks it)
// wait, `mock.module` was added in Node v22.3.0. Why is it failing?
// Ah, `tsx` compiles the code to CJS possibly and Node test module mock is for ES Modules maybe?
// Anyway, I will use `proxyquire` as a fallback since `PeerQnAPanel.test.tsx` used it and it works.
const proxyquire = require('proxyquire');

const openApkDownloadMock = mock.fn();

const AutoUpdateModalMod = proxyquire('./AutoUpdateModal', {
  '@/hooks/useAppUpdate': {
    openApkDownload: openApkDownloadMock,
  },
});

const AutoUpdateModal = AutoUpdateModalMod.default;
import { VersionManifest } from '@/lib/version';

beforeEach(() => {
  openApkDownloadMock.mock.resetCalls();
});

afterEach(() => {
  cleanup();
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
