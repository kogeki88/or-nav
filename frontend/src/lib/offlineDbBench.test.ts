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
});
