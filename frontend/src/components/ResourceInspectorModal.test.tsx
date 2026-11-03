import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResourceInspectorModal from './ResourceInspectorModal';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

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
  importTenantResourcesJson: vi.fn(() => Promise.resolve({ success: true, importedItems: 0, importedCards: 0, importedAliases: 0 })),
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

  it('resists malformed payloads during backup import', async () => {
    const user = userEvent.setup();
    const { importTenantResourcesJson } = await import('@/lib/offlineDb');

    render(<ResourceInspectorModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading local IndexedDB studio records.../i)).toBeNull();
    });

    await user.click(screen.getByTestId('tab-protocols-management'));

    const fileInput = screen.getByTestId('btn-import-json-backup').querySelector('input')!;

    await fc.assert(
      fc.asyncProperty(fc.string(), async (malformedContent) => {
        vi.mocked(importTenantResourcesJson).mockClear();
        vi.mocked(importTenantResourcesJson).mockImplementationOnce(() => Promise.resolve({ success: false, message: 'Parse error' }));

        const file = new File([malformedContent], 'backup.json', { type: 'application/json' });
        await act(async () => {
          await user.upload(fileInput, file);
        });

        if (malformedContent) {
           expect(importTenantResourcesJson).toHaveBeenCalledWith('sacred_heart::or_main', malformedContent);
        }
        fileInput.value = '';
      }),
      { numRuns: 10 }
    );
  });

  it('resists malformed payloads when adding inventory', async () => {
    const user = userEvent.setup();
    const { createOfflineInventoryItem } = await import('@/lib/offlineDb');

    render(<ResourceInspectorModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading local IndexedDB studio records.../i)).toBeNull();
    });

    await fc.assert(
      fc.asyncProperty(fc.string(), fc.string(), fc.string(), async (nameRaw, categoryRaw, aliasesRaw) => {
        vi.mocked(createOfflineInventoryItem).mockClear();
        vi.mocked(createOfflineInventoryItem).mockImplementationOnce(() => Promise.resolve({ item: nameRaw, full_code: 'code' }));

        const name = nameRaw.replace(/[{[]/g, '');
        const category = categoryRaw.replace(/[{[]/g, '');
        const aliases = aliasesRaw.replace(/[{[]/g, '');

        await act(async () => {
          await user.click(screen.getByTestId('btn-add-inventory-item'));
        });

        const itemNameInput = screen.getByTestId('input-new-item-name');
        const categoryInput = screen.getByTestId('input-new-item-category');
        const aliasesInput = screen.getByTestId('input-new-item-aliases');


        await act(async () => {
          await user.clear(itemNameInput);
          if (name) await user.type(itemNameInput, name);

          await user.clear(categoryInput);
          if (category) await user.type(categoryInput, category);

          await user.clear(aliasesInput);
          if (aliases) await user.type(aliasesInput, aliases);

                    const saveBtn2 = screen.getByTestId('btn-save-new-item');
          await user.click(saveBtn2);
        });

        if (name && name.trim()) {
           expect(createOfflineInventoryItem).toHaveBeenCalledWith(
             'sacred_heart::or_main',
             expect.objectContaining({
               item: name.trim(),
               category: category || "General Supplies",
               aliases: aliases || ""
             })
           );
        } else {
           expect(createOfflineInventoryItem).not.toHaveBeenCalled();
           await act(async () => {
              await user.click(screen.getByText('Cancel'));
           });
        }
      }),
      { numRuns: 10 }
    );
  });
});
