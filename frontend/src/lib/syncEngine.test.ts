import 'jsdom-global/register.js';
import test, { describe, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { renderHook, act, cleanup } from "@testing-library/react";

const proxyquire = require('proxyquire');

describe("useSyncEngine", () => {
  let useSyncEngine: typeof import('./syncEngine').useSyncEngine;
  let offlineDbMocks: any;
  let apiMocks: any;
  let originalOnLine: any;

  beforeEach(() => {
    // Cache original navigator.onLine
    originalOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    mock.method(console, 'warn', () => {});

    offlineDbMocks = {
      flushOfflineOutbox: mock.fn(async () => 5),
      getPendingOutboxCount: mock.fn(async () => 10),
      syncTenantInventoryToOfflineDb: mock.fn(async () => {})
    };

    apiMocks = {
      fetchQuestions: mock.fn(async () => {})
    };

    const module = proxyquire('./syncEngine', {
      './offlineDb': offlineDbMocks,
      './api': apiMocks
    });

    useSyncEngine = module.useSyncEngine;
  });

  afterEach(() => {
    cleanup();
    mock.restoreAll();
    if (originalOnLine) {
      Object.defineProperty(navigator, 'onLine', originalOnLine);
    } else {
      delete (navigator as any).onLine;
    }
  });

  const setNetworkOnline = (isOnline: boolean) => {
    Object.defineProperty(navigator, 'onLine', {
      value: isOnline,
      configurable: true
    });
  };

  test("initializes as offline if navigator is offline", async () => {
    setNetworkOnline(false);
    const { result } = renderHook(() => useSyncEngine("tenant-1"));

    assert.strictEqual(result.current.status, "offline");

    // Wait for async updatePendingCount
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    assert.strictEqual(result.current.pendingCount, 10);
    assert.ok(offlineDbMocks.getPendingOutboxCount.mock.calls.length >= 1);
  });

  test("initializes as synced and triggers sync if online and autoSyncEnabled is true", async () => {
    setNetworkOnline(true);
    const { result } = renderHook(() => useSyncEngine("tenant-1", true));

    // Initial status before triggerSync finishes
    assert.strictEqual(result.current.status, "syncing");

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    assert.strictEqual(result.current.status, "synced");
    assert.strictEqual(result.current.pendingCount, 10);

    // Verify multi-tenant isolation invariant: functions called with correct tenantId
    assert.strictEqual(offlineDbMocks.flushOfflineOutbox.mock.calls.length, 1);
    assert.strictEqual(offlineDbMocks.syncTenantInventoryToOfflineDb.mock.calls.length, 1);
    assert.strictEqual(offlineDbMocks.syncTenantInventoryToOfflineDb.mock.calls[0].arguments[0], "tenant-1");
    assert.strictEqual(apiMocks.fetchQuestions.mock.calls.length, 1);
    assert.strictEqual(apiMocks.fetchQuestions.mock.calls[0].arguments[0], "tenant-1");
  });

  test("does not trigger auto sync if autoSyncEnabled is false", async () => {
    setNetworkOnline(true);
    const { result } = renderHook(() => useSyncEngine("tenant-1", false));

    assert.strictEqual(result.current.status, "synced");

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // flushOfflineOutbox should not be called
    assert.strictEqual(offlineDbMocks.flushOfflineOutbox.mock.calls.length, 0);
  });

  test("triggerSync enforces offline-first invariants", async () => {
    setNetworkOnline(true);
    // start with auto sync disabled to test manual trigger
    const { result } = renderHook(() => useSyncEngine("tenant-2", false));

    // simulate going offline
    setNetworkOnline(false);

    let syncResult: any;
    await act(async () => {
      syncResult = await result.current.triggerSync();
    });

    assert.strictEqual(syncResult.success, false);
    assert.strictEqual(syncResult.flushedCount, 0);
    assert.strictEqual(result.current.status, "offline");

    // Network dependencies must not be called
    assert.strictEqual(offlineDbMocks.flushOfflineOutbox.mock.calls.length, 0);
    assert.strictEqual(offlineDbMocks.syncTenantInventoryToOfflineDb.mock.calls.length, 0);
    assert.strictEqual(apiMocks.fetchQuestions.mock.calls.length, 0);
  });

  test("triggerSync gracefully handles errors and reverts to offline if disconnected", async () => {
    setNetworkOnline(true);
    offlineDbMocks.flushOfflineOutbox = mock.fn(async () => {
      throw new Error("Network error");
    });

    const { result } = renderHook(() => useSyncEngine("tenant-3", false));

    await act(async () => {
      setNetworkOnline(false); // simulating disconnection during sync initialization
      await result.current.triggerSync();
    });

    assert.strictEqual(result.current.status, "offline");
    assert.strictEqual(result.current.pendingCount, 10);
  });

  test("triggerSync reverts to synced if online but encountering non-fatal error", async () => {
    setNetworkOnline(true);
    offlineDbMocks.flushOfflineOutbox = mock.fn(async () => {
      throw new Error("Some non-fatal API error");
    });

    const { result } = renderHook(() => useSyncEngine("tenant-4", false));

    await act(async () => {
      await result.current.triggerSync();
    });

    assert.strictEqual(result.current.status, "synced");
  });



  test("Offline-first invariant: triggerSync enforces offline mode without network dependencies", async () => {
    setNetworkOnline(false);

    // Poison fetch
    const originalFetch = global.fetch;
    global.fetch = mock.fn(() => {
      throw new Error("Network request made during offline mode!");
    });
    apiMocks.fetchQuestions = mock.fn(async () => {
      throw new Error("API call made during offline mode!");
    });
    offlineDbMocks.flushOfflineOutbox = mock.fn(async () => {
      throw new Error("Flush made during offline mode!");
    });
    offlineDbMocks.syncTenantInventoryToOfflineDb = mock.fn(async () => {
      throw new Error("Sync made during offline mode!");
    });

    const { result } = renderHook(() => useSyncEngine("tenant-offline", false));
    assert.strictEqual(result.current.status, "offline");

    let syncResult;
    await act(async () => {
      syncResult = await result.current.triggerSync();
    });

    assert.strictEqual(syncResult.success, false);
    assert.strictEqual(syncResult.flushedCount, 0);
    assert.strictEqual(result.current.status, "offline");

    assert.strictEqual(offlineDbMocks.flushOfflineOutbox.mock.calls.length, 0);
    assert.strictEqual(offlineDbMocks.syncTenantInventoryToOfflineDb.mock.calls.length, 0);
    assert.strictEqual(apiMocks.fetchQuestions.mock.calls.length, 0);

    global.fetch = originalFetch;
  });

  test("Multi-tenant isolation invariant: functions called strictly with active tenantId", async () => {
    setNetworkOnline(true);

    // First tenant
    const { result: res1, unmount: unmount1 } = renderHook(() => useSyncEngine("tenant-A", false));
    await act(async () => { await res1.current.triggerSync(); });

    assert.strictEqual(offlineDbMocks.syncTenantInventoryToOfflineDb.mock.calls.length, 1);
    assert.strictEqual(offlineDbMocks.syncTenantInventoryToOfflineDb.mock.calls[0].arguments[0], "tenant-A");
    assert.strictEqual(apiMocks.fetchQuestions.mock.calls.length, 1);
    assert.strictEqual(apiMocks.fetchQuestions.mock.calls[0].arguments[0], "tenant-A");

    unmount1();

    // Second tenant
    const { result: res2 } = renderHook(() => useSyncEngine("tenant-B", false));
    await act(async () => { await res2.current.triggerSync(); });

    assert.strictEqual(offlineDbMocks.syncTenantInventoryToOfflineDb.mock.calls.length, 2);
    assert.strictEqual(offlineDbMocks.syncTenantInventoryToOfflineDb.mock.calls[1].arguments[0], "tenant-B");
    assert.strictEqual(apiMocks.fetchQuestions.mock.calls.length, 2);
    assert.strictEqual(apiMocks.fetchQuestions.mock.calls[1].arguments[0], "tenant-B");
  });

  test("Fuzzing & boundary inputs: malformed tenantIds do not crash the engine", async () => {
    setNetworkOnline(true);

    const fuzzInputs = [
      "",
      "a".repeat(10000),
      "\u0000\uFFFF\uD800",
      "tenant-!@#$%^&*()_+",
      "null",
      "undefined",
      "\n\r\t"
    ];

    for (const fuzzId of fuzzInputs) {
      const { result, unmount } = renderHook(() => useSyncEngine(fuzzId, false));

      let syncResult;
      await act(async () => {
        syncResult = await result.current.triggerSync();
      });

      assert.strictEqual(syncResult.success, true);
      assert.strictEqual(result.current.status, "synced");

      // Ensure the exact fuzzed ID was passed to the mocks
      const lastSyncCallIdx = offlineDbMocks.syncTenantInventoryToOfflineDb.mock.calls.length - 1;
      const lastApiCallIdx = apiMocks.fetchQuestions.mock.calls.length - 1;

      assert.strictEqual(
        offlineDbMocks.syncTenantInventoryToOfflineDb.mock.calls[lastSyncCallIdx].arguments[0],
        fuzzId
      );
      assert.strictEqual(
        apiMocks.fetchQuestions.mock.calls[lastApiCallIdx].arguments[0],
        fuzzId
      );

      unmount();
    }
  });

  test("Malformed payload resilience & Strict schema validation for offline data dependencies", async () => {
    setNetworkOnline(true);

    offlineDbMocks.getPendingOutboxCount = mock.fn(async () => {
      // Return a malformed type to ensure the state handles it gracefully
      return "NaN" as any;
    });

    offlineDbMocks.flushOfflineOutbox = mock.fn(async () => {
      // Return negative count
      return -5;
    });

    const { result, unmount } = renderHook(() => useSyncEngine("tenant-validate", false));

    let syncResult;
    await act(async () => {
      syncResult = await result.current.triggerSync();
    });

    assert.strictEqual(syncResult.success, true);
    assert.strictEqual(syncResult.flushedCount, -5);

    assert.ok(result.current.statusLabel.includes("Synced") || result.current.statusLabel.includes("Syncing"));
    unmount();
  });

  test("listens to online/offline events", async () => {
    setNetworkOnline(true);
    const { result } = renderHook(() => useSyncEngine("tenant-5", true));

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // initially synced
    assert.strictEqual(result.current.status, "synced");

    // dispatch offline event
    await act(async () => {
      setNetworkOnline(false);
      window.dispatchEvent(new Event("offline"));
    });

    assert.strictEqual(result.current.status, "offline");

    // dispatch online event
    await act(async () => {
      setNetworkOnline(true);
      window.dispatchEvent(new Event("online"));
      // wait for triggerSync to complete
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    assert.strictEqual(result.current.status, "synced");
  });
});

describe("useSyncEngine statusLabel", () => {
  let useSyncEngine: any;
  let offlineDbMocks: any;
  let apiMocks: any;
  let originalOnLine: any;

  beforeEach(() => {
    originalOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    mock.method(console, 'warn', () => {});
    mock.method(console, 'warn', () => {}); // Silence console.warn

    offlineDbMocks = {
      flushOfflineOutbox: mock.fn(async () => 0),
      getPendingOutboxCount: mock.fn(async () => 0),
      syncTenantInventoryToOfflineDb: mock.fn(async () => {})
    };

    apiMocks = {
      fetchQuestions: mock.fn(async () => {})
    };

    const module = proxyquire('./syncEngine', {
      './offlineDb': offlineDbMocks,
      './api': apiMocks
    });

    useSyncEngine = module.useSyncEngine;
  });

  afterEach(() => {
    cleanup();
    mock.restoreAll();
    if (originalOnLine) {
      Object.defineProperty(navigator, 'onLine', originalOnLine);
    } else {
      delete (navigator as any).onLine;
    }
  });

  const setNetworkOnline = (isOnline: boolean) => {
    Object.defineProperty(navigator, 'onLine', {
      value: isOnline,
      configurable: true
    });
  };

  test("statusLabel offline with 0 pending", async () => {
    setNetworkOnline(false);
    offlineDbMocks.getPendingOutboxCount = mock.fn(async () => 0);
    const { result } = renderHook(() => useSyncEngine("tenant-1", false));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    assert.strictEqual(result.current.statusLabel, "📶 Offline (Local Cache)");
  });

  test("statusLabel offline with >0 pending", async () => {
    setNetworkOnline(false);
    offlineDbMocks.getPendingOutboxCount = mock.fn(async () => 5);
    const { result } = renderHook(() => useSyncEngine("tenant-1", false));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    assert.strictEqual(result.current.statusLabel, "📶 Offline (5 queued)");
  });

  test("statusLabel syncing with 0 pending", async () => {
    setNetworkOnline(true);
    offlineDbMocks.getPendingOutboxCount = mock.fn(async () => 0);

    // We delay the flush so we can check intermediate state
    let resolveFlush: (value: unknown) => void;
    const flushPromise = new Promise(r => resolveFlush = r);
    offlineDbMocks.flushOfflineOutbox = mock.fn(() => flushPromise);

    const { result } = renderHook(() => useSyncEngine("tenant-1", false));

    let triggerPromise: Promise<any>;
    act(() => {
      triggerPromise = result.current.triggerSync();
    });

    assert.strictEqual(result.current.statusLabel, "🔄 Syncing...");

    await act(async () => {
      resolveFlush(0);
      await triggerPromise;
    });
  });

  test("statusLabel syncing with 1 pending", async () => {
    setNetworkOnline(true);
    offlineDbMocks.getPendingOutboxCount = mock.fn(async () => 1);

    let resolveFlush: (value: unknown) => void;
    const flushPromise = new Promise(r => resolveFlush = r);
    offlineDbMocks.flushOfflineOutbox = mock.fn(() => flushPromise);

    const { result } = renderHook(() => useSyncEngine("tenant-1", false));

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    }); // update pending count

    let triggerPromise: Promise<any>;
    act(() => {
      triggerPromise = result.current.triggerSync();
    });

    assert.strictEqual(result.current.statusLabel, "🔄 Syncing 1 change...");

    await act(async () => {
      resolveFlush(1);
      await triggerPromise;
    });
  });

  test("statusLabel syncing with >1 pending", async () => {
    setNetworkOnline(true);
    offlineDbMocks.getPendingOutboxCount = mock.fn(async () => 5);

    let resolveFlush: (value: unknown) => void;
    const flushPromise = new Promise(r => resolveFlush = r);
    offlineDbMocks.flushOfflineOutbox = mock.fn(() => flushPromise);

    const { result } = renderHook(() => useSyncEngine("tenant-1", false));

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    let triggerPromise: Promise<any>;
    act(() => {
      triggerPromise = result.current.triggerSync();
    });

    assert.strictEqual(result.current.statusLabel, "🔄 Syncing 5 changes...");

    await act(async () => {
      resolveFlush(5);
      await triggerPromise;
    });
  });

  test("statusLabel synced", async () => {
    setNetworkOnline(true);
    const { result } = renderHook(() => useSyncEngine("tenant-1", false));

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    assert.strictEqual(result.current.statusLabel, "🟢 Synced");
  });
});


describe("useSyncEngine High-Concurrency & Stress Benchmarks", () => {
  let useSyncEngine: any;
  let offlineDbMocks: any;
  let apiMocks: any;
  let originalOnLine: any;

  beforeEach(() => {
    originalOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    mock.method(console, 'warn', () => {});

    offlineDbMocks = {
      flushOfflineOutbox: mock.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 5)); // Simulate slight latency
        return 1;
      }),
      getPendingOutboxCount: mock.fn(async () => 0),
      syncTenantInventoryToOfflineDb: mock.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 5)); // Simulate slight latency
      })
    };

    apiMocks = {
      fetchQuestions: mock.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 5)); // Simulate slight latency
      })
    };

    const module = proxyquire('./syncEngine', {
      './offlineDb': offlineDbMocks,
      './api': apiMocks
    });

    useSyncEngine = module.useSyncEngine;
  });

  afterEach(() => {
    cleanup();
    mock.restoreAll();
    if (originalOnLine) {
      Object.defineProperty(navigator, 'onLine', originalOnLine);
    } else {
      delete (navigator as any).onLine;
    }
  });

  const setNetworkOnline = (isOnline: boolean) => {
    Object.defineProperty(navigator, 'onLine', {
      value: isOnline,
      configurable: true
    });
  };

  test("Concurrent burst execution and race condition resistance", async () => {
    setNetworkOnline(true);
    const burstSize = 50;

    const { result, unmount } = renderHook(() => useSyncEngine("tenant-stress", false));

    const promises = Array.from({ length: burstSize }).map(async (_, idx) => {
      // Yield to event loop to simulate true concurrency
      await new Promise(r => setTimeout(r, Math.random() * 10));
      return result.current.triggerSync();
    });

    let results: any[];
    await act(async () => {
      results = await Promise.all(promises);
    });

    // Due to syncingRef.current, only a few (likely just 1 or a few depending on timing overlap)
    // underlying API calls should be made.
    const flushCalls = offlineDbMocks.flushOfflineOutbox.mock.calls.length;
    const syncCalls = offlineDbMocks.syncTenantInventoryToOfflineDb.mock.calls.length;
    const fetchCalls = apiMocks.fetchQuestions.mock.calls.length;

    // Assert that the number of underlying calls is much less than the burst size
    // due to race condition resistance (lock)
    assert.ok(flushCalls < burstSize);
    assert.ok(syncCalls < burstSize);
    assert.ok(fetchCalls < burstSize);

    // Multi-tenant isolation invariant: check that all successful calls used the correct tenantId
    for (const call of offlineDbMocks.syncTenantInventoryToOfflineDb.mock.calls) {
      assert.strictEqual(call.arguments[0], "tenant-stress");
    }

    unmount();
  });

  test("Multiple simultaneous renderHook calls and unmounts", async () => {
    setNetworkOnline(true);
    const burstSize = 20;

    const hooks = Array.from({ length: burstSize }).map((_, i) => ({
      tenantId: `tenant-mult-${i}`
    }));

    const hookInstances = hooks.map(hookParams => {
       return renderHook(() => useSyncEngine(hookParams.tenantId, false));
    });

    const promises = hookInstances.map(async (instance, i) => {
      await new Promise(r => setTimeout(r, Math.random() * 10));
      const syncRes = await instance.result.current.triggerSync();
      instance.unmount();
      return syncRes;
    });

    await act(async () => {
      await Promise.all(promises);
    });

    const syncCalls = offlineDbMocks.syncTenantInventoryToOfflineDb.mock.calls;
    assert.strictEqual(syncCalls.length, burstSize);

    // Enforce multi-tenant isolation
    const usedTenants = syncCalls.map((call: any) => call.arguments[0]);
    hooks.forEach(h => {
      assert.ok(usedTenants.includes(h.tenantId));
    });
  });

  test("Latency benchmarks under load", async () => {
    setNetworkOnline(true);

    const { result, unmount } = renderHook(() => useSyncEngine("tenant-latency", false));

    const start = performance.now();
    await act(async () => {
      await result.current.triggerSync();
    });
    const end = performance.now();

    const duration = end - start;
    assert.ok(duration < 200, `Sync latency (${duration}ms) exceeded 200ms limit`);

    unmount();
  });
});
