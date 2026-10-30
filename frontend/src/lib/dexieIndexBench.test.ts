import "fake-indexeddb/auto";
import { test, describe } from "node:test";
import assert from "node:assert";
import Dexie from "dexie";

// Benchmark database with compound index
class BenchmarkDB extends Dexie {
  inventoryItems!: Dexie.Table<Record<string, unknown>, string>;
  constructor() {
    super("ORNavOfflineDB-Bench");
    this.version(8).stores({
      inventoryItems: "id, tenant_id, item, full_code, phonetic_code, [facility_id+dept_id]",
      offlineOutbox: "++id, tenant_id, type, timestamp",
      unansweredQuestions: "id, hospital_id, status",
      installedPacks: "packId, facilityId, departmentId, roleId, category, versionHash, installedAt",
      chatSessions: "sessionId, tenantId, title, updatedAt",
      peerQuestions: "id, tenantId, status, createdAt",
    });
  }
}

describe("Dexie Compound Index Benchmarks", () => {
  test("Compound queries on [facility_id+dept_id] index latency is < 2ms", async () => {
    const db = new BenchmarkDB();
    const items = [];
    // Seed with 10,000 items to make the index query more realistic
    for (let i = 0; i < 10000; i++) {
      items.push({
        id: `fac_1::dept_1::item_${i}`,
        tenant_id: "fac_1::dept_1",
        facility_id: "fac_1",
        dept_id: i % 2 === 0 ? "dept_1" : "dept_2",
        item: `Item ${i}`,
        status: i % 2 === 0 ? "verified" : "unverified",
      });
    }

    await db.inventoryItems.bulkPut(items);

    const queryCount = 2000;
    let totalLatencyMs = 0;

    for (let i = 0; i < queryCount; i++) {
        const dept = i % 2 === 0 ? "dept_1" : "dept_2";
        const t0 = performance.now();
        const res = await db.inventoryItems
            .where("[facility_id+dept_id]")
            .equals(["fac_1", dept])
            .limit(10) // simulate real-world query with limits
            .toArray();
        const t1 = performance.now();
        totalLatencyMs += (t1 - t0);
        assert.ok(res.length > 0);
    }

    const avgLatency = totalLatencyMs / queryCount;
    console.log(`Average latency for ${queryCount} queries: ${avgLatency.toFixed(4)}ms`);

    // Assert latency < 2ms
    assert.ok(avgLatency < 2, `Average latency ${avgLatency}ms is not less than 2ms`);
  });
});
