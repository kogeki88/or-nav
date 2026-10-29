/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";
import { renderHook, act, cleanup } from "@testing-library/react";
import * as offlineDb from "./offlineDb";
import * as api from "./api";
import { useSyncEngine } from "./syncEngine";

describe("useSyncEngine offline outbox and network resilience", () => {
  let originalNavigatorOnLine: any;

  beforeEach(() => {
    mock.restoreAll();

    // Mock global fetch for questions
    global.fetch = mock.fn(async () => {
      return { ok: true, json: async () => ({}) } as Response;
    });

    originalNavigatorOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
      writable: true,
    });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
      writable: true,
    });
  });

  afterEach(async () => {
    mock.restoreAll();
    cleanup();

    if (originalNavigatorOnLine) {
        Object.defineProperty(navigator, 'onLine', originalNavigatorOnLine);
    }

    const db = await offlineDb.selfHealOfflineDatabase();
    if (db) await db.offlineOutbox.clear();
  });

  test("initializes correctly when online", async () => {
    const getPendingOutboxCountMock = mock.method(offlineDb, "getPendingOutboxCount", async () => 0);
    const flushOfflineOutboxMock = mock.method(offlineDb, "flushOfflineOutbox", async () => 0);
    const syncTenantInventoryMock = mock.method(offlineDb, "syncTenantInventoryToOfflineDb", async () => {});
    const fetchQuestionsMock = mock.method(api, "fetchQuestions", async () => {});

    const { result, unmount } = renderHook(() => useSyncEngine("test_tenant"));

    assert.equal(result.current.status, "syncing");

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    assert.equal(result.current.status, "synced");
    assert.equal(getPendingOutboxCountMock.mock.callCount() >= 1, true);
    assert.equal(flushOfflineOutboxMock.mock.callCount(), 1);

    unmount();
  });

  test("queues inventory move transactions in offline outbox when network is disconnected", async () => {
    const getPendingOutboxCountMock = mock.method(offlineDb, "getPendingOutboxCount", async () => 1);
    const flushOfflineOutboxMock = mock.method(offlineDb, "flushOfflineOutbox", async () => 0);

    Object.defineProperty(navigator, 'onLine', { value: false });

    const { result, unmount } = renderHook(() => useSyncEngine("test_tenant"));

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    assert.equal(result.current.status, "offline");
    assert.equal(result.current.pendingCount, 1);

    assert.equal(flushOfflineOutboxMock.mock.callCount(), 0);

    unmount();
  });

  test("handles exponential retry backoff on HTTP 503/timeout responses", async () => {
    const activeDb = await offlineDb.selfHealOfflineDatabase();
    await activeDb?.offlineOutbox.clear();
    await activeDb?.offlineOutbox.put({ id: 1, type: "verify_move", tenant_id: "test", item: "scissors", expected_location: "OR 1", timestamp: Date.now().toString() });

    let fetchCount = 0;
    global.fetch = mock.fn(async () => {
      fetchCount++;
      if (fetchCount < 3) {
        throw new Error("Network timeout");
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    const startTime = Date.now();
    const count = await offlineDb.flushOfflineOutbox("http://fake-api");
    const elapsed = Date.now() - startTime;

    assert.equal(count, 1);
    assert.equal(fetchCount, 3);
    assert.equal(elapsed >= 400, true);

    const remaining = await activeDb?.offlineOutbox.count();
    assert.equal(remaining, 0);
  });

  test("successful flushing of pending outbox items when connectivity restores", async () => {
    Object.defineProperty(navigator, 'onLine', { value: false });

    const getPendingOutboxCountMock = mock.method(offlineDb, "getPendingOutboxCount", async () => 2);
    const flushOfflineOutboxMock = mock.method(offlineDb, "flushOfflineOutbox", async () => 2);
    const syncTenantInventoryMock = mock.method(offlineDb, "syncTenantInventoryToOfflineDb", async () => {});

    const { result, unmount } = renderHook(() => useSyncEngine("test_tenant"));

    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    assert.equal(result.current.status, "offline");
    assert.equal(flushOfflineOutboxMock.mock.callCount(), 0);

    Object.defineProperty(navigator, 'onLine', { value: true });

    getPendingOutboxCountMock.mock.mockImplementation(async () => 0);

    await act(async () => {
      const ev = new window.Event('online');
      window.dispatchEvent(ev);
      await new Promise(r => setTimeout(r, 50));
    });

    assert.equal(result.current.status, "synced");
    assert.equal(flushOfflineOutboxMock.mock.callCount(), 1);
    assert.equal(result.current.pendingCount, 0);

    unmount();
  });
});
