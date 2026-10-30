import "fake-indexeddb/auto";
import { test, describe } from "node:test";
import assert from "node:assert";
import Dexie from "dexie";

// Re-initialize a test database using Dexie explicitly for benchmark
class BenchmarkDB extends Dexie {
  inventoryItems!: Dexie.Table<Record<string, unknown>, string>;
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
});
