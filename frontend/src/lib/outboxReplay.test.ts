import "fake-indexeddb/auto";
import "jsdom-global/register.js"; // This sets up window natively

import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";

import { flushOfflineOutbox, queueOfflineMutation, offlineDb } from "./offlineDb";

describe("Outbox Replay Idempotency", () => {
  beforeEach(async () => {
    (global as { navigator?: unknown }).navigator = { onLine: true };
    Object.defineProperty(global, "navigator", {
      value: { onLine: true },
      writable: true,
      configurable: true
    });
    if (offlineDb) {
      await offlineDb.offlineOutbox.clear();
    }
  });

  afterEach(() => {
    mock.restoreAll();
  });

  test("duplicate verify_move mutations are idempotent", async () => {
    const fetchMock = mock.fn(async () => {
      return { ok: true } as Response;
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const mutation1 = {
      type: "verify_move" as const,
      tenant_id: "tenant_1",
      item: "Scalpel",
      expected_location: "Room 1",
      timestamp: new Date().toISOString(),
    };

    const mutation2 = {
      type: "verify_move" as const,
      tenant_id: "tenant_1",
      item: "Scalpel",
      expected_location: "Room 1",
      timestamp: new Date().toISOString(),
    };

    await queueOfflineMutation(mutation1);
    await queueOfflineMutation(mutation2);

    const pendingCount = await offlineDb?.offlineOutbox.count();
    assert.strictEqual(pendingCount, 2, "Should have 2 items in outbox");


    await flushOfflineOutbox("http://localhost:8000");


    const finalCount = await offlineDb?.offlineOutbox.count();
    assert.strictEqual(finalCount, 0, "Outbox should be empty");

    assert.strictEqual(fetchMock.mock.callCount(), 1, "Fetch should only be called once for duplicate mutations");
  });
});
