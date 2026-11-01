import "fake-indexeddb/auto";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { test, describe } from "node:test";
import assert from "node:assert";
import Dexie from "dexie";

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

// Re-initialize a test database using Dexie explicitly for benchmark
class BenchmarkDB extends Dexie {
  inventoryItems!: Dexie.Table<Record<string, unknown>, string>;
  offlineOutbox!: Dexie.Table<Record<string, unknown>, number>;
  constructor() {
    super("ORNavOfflineDB-Bench");
    this.version(7).stores({
      inventoryItems: "id, tenant_id, item, full_code, phonetic_code, [tenant_id+status]",
      offlineOutbox: "++id, tenant_id, type, timestamp",
      unansweredQuestions: "id, hospital_id, status",
      installedPacks: "packId, facilityId, departmentId, roleId, category, versionHash, installedAt",
      chatSessions: "sessionId, tenantId, title, updatedAt",
      peerQuestions: "id, tenantId, status, createdAt",
    });
  }
}

describe("Dexie Benchmarks", () => {
  test("bulkPut and query is fast", async () => {
    const db = new BenchmarkDB();
    const items = [];
    for (let i = 0; i < 500; i++) {
      items.push({
        id: `tenant_1::item_${i}`,
        tenant_id: "tenant_1",
        item: `Item ${i}`,
        status: i % 2 === 0 ? "verified" : "unverified",
      });
    }

    const t0 = performance.now();
    await db.inventoryItems.bulkPut(items);
    const t1 = performance.now();
    const duration = t1 - t0;

    console.log(`bulkPut 500 items took ${duration.toFixed(2)}ms`);
    assert.ok(duration < 200, `bulkPut took ${duration}ms, which is >= 200ms`);

    // Benchmark querying with compound index
    const t2 = performance.now();
    const query = await db.inventoryItems
      .where("[tenant_id+status]")
      .equals(["tenant_1", "verified"])
      .toArray();
    const t3 = performance.now();
    const queryDuration = t3 - t2;
    console.log(`Query compound index took ${queryDuration.toFixed(2)}ms`);
    assert.strictEqual(query.length, 250);
  });

  test("multi-tenant isolation invariant", async () => {
    const db = new BenchmarkDB();
    const items = [];

    // Add items for tenant_A
    for (let i = 0; i < 100; i++) {
      items.push({
        id: `tenant_A::item_${i}`,
        tenant_id: "tenant_A",
        item: `Item A ${i}`,
        status: "verified",
      });
    }

    // Add items for tenant_B
    for (let i = 0; i < 50; i++) {
      items.push({
        id: `tenant_B::item_${i}`,
        tenant_id: "tenant_B",
        item: `Item B ${i}`,
        status: "verified",
      });
    }

    await db.inventoryItems.bulkPut(items);

    // Query for tenant_A
    const queryA = await db.inventoryItems
      .where("tenant_id")
      .equals("tenant_A")
      .toArray();
    assert.strictEqual(queryA.length, 100, "Should only return tenant_A items");
    assert.ok(queryA.every(item => item.tenant_id === "tenant_A"), "No leakage from tenant_B");

    // Query for tenant_B
    const queryB = await db.inventoryItems
      .where("tenant_id")
      .equals("tenant_B")
      .toArray();
    assert.strictEqual(queryB.length, 50, "Should only return tenant_B items");
    assert.ok(queryB.every(item => item.tenant_id === "tenant_B"), "No leakage from tenant_A");
  });

  test("offline-first invariant outbox partitioning", async () => {
    const db = new BenchmarkDB();

    // Add mutations for different tenants
    const mutations = [
      { tenant_id: "tenant_1", type: "verify_move", timestamp: Date.now() },
      { tenant_id: "tenant_1", type: "create_question", timestamp: Date.now() },
      { tenant_id: "tenant_2", type: "verify_move", timestamp: Date.now() },
    ];

    await db.offlineOutbox.bulkAdd(mutations);

    // Get mutations for tenant_1
    const t1Mutations = await db.offlineOutbox
      .where("tenant_id")
      .equals("tenant_1")
      .toArray();

    assert.strictEqual(t1Mutations.length, 2, "Should retrieve exact outbox mutations for tenant_1");
    assert.ok(t1Mutations.every(m => m.tenant_id === "tenant_1"), "Outbox partition constraint failed");

    // Clear and verify
    await db.offlineOutbox.clear();
    const count = await db.offlineOutbox.count();
    assert.strictEqual(count, 0);
  });

  test("resilience to fuzzing, boundary inputs, and malformed payloads", async () => {
    const db = new BenchmarkDB();

    const VERY_LONG_STRING = "A".repeat(100000);
    const VERY_LONG_TENANT = "tenant_" + "A".repeat(5000);

    const fuzzedItems: any[] = [
      { id: "fuzz::1", tenant_id: "fuzz_tenant", item: "Valid Item", status: "verified" },
      { id: "fuzz::2", tenant_id: "fuzz_tenant", item: VERY_LONG_STRING, status: "verified" },
      { id: "fuzz::3", tenant_id: VERY_LONG_TENANT, item: "Item with long tenant", status: "verified" },
      // Invalid schemas should be handled by dexie or omitted gracefully when querying
      { id: "fuzz::4", tenant_id: "fuzz_tenant", item: "Valid Item 2", status: 12345 }, // Wrong type for status, Dexie allows it but queries might fail or skip
      { id: "fuzz::5", tenant_id: "fuzz_tenant", item: null, status: "verified" },
      { id: "fuzz::6", tenant_id: "fuzz_tenant", item: undefined, status: "verified" },
      { id: "fuzz::7", tenant_id: "fuzz_tenant", item: "Malformed", status: "verified", unexpected_field: { deeply: "nested", payload: [1, 2, 3] } },
    ];

    await db.inventoryItems.bulkPut(fuzzedItems);

    const fuzzedMutations: any[] = [
      { tenant_id: "fuzz_tenant", type: "verify_move", timestamp: Date.now() },
      { tenant_id: "fuzz_tenant", type: VERY_LONG_STRING, timestamp: Date.now() },
      { tenant_id: "fuzz_tenant", type: "verify_move", timestamp: NaN },
      { tenant_id: "fuzz_tenant", type: "verify_move", timestamp: Date.now(), unexpected_field: VERY_LONG_STRING },
    ];

    await db.offlineOutbox.bulkAdd(fuzzedMutations);

    // Verify retrieval works despite fuzzing
    const items = await db.inventoryItems.where("tenant_id").equals("fuzz_tenant").toArray();
    assert.strictEqual(items.length, 6, "Should retrieve 6 items for fuzz_tenant (excluding VERY_LONG_TENANT)");

    const mutations = await db.offlineOutbox.where("tenant_id").equals("fuzz_tenant").toArray();
    assert.strictEqual(mutations.length, 4, "Should retrieve 4 mutations for fuzz_tenant");
    assert.strictEqual(mutations[1].type, VERY_LONG_STRING, "Long string correctly stored in type");

    // Strict Schema Validation: Missing Primary Key
    try {
       await db.inventoryItems.put({ tenant_id: "fuzz_tenant", item: "Missing ID", status: "verified" } as any);
       assert.fail("Should throw an error due to missing primary key (id)");
    } catch (err: any) {
       if (err.name === 'AssertionError') throw err;
       assert.ok(err.name === "DataError", "Error should be DataError due to missing primary key");
    }
  });

  test("concurrent burst execution and race condition resistance", async () => {
    const originalFetch = global.fetch;
    global.fetch = () => Promise.reject(new Error("Network call strictly forbidden during offlineDB benchmark"));

    try {
        const db = new BenchmarkDB();
        const NUM_WORKERS = 50;
        const ITEMS_PER_WORKER = 20;

        const runWorker = async (workerId: number, tenant: string) => {
          const items = [];
          for (let i = 0; i < ITEMS_PER_WORKER; i++) {
            items.push({
              id: `${tenant}::worker${workerId}::item_${i}`,
              tenant_id: tenant,
              item: `Item Worker ${workerId} ${i}`,
              status: i % 2 === 0 ? "verified" : "unverified",
            });
          }
          // Insert concurrently
          await db.inventoryItems.bulkPut(items);

          // Read concurrently
          const readBack = await db.inventoryItems.where("tenant_id").equals(tenant).toArray();
          assert.ok(readBack.length >= ITEMS_PER_WORKER);

          // Update concurrently
          const toUpdate = readBack.slice(0, 10).map(item => ({ ...item, status: "updated" }));
          await db.inventoryItems.bulkPut(toUpdate);

          // Delete concurrently
          const toDelete = readBack.slice(10, 20).map(item => item.id);
          await db.inventoryItems.bulkDelete(toDelete as string[]);
        };

        const t0 = performance.now();
        const workers = Array.from({ length: NUM_WORKERS }).map((_, i) => {
          const tenantId = `tenant_${i % 5}`; // mix of 5 tenants
          return runWorker(i, tenantId);
        });

        await Promise.all(workers);
        const t1 = performance.now();
        const burstDuration = t1 - t0;
        console.log(`Concurrent burst of ${NUM_WORKERS} workers took ${burstDuration.toFixed(2)}ms`);

        // Latency assertion
        assert.ok(burstDuration < 2000, `Concurrent burst took ${burstDuration}ms, which is >= 2000ms`);

        // Verify consistency and multi-tenant isolation invariants post-burst
        for (let t = 0; t < 5; t++) {
            const tenantStr = `tenant_${t}`;
            const tenantItems = await db.inventoryItems.where("tenant_id").equals(tenantStr).toArray();
            assert.ok(tenantItems.length > 0, `${tenantStr} should have items`);
            assert.ok(tenantItems.every(i => i.tenant_id === tenantStr), `No leakage into ${tenantStr}`);
        }
    } finally {
        global.fetch = originalFetch;
    }
  });

  test("multi-tenant boundary enforcement (facility_id::dept_id) and offline mutation replay idempotency", async () => {
    const db = new BenchmarkDB();

    // Insert items with complex tenant IDs (facility::dept)
    const items = [
      { id: "fac1::deptA::1", tenant_id: "fac1::deptA", item: "Item 1", status: "verified" },
      { id: "fac1::deptA::2", tenant_id: "fac1::deptA", item: "Item 2", status: "verified" },
      { id: "fac1::deptB::1", tenant_id: "fac1::deptB", item: "Item 3", status: "verified" },
      { id: "fac2::deptA::1", tenant_id: "fac2::deptA", item: "Item 4", status: "verified" },
    ];
    await db.inventoryItems.bulkPut(items);

    // Query for exactly one tenant ID and verify isolation
    const fac1DeptAItems = await db.inventoryItems.where("tenant_id").equals("fac1::deptA").toArray();
    assert.strictEqual(fac1DeptAItems.length, 2, "Should retrieve exactly items for fac1::deptA");
    assert.ok(fac1DeptAItems.every(i => i.tenant_id === "fac1::deptA"), "Strictly isolates from fac1::deptB and fac2::deptA");

    // Insert duplicate outbox mutations
    const mutations = [
      { tenant_id: "fac1::deptA", type: "update_item", item: "Item 1", timestamp: Date.now() },
      { tenant_id: "fac1::deptA", type: "update_item", item: "Item 1", timestamp: Date.now() + 10 },
      { tenant_id: "fac1::deptA", type: "update_item", item: "Item 1", timestamp: Date.now() + 20 },
      { tenant_id: "fac1::deptA", type: "update_item", item: "Item 2", timestamp: Date.now() },
      { tenant_id: "fac1::deptB", type: "update_item", item: "Item 1", timestamp: Date.now() },
    ];
    await db.offlineOutbox.bulkAdd(mutations);

    // Simulate flushOfflineOutbox deduplication
    const pending = await db.offlineOutbox.toArray();
    const deduplicatedMutations = new Map<string, typeof pending[0]>();
    const mutationIdsByKey = new Map<string, number[]>();

    for (const mut of pending) {
      let deduplicationKey = `${mut.type}::${mut.tenant_id}`;
      if (mut.item) deduplicationKey += `::${mut.item}`;
      if (mut.question_id) deduplicationKey += `::${mut.question_id}`;
      if (mut.question_text) deduplicationKey += `::${mut.question_text}`;

      deduplicatedMutations.set(deduplicationKey, mut);

      const ids = mutationIdsByKey.get(deduplicationKey) || [];
      if (mut.id) ids.push(mut.id as number);
      mutationIdsByKey.set(deduplicationKey, ids);
    }

    // There are 3 deduplicated items from this test, but the offlineOutbox table isn't cleared
    // from earlier tests. So we can't assert the total size of the deduplicated mutations map,
    // but we can ensure our specific keys are correctly grouped.

    const duplicateKey = "update_item::fac1::deptA::Item 1";
    assert.ok(deduplicatedMutations.has(duplicateKey), "Map has duplicate key");
    assert.strictEqual(mutationIdsByKey.get(duplicateKey)?.length, 3, "Duplicate key should map to 3 mutation IDs");

    const otherKey1 = "update_item::fac1::deptA::Item 2";
    assert.ok(deduplicatedMutations.has(otherKey1));
    assert.strictEqual(mutationIdsByKey.get(otherKey1)?.length, 1);

    const otherKey2 = "update_item::fac1::deptB::Item 1";
    assert.ok(deduplicatedMutations.has(otherKey2));
    assert.strictEqual(mutationIdsByKey.get(otherKey2)?.length, 1);
  });
});

  test("Offline Database Bulk Operations Benchmark - bulkPut 600 items in under 200ms", async () => {
    const db = new BenchmarkDB();
    await db.inventoryItems.clear();

    const mockItems = Array.from({ length: 600 }, (_, i) => ({
      id: `item-${i}`,
      tenant_id: 'test-tenant::department',
      item: `Mock Item ${i}`,
      full_code: `CODE-${i}`,
      phonetic_code: `KODE-${i}`,
      status: i % 2 === 0 ? 'available' : 'unavailable',
      category: 'supplies',
      unit_of_issue: 'ea',
    }));

    const start = performance.now();
    await db.inventoryItems.bulkPut(mockItems);
    const duration = performance.now() - start;

    const count = await db.inventoryItems.count();
    assert.strictEqual(count, 600);
    assert.ok(duration < 200, `bulkPut took ${duration}ms, which exceeds the 200ms limit`);

    await db.inventoryItems.clear();
  });

  test("Offline Database Bulk Operations Benchmark - compound index query [tenant_id+status] performance", async () => {
    const db = new BenchmarkDB();
    await db.inventoryItems.clear();

    const mockItems = Array.from({ length: 600 }, (_, i) => ({
      id: `item-${i}`,
      tenant_id: 'test-tenant::department',
      item: `Mock Item ${i}`,
      full_code: `CODE-${i}`,
      phonetic_code: `KODE-${i}`,
      status: i % 2 === 0 ? 'available' : 'unavailable',
      category: 'supplies',
      unit_of_issue: 'ea',
    }));

    await db.inventoryItems.bulkPut(mockItems);
    const start = performance.now();

    const results = await db.inventoryItems
      .where('[tenant_id+status]')
      .equals(['test-tenant::department', 'available'])
      .toArray();

    const duration = performance.now() - start;

    assert.strictEqual(results.length, 300);
    assert.ok(duration < 100, `Compound query took ${duration}ms, which exceeds the 100ms limit`);

    await db.inventoryItems.clear();
  });
