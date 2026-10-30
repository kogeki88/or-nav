import "fake-indexeddb/auto";
import { test, describe } from "node:test";
import assert from "node:assert";
import Dexie from "dexie";

class BenchmarkDB extends Dexie {
  inventoryItems!: Dexie.Table<Record<string, unknown>, string>;
  constructor() {
    super("ORNavOfflineDB-HydrationBench");
    this.version(1).stores({
      inventoryItems: "id, tenant_id, item, status",
    });
  }
}

describe("Seed Hydration Batching Benchmarks", () => {
  test("Benchmark Dexie bulkPut vs sequential put for 5,000 items", async () => {
    const db = new BenchmarkDB();
    const items = [];
    for (let i = 0; i < 5000; i++) {
      items.push({
        id: `tenant_bench::item_${i}`,
        tenant_id: "tenant_bench",
        item: `Bench Item ${i}`,
        status: i % 2 === 0 ? "verified" : "unverified",
      });
    }

    // 1. Sequential Put Benchmark
    await db.inventoryItems.clear();
    const t0Seq = performance.now();
    for (const item of items) {
      await db.inventoryItems.put(item);
    }
    const t1Seq = performance.now();
    const seqDuration = t1Seq - t0Seq;
    console.log(`Sequential put 5000 items took ${seqDuration.toFixed(2)}ms`);

    // 2. Full bulkPut Benchmark
    await db.inventoryItems.clear();
    const t0Bulk = performance.now();
    await db.inventoryItems.bulkPut(items);
    const t1Bulk = performance.now();
    const bulkDuration = t1Bulk - t0Bulk;
    console.log(`Full bulkPut 5000 items took ${bulkDuration.toFixed(2)}ms`);

    // 3. Chunked bulkPut Benchmark
    await db.inventoryItems.clear();
    const chunkSize = 500;
    const chunkDurations: number[] = [];

    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      const t0Chunk = performance.now();
      await db.inventoryItems.bulkPut(chunk);
      const t1Chunk = performance.now();
      chunkDurations.push(t1Chunk - t0Chunk);
    }

    const totalChunkDuration = chunkDurations.reduce((a, b) => a + b, 0);
    console.log(`Chunked bulkPut 5000 items took ${totalChunkDuration.toFixed(2)}ms total`);

    // Assert bulkPut batches items in chunks of 500 to keep IndexedDB lock duration under 50ms.
    for (let i = 0; i < chunkDurations.length; i++) {
      console.log(`Chunk ${i} took ${chunkDurations[i].toFixed(2)}ms`);
      assert.ok(
        chunkDurations[i] < 50,
        `Chunk ${i} took ${chunkDurations[i]}ms, which exceeds the 50ms lock duration limit`
      );
    }
  });
});
