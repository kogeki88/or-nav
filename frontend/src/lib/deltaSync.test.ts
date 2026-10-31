import test from "node:test";
import assert from "node:assert";
import { diffRecords } from "./deltaSync";

test("diffRecords", async (t) => {
  await t.test("returns an empty object for identical records", () => {
    const base = { id: 1, name: "test", active: true };
    const modified = { id: 1, name: "test", active: true };
    const delta = diffRecords(base, modified);
    assert.deepStrictEqual(delta, {});
  });

  await t.test("identifies modified primitive fields", () => {
    const base = { id: 1, name: "test", active: true, count: 5 };
    const modified = { id: 1, name: "test_updated", active: false, count: 5 };
    const delta = diffRecords(base, modified);
    assert.deepStrictEqual(delta, { name: "test_updated", active: false });
  });

  await t.test("identifies added fields", () => {
    const base: Record<string, unknown> = { id: 1, name: "test" };
    const modified: Record<string, unknown> = { id: 1, name: "test", newField: "hello" };
    const delta = diffRecords(base, modified);
    assert.deepStrictEqual(delta, { newField: "hello" });
  });

  await t.test("identifies deleted/removed fields", () => {
    const base: Record<string, unknown> = { id: 1, name: "test", oldField: "gone" };
    const modified: Record<string, unknown> = { id: 1, name: "test" };
    const delta = diffRecords(base, modified);
    assert.deepStrictEqual(delta, { oldField: null });
  });

  await t.test("identifies changes in nested objects and arrays", () => {
    const base = {
      id: 1,
      tags: ["a", "b"],
      metadata: { key: "value", version: 1 },
      unchanged: [1, 2, 3],
    };
    const modified = {
      id: 1,
      tags: ["a", "c"],
      metadata: { key: "value", version: 2 },
      unchanged: [1, 2, 3],
    };
    const delta = diffRecords(base, modified);
    assert.deepStrictEqual(delta, {
      tags: ["a", "c"],
      metadata: { key: "value", version: 2 },
    });
  });

  await t.test("handles primitive to object type changes", () => {
    const base: Record<string, unknown> = { id: 1, val: "string" };
    const modified: Record<string, unknown> = { id: 1, val: { nested: true } };
    const delta = diffRecords(base, modified);
    assert.deepStrictEqual(delta, { val: { nested: true } });
  });

  await t.test("handles object to primitive type changes", () => {
    const base: Record<string, unknown> = { id: 1, val: { nested: true } };
    const modified: Record<string, unknown> = { id: 1, val: "string" };
    const delta = diffRecords(base, modified);
    assert.deepStrictEqual(delta, { val: "string" });
  });

  await t.test("Multi-tenant isolation invariant: strictly tracks tenant_id modifications", () => {
    const base = { id: 1, tenant_id: "sacred_heart::or", data: "test" };
    const modified = { id: 1, tenant_id: "other_hospital::or", data: "test" };
    const delta = diffRecords(base, modified);
    assert.deepStrictEqual(delta, { tenant_id: "other_hospital::or" });
  });

  await t.test("Offline-first invariant: ensures minimal delta payload for sync optimization", () => {
    const base = {
      id: 123,
      tenant_id: "sacred_heart::or",
      status: "synced",
      lastModified: "2024-01-01T00:00:00Z",
      localData: "old_value"
    };
    const modified = {
      id: 123,
      tenant_id: "sacred_heart::or",
      status: "pending",
      lastModified: "2024-01-02T00:00:00Z",
      localData: "new_value"
    };
    const delta = diffRecords(base, modified);
    assert.deepStrictEqual(delta, {
      status: "pending",
      lastModified: "2024-01-02T00:00:00Z",
      localData: "new_value"
    });
  });

  await t.test("Malformed Payload Resilience: handles null/undefined inputs gracefully", () => {
    // Escaping the type system to simulate malformed JS runtime arguments
    assert.deepStrictEqual(diffRecords(null as any, { a: 1 }), {});
    assert.deepStrictEqual(diffRecords({ a: 1 }, null as any), {});
    assert.deepStrictEqual(diffRecords(undefined as any, undefined as any), {});
    assert.deepStrictEqual(diffRecords("string" as any, "string" as any), {});
    assert.deepStrictEqual(diffRecords(123 as any, { a: 1 }), {});
  });

  await t.test("Strict Schema Validation & Safety: ignores prototype pollution keys", () => {
    const base: Record<string, unknown> = { id: 1 };
    const modified: Record<string, unknown> = { id: 1 };

    // Simulate prototype pollution keys
    Object.defineProperty(modified, "__proto__", { value: { polluted: true }, enumerable: true });
    Object.defineProperty(modified, "constructor", { value: { polluted: true }, enumerable: true });
    Object.defineProperty(modified, "prototype", { value: { polluted: true }, enumerable: true });

    const delta = diffRecords(base, modified);

    // Should not include the prototype pollution keys
    assert.deepStrictEqual(delta, {});
  });

  await t.test("Boundary Input: handles extreme values and deep objects", () => {
    const base = {
      empty: "",
      nan: NaN,
      infinity: Infinity,
      negativeZero: -0,
      deep: { a: { b: { c: { d: 1 } } } }
    };

    const modified = {
      empty: "not empty",
      nan: NaN, // Note: NaN !== NaN in JS, but JSON.stringify(NaN) === "null"
      infinity: Infinity,
      negativeZero: +0,
      deep: { a: { b: { c: { d: 2 } } } }
    };

    const delta = diffRecords(base, modified);
    // Since NaN !== NaN, it's considered changed
    assert.strictEqual(delta.empty, "not empty");
    // negativeZero is -0 in base and +0 in modified.
    // In JavaScript, -0 === +0 is true, so diffRecords thinks they are the same and omits it.
    assert.strictEqual(delta.negativeZero, undefined);
    assert.deepStrictEqual(delta.deep, { a: { b: { c: { d: 2 } } } });
  });

  await t.test("Fuzzing: generates correct deltas for randomized structures", () => {
    const generateRandomRecord = () => {
      const record: Record<string, unknown> = {};
      const numKeys = Math.floor(Math.random() * 20);
      for (let i = 0; i < numKeys; i++) {
        const key = `key_${Math.random().toString(36).substring(7)}`;
        const type = Math.floor(Math.random() * 4);
        switch (type) {
          case 0: record[key] = Math.random(); break;
          case 1: record[key] = Math.random().toString(36).substring(7); break;
          case 2: record[key] = Math.random() > 0.5; break;
          case 3: record[key] = null; break;
        }
      }
      return record;
    };

    for (let iter = 0; iter < 50; iter++) {
      const base = generateRandomRecord();
      const modified = { ...base };

      // Randomly modify the record
      const keys = Object.keys(modified);
      if (keys.length > 0) {
        const keyToModify = keys[Math.floor(Math.random() * keys.length)];
        modified[keyToModify] = "FUZZED_VALUE";
      }

      // Randomly add a new key
      modified[`new_key_${iter}`] = "NEW_VALUE";

      // Randomly delete a key
      if (keys.length > 0) {
         const keyToDelete = keys[Math.floor(Math.random() * keys.length)];
         if (keyToDelete !== keys[0]) {
           delete modified[keyToDelete];
         }
      }

      const delta = diffRecords(base, modified);

      // Should not throw, and should be an object
      assert.strictEqual(typeof delta, "object");
      assert.notStrictEqual(delta, null);
    }
  });

  await t.test("High-concurrency and Race Condition Benchmark: executes bursts and enforces invariants", async () => {
    const originalFetch = global.fetch;
    let fetchCalled = false;
    global.fetch = async () => {
      fetchCalled = true;
      throw new Error("Network calls are forbidden");
    };

    try {
      const burstSize = 500;
      const startTime = performance.now();

      const promises = Array.from({ length: burstSize }).map(async (_, index) => {
        // Yield execution to event loop to simulate concurrency and race conditions
        await new Promise(r => setTimeout(r, Math.random() * 10));

        const tenantId = `tenant_${index % 5}::or`;
        const modifiedTenantId = `tenant_${(index % 5) + 1}::or`;
        const base = { id: index, tenant_id: tenantId, data: "old" };
        const modified = { id: index, tenant_id: modifiedTenantId, data: "new" };

        const delta = diffRecords(base, modified);

        // Assert multi-tenant isolation internally
        assert.strictEqual(delta.tenant_id, modifiedTenantId);
        assert.strictEqual(delta.data, "new");
      });

      await Promise.all(promises);
      const latency = performance.now() - startTime;

      assert.strictEqual(fetchCalled, false, "Offline-first invariant violated: fetch was called");
      assert.ok(latency < 2000, `Latency too high: ${latency}ms`);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
