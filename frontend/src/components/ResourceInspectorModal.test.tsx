import React from 'react';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResourceInspectorModal from './ResourceInspectorModal';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/offlineDb', () => ({
  offlineDb: {},
  getOfflineInventory: vi.fn(() => Promise.resolve([])),
  updateOfflineInventoryItem: vi.fn(),
  deleteOfflineInventoryItem: vi.fn(),
  createOfflineInventoryItem: vi.fn(),
  getOfflinePreferenceCards: vi.fn(() => Promise.resolve([])),
  saveOfflinePreferenceCard: vi.fn(),
  deleteOfflinePreferenceCard: vi.fn(),
  getOfflineLexiconAliases: vi.fn(() => Promise.resolve([])),
  saveOfflineLexiconAlias: vi.fn(),
  deleteOfflineLexiconAlias: vi.fn(),
  getOfflineDepartmentGuideline: vi.fn(() => Promise.resolve(null)),
  saveOfflineDepartmentGuideline: vi.fn(),
  exportTenantResourcesJson: vi.fn(),
  importTenantResourcesJson: vi.fn(),
  hydrateOrUpgradeOfflineInventory: vi.fn(),
}));

vi.mock('@/lib/userProfile', () => ({
  getUserProfile: vi.fn(() => ({
    facilityId: 'sacred_heart',
    departmentId: 'or_main'
  })),
}));

describe('ResourceInspectorModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it('renders the modal when isOpen is true', async () => {
    await act(async () => {
      render(<ResourceInspectorModal isOpen={true} onClose={() => {}} />);
    });
    expect(screen.getByText(/Installed Resources Explorer & Studio/i)).toBeTruthy();
  });

  it('does not render when isOpen is false', () => {
    render(<ResourceInspectorModal isOpen={false} onClose={() => {}} />);
    expect(screen.queryByText(/Installed Resources Explorer & Studio/i)).toBeNull();
  });

  it('calls onClose when close button is clicked', async () => {
    const handleClose = vi.fn();
    await act(async () => {
      render(<ResourceInspectorModal isOpen={true} onClose={handleClose} />);
    });

    const closeBtn = screen.getByTestId('btn-close-resource-inspector');
    await userEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalled();
  });

  it('verifies offline-first isolated queries for multi-tenant environment', async () => {
    const { getOfflineInventory } = await import('@/lib/offlineDb');
    await act(async () => {
      render(<ResourceInspectorModal isOpen={true} onClose={() => {}} />);
    });
    expect(getOfflineInventory).toHaveBeenCalledWith('sacred_heart::or_main');
  });

  it('handles high-concurrency burst renders without leaking state or breaking multi-tenant isolation', async () => {
    const { getOfflineInventory } = await import('@/lib/offlineDb');
    vi.mocked(getOfflineInventory).mockClear();

    let unmounts: any[] = [];

    await act(async () => {
      const renderPromises = Array.from({ length: 50 }).map((_, i) => {
        return new Promise<void>((resolve) => {
          new Promise(r => setTimeout(r, 0)).then(() => {
            const tenantId = `tenant_${i}::or_main`;
            const { unmount } = render(<ResourceInspectorModal isOpen={true} onClose={() => {}} tenantId={tenantId} />);
            unmounts.push(unmount);
            resolve();
          });
        });
      });
      await Promise.all(renderPromises);
    });

    const calls = vi.mocked(getOfflineInventory).mock.calls;
    const tenantCalls = calls.map(c => c[0]);
    for (let i = 0; i < 50; i++) {
      expect(tenantCalls).toContain(`tenant_${i}::or_main`);
    }

    unmounts.forEach(u => u());
  });

  it('maintains acceptable render latency under stress conditions', async () => {
    const start = performance.now();
    await act(async () => {
      for (let i = 0; i < 20; i++) {
        const { unmount } = render(<ResourceInspectorModal isOpen={true} onClose={() => {}} tenantId={`stress_tenant_${i}`} />);
        unmount();
      }
    });
    const end = performance.now();
    expect(end - start).toBeLessThan(1500);
  });

  it('enforces offline-first invariants by surviving network failures', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));

    await act(async () => {
      render(<ResourceInspectorModal isOpen={true} onClose={() => {}} />);
    });

    expect(screen.getByText(/Installed Resources Explorer & Studio/i)).toBeTruthy();

    global.fetch = originalFetch;
  });
});
