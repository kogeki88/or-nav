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

test("deltaSyncPayload fuzzing and boundaries", async (t) => {
  await t.test("empty arrays and null/undefined handling", () => {
    assert.deepStrictEqual(compressPayload([]), { keys: [], data: [] });
    assert.deepStrictEqual(decompressPayload({ keys: [], data: [] }), []);
    // @ts-expect-error testing invalid input
    assert.deepStrictEqual(compressPayload(null as any), { keys: [], data: [] });
    // @ts-expect-error testing invalid input
    assert.deepStrictEqual(compressPayload(undefined as any), { keys: [], data: [] });
    // @ts-expect-error testing invalid input
    assert.deepStrictEqual(decompressPayload(null as any), []);
  });

  await t.test("malformed compressed payloads", () => {
    // Missing data array
    // @ts-expect-error
    assert.deepStrictEqual(decompressPayload({ keys: ["a"] }), []);
    // Missing keys array
    // @ts-expect-error
    assert.deepStrictEqual(decompressPayload({ data: [[1]] }), []);

    // Mismatched data length (shorter row)
    const malformed1 = { keys: ["a", "b"], data: [[1]] };
    // undefined should be omitted per schema validation / logic, but decompressPayload sets it if missing from data array
    const result1 = decompressPayload<Record<string, unknown>>(malformed1 as any);
    assert.strictEqual(result1[0].a, 1);
    assert.strictEqual(result1[0].b, undefined);
    assert.strictEqual(Object.keys(result1[0]).length, 2);

    // Mismatched data length (longer row)
    const malformed2 = { keys: ["a"], data: [[1, 2]] };
    assert.deepStrictEqual(decompressPayload(malformed2 as any), [{ a: 1 }]);
  });

  await t.test("large payloads (fuzzing)", () => {
    const fuzzData = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      val: Math.random().toString(36).substring(7),
      active: i % 2 === 0,
      nested: { a: i } // Testing complex objects too
    }));
    const compressed = compressPayload(fuzzData);
    const decompressed = decompressPayload(compressed);
    assert.deepStrictEqual(decompressed, fuzzData);
  });
});

test("deltaSyncPayload concurrency, race conditions, and performance benchmarks", async (t) => {
  await t.test("concurrent burst execution and race condition resistance", async () => {
    const numWorkers = 50;
    const workerTask = async (workerId: number) => {
      const data = Array.from({ length: 100 }, (_, i) => ({
        workerId,
        id: i,
        val: `worker-${workerId}-item-${i}`,
        tenant_id: `tenant_${workerId}`,
      }));
      // Simulate asynchronous timing
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
      const compressed = compressPayload(data);
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
      const decompressed = decompressPayload(compressed);
      return decompressed;
    };

    const results = await Promise.all(
      Array.from({ length: numWorkers }, (_, i) => workerTask(i))
    );

    for (let i = 0; i < numWorkers; i++) {
      const decompressed = results[i] as any[];
      assert.strictEqual(decompressed.length, 100);
      assert.strictEqual(decompressed[0].workerId, i);
      assert.strictEqual(decompressed[0].tenant_id, `tenant_${i}`);
    }
  });

  await t.test("latency benchmark for payload compression and decompression", () => {
    const data = Array.from({ length: 10000 }, (_, i) => ({
      id: i,
      tenant_id: "latency_tenant",
      type: "benchmark",
      status: "pending",
      value: i * 100,
    }));

    const startCompress = performance.now();
    const compressed = compressPayload(data);
    const compressTime = performance.now() - startCompress;

    const startDecompress = performance.now();
    const decompressed = decompressPayload(compressed);
    const decompressTime = performance.now() - startDecompress;

    assert.ok(compressTime < 200, `Compression took too long: ${compressTime}ms`);
    assert.ok(decompressTime < 200, `Decompression took too long: ${decompressTime}ms`);
    assert.strictEqual(decompressed.length, 10000);
  });
});
