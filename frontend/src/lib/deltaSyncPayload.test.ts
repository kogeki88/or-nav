import test from "node:test";
import assert from "node:assert";
import { compressPayload, decompressPayload } from "./deltaSyncPayload";
import type { OutboxMutation } from "./offlineDb";

test("deltaSyncPayload compact representation", async (t) => {
  await t.test("serializes 50 offline mutations into < 10KB", () => {
    const mutations: OutboxMutation[] = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      type: "verify_move",
      tenant_id: "sacred_heart::or",
      item: `Item ${i} with a fairly long name to simulate real world`,
      expected_location: `Location ${i} Storage Cabinet A Shelf B`,
      reason: "Found in wrong place",
      timestamp: new Date("2024-01-01T00:00:00Z").toISOString(),
    }));

    const compressed = compressPayload(mutations);
    const serialized = JSON.stringify(compressed);
    const sizeKB = serialized.length / 1024;

    assert.ok(sizeKB < 10, `Payload size ${sizeKB.toFixed(2)}KB exceeds 10KB limit`);
  });

  await t.test("deserialization restores 100% of mutation records", () => {
    const mutations: OutboxMutation[] = [
      {
        id: 1,
        type: "verify_move",
        tenant_id: "sacred_heart::or",
        item: `Item 1`,
        timestamp: "2024-01-01T00:00:00Z",
      },
      {
        id: 2,
        type: "flag_wrong",
        tenant_id: "sacred_heart::or",
        item: `Item 2`,
        reason: "wrong size",
        timestamp: "2024-01-01T00:00:00Z",
      }
    ];

    const compressed = compressPayload(mutations);
    // Explicitly cast the decompressed generic to match exactly
    const restored = decompressPayload<Record<string, unknown>>(compressed) as unknown as OutboxMutation[];

    assert.deepStrictEqual(restored, mutations);
  });
});

test("deltaSyncPayload edge cases and invariants", async (t) => {
  await t.test("null/undefined value handling", () => {
    const mutations = [{ id: 1, val: null, other: undefined, str: "a" }];
    const compressed = compressPayload(mutations);

    // undefined becomes null in compressed output, then decompress ignores nulls
    // so undefined keys and null keys are both omitted in output.
    const restored = decompressPayload<Record<string, unknown>>(compressed);
    assert.deepStrictEqual(restored, [{ id: 1, str: "a" }]);
  });

  await t.test("multi-tenant isolation", () => {
    const mutations = [
      { id: 1, tenant_id: "tenantA", data: "x" },
      { id: 2, tenant_id: "tenantB", data: "y" }
    ];
    const compressed = compressPayload(mutations);
    const restored = decompressPayload<Record<string, unknown>>(compressed);

    // Verify tenantA data did not leak into tenantB data
    const tenantAMuts = restored.filter(m => m.tenant_id === "tenantA");
    assert.strictEqual(tenantAMuts.length, 1);
    assert.strictEqual(tenantAMuts[0].data, "x");

    const tenantBMuts = restored.filter(m => m.tenant_id === "tenantB");
    assert.strictEqual(tenantBMuts.length, 1);
    assert.strictEqual(tenantBMuts[0].data, "y");
  });

  await t.test("offline-first invariants with global.fetch mock", async () => {
    const originalFetch = global.fetch;
    try {
      global.fetch = async () => { throw new Error('Network offline'); };

      const mutations = [
        { id: 1, type: "offline_action", tenant_id: "offline_tenant", payload: "test" }
      ];
      const compressed = compressPayload(mutations);

      // Simulate attempting to sync offline, which fails
      let syncFailed = false;
      try {
        await global.fetch("http://example.com/sync", { method: "POST", body: JSON.stringify(compressed) });
      } catch (e) {
        syncFailed = true;
      }
      assert.strictEqual(syncFailed, true);

      // Data must remain intact and restorable from compressed format
      const restored = decompressPayload<Record<string, unknown>>(compressed);
      assert.deepStrictEqual(restored, mutations);

    } finally {
      global.fetch = originalFetch;
    }
  });
});
