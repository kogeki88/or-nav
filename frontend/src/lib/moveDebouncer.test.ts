import { test, describe } from "node:test";
import assert from "node:assert";

// Implementation of move debouncer to batch rapid reports
export function createMoveDebouncer<T>(
  callback: (items: T[]) => void,
  delay: number,
  validator?: (item: T) => boolean
) {
  let timeoutId: NodeJS.Timeout | null = null;
  let batchedItems: T[] = [];
  const safeDelay = Math.max(0, delay);

  return (item: T) => {
    if (validator && !validator(item)) {
      return;
    }

    batchedItems.push(item);

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      callback([...batchedItems]);
      batchedItems = [];
      timeoutId = null;
    }, safeDelay);
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("moveDebouncer", () => {
  test("batches rapid item move reports from multiple clinicians", async () => {
    let callbackTriggered = 0;
    let receivedItems: any[] = [];

    const debouncer = createMoveDebouncer((items: any[]) => {
      callbackTriggered++;
      receivedItems = items;
    }, 50);

    debouncer({ clinician: "Alice", item: "3-0 silk", loc: "OR 1" });
    debouncer({ clinician: "Bob", item: "10 blade", loc: "OR 1" });
    debouncer({ clinician: "Charlie", item: "bovie", loc: "OR 1" });

    // Ensure callback has not been triggered yet
    assert.strictEqual(callbackTriggered, 0);

    // Wait for debounce delay
    await sleep(80);

    assert.strictEqual(callbackTriggered, 1);
    assert.strictEqual(receivedItems.length, 3);
    assert.deepStrictEqual(receivedItems, [
      { clinician: "Alice", item: "3-0 silk", loc: "OR 1" },
      { clinician: "Bob", item: "10 blade", loc: "OR 1" },
      { clinician: "Charlie", item: "bovie", loc: "OR 1" }
    ]);
  });

  test("triggers multiple times if delay passes between batches", async () => {
    let callbackTriggered = 0;
    const receivedBatches: any[][] = [];

    const debouncer = createMoveDebouncer((items: any[]) => {
      callbackTriggered++;
      receivedBatches.push(items);
    }, 50);

    debouncer("report1");
    await sleep(80);

    assert.strictEqual(callbackTriggered, 1);
    assert.deepStrictEqual(receivedBatches[0], ["report1"]);

    debouncer("report2");
    debouncer("report3");
    await sleep(80);

    assert.strictEqual(callbackTriggered, 2);
    assert.deepStrictEqual(receivedBatches[1], ["report2", "report3"]);
  });

  test("handles empty queue correctly after execution", async () => {
    let callbackTriggered = 0;

    const debouncer = createMoveDebouncer((items: any[]) => {
      callbackTriggered++;
    }, 50);

    debouncer("item");
    await sleep(80);
    assert.strictEqual(callbackTriggered, 1);

    // If delay passes again without calls, it should NOT trigger again
    await sleep(80);
    assert.strictEqual(callbackTriggered, 1);
  });

  test("preserves multi-tenant identifiers and offline-first data structure without modification", async () => {
    let receivedItems: any[] = [];

    const debouncer = createMoveDebouncer((items: any[]) => {
      receivedItems = items;
    }, 50);

    const payload1 = {
      tenant_id: "sacred_heart::or",
      offline_sync: { keys: ["id", "val"], data: [1, "test"] }
    };

    const payload2 = {
      tenant_id: "sacred_heart::icu",
      offline_sync: { keys: ["id", "val"], data: [2, null] }
    };

    debouncer(payload1);
    debouncer(payload2);

    await sleep(80);

    assert.strictEqual(receivedItems.length, 2);
    assert.deepStrictEqual(receivedItems[0], payload1);
    assert.deepStrictEqual(receivedItems[1], payload2);
  });

  test("handles boundary delays (0 and negative)", async () => {
    let callbackTriggered = 0;
    const debouncerNeg = createMoveDebouncer((items: any[]) => {
      callbackTriggered++;
    }, -50);

    debouncerNeg("item1");
    await sleep(10);
    assert.strictEqual(callbackTriggered, 1);

    const debouncerZero = createMoveDebouncer((items: any[]) => {
      callbackTriggered++;
    }, 0);

    debouncerZero("item2");
    await sleep(10);
    assert.strictEqual(callbackTriggered, 2);
  });

  test("enforces strict schema validation and filters malformed payloads", async () => {
    let receivedItems: any[] = [];

    // Strict schema: must be object, have tenant_id (string), item (string)
    const strictValidator = (payload: any) => {
      if (!payload || typeof payload !== "object") return false;
      if (typeof payload.tenant_id !== "string" || !payload.tenant_id.includes("::")) return false;
      if (typeof payload.item !== "string" || payload.item.trim() === "") return false;
      return true;
    };

    const debouncer = createMoveDebouncer((items: any[]) => {
      receivedItems = items;
    }, 50, strictValidator);

    debouncer({ tenant_id: "sacred_heart::or", item: "bovie" }); // valid
    debouncer(null); // invalid
    debouncer("not an object"); // invalid
    debouncer({ tenant_id: "sacred_heart", item: "bovie" }); // invalid tenant_id format
    debouncer({ tenant_id: "sacred_heart::or", item: 123 }); // invalid item type
    debouncer({ tenant_id: "sacred_heart::or", item: "" }); // invalid item (empty)
    debouncer({ tenant_id: "sacred_heart::or", item: "forceps", extra: "allowed" }); // valid

    await sleep(80);

    assert.strictEqual(receivedItems.length, 2);
    assert.strictEqual(receivedItems[0].item, "bovie");
    assert.strictEqual(receivedItems[1].item, "forceps");
  });

  test("fuzzing: handles large number of concurrent-like calls with mixed valid/invalid data", async () => {
    let receivedItems: any[] = [];
    let callCount = 0;

    const validator = (payload: any) => payload && typeof payload === "object" && typeof payload.id === "number";

    const debouncer = createMoveDebouncer((items: any[]) => {
      receivedItems.push(...items);
      callCount++;
    }, 20, validator);

    let validCount = 0;
    for (let i = 0; i < 1000; i++) {
      const isValid = i % 3 !== 0;
      if (isValid) {
        validCount++;
        debouncer({ id: i });
      } else {
        debouncer(`invalid-${i}`);
      }
    }

    await sleep(50);

    assert.strictEqual(callCount, 1);
    assert.strictEqual(receivedItems.length, validCount);

    // Test that the items were correctly collected in order
    const firstValidIndex = 1;
    assert.strictEqual(receivedItems[0].id, firstValidIndex);
  });

  test("high-concurrency benchmark with multi-tenant isolation and offline-first invariants", async () => {
    // Poison global.fetch to assert offline-first
    const originalFetch = global.fetch;
    global.fetch = () => {
      throw new Error("Network call detected! Offline-first invariant violated.");
    };

    try {
      const receivedItems: any[] = [];
      const callCounts = new Map<string, number>();

      const validator = (payload: any) => payload && typeof payload.tenant_id === "string";

      const debouncer = createMoveDebouncer((items: any[]) => {
        receivedItems.push(...items);
        for (const item of items) {
          const count = callCounts.get(item.tenant_id) || 0;
          callCounts.set(item.tenant_id, count + 1);
        }
      }, 50, validator);

      const numRequests = 10000;
      const tenants = ["tenantA::or", "tenantB::icu", "tenantC::er"];
      const payloads = Array.from({ length: numRequests }, (_, i) => ({
        tenant_id: tenants[i % tenants.length],
        id: i,
        data: `data-${i}`
      }));

      const startTime = performance.now();

      // Simulate concurrent burst traffic
      await Promise.all(
        payloads.map((payload) =>
          new Promise<void>((resolve) => {
            // Random micro-delays to simulate real concurrency/race conditions
            setTimeout(() => {
              debouncer(payload);
              resolve();
            }, Math.random() * 10);
          })
        )
      );

      // Wait for debouncer to flush
      await sleep(100);

      const endTime = performance.now();
      const latency = endTime - startTime;

      // Validate latency (should not take more than a few hundred milliseconds beyond the delays)
      assert.ok(latency < 1000, `Execution took too long: ${latency}ms`);

      // Verify all items are collected
      assert.strictEqual(receivedItems.length, numRequests);

      // Verify multi-tenant isolation
      assert.strictEqual(callCounts.get("tenantA::or"), 3334);
      assert.strictEqual(callCounts.get("tenantB::icu"), 3333);
      assert.strictEqual(callCounts.get("tenantC::er"), 3333);

    } finally {
      // Restore original fetch
      global.fetch = originalFetch;
    }
  });

  test("offline mutation replay idempotency and multi-tenant boundaries (facility_id::dept_id)", async () => {
    const receivedItems: any[] = [];
    const callCounts = new Map<string, number>();

    const validator = (payload: any) => payload && typeof payload.tenant_id === "string";

    const debouncer = createMoveDebouncer((items: any[]) => {
      receivedItems.push(...items);
      for (const item of items) {
        const count = callCounts.get(item.tenant_id) || 0;
        callCounts.set(item.tenant_id, count + 1);
      }
    }, 50, validator);

    // Payload representing an offline mutation to be replayed multiple times
    const payloadA = {
      tenant_id: "facility1::deptA",
      mutation_id: "offline_mut_123",
      action: "UPDATE",
      data: { status: "completed" }
    };

    // Payload from another tenant to ensure interleaving doesn't break boundaries
    const payloadB = {
      tenant_id: "facility2::deptB",
      mutation_id: "offline_mut_456",
      action: "UPDATE",
      data: { status: "started" }
    };

    // Simulate replay of the same offline mutation interleaved with another tenant's requests
    debouncer(payloadA); // Attempt 1
    debouncer(payloadB); // Interleaved request
    debouncer(payloadA); // Attempt 2 (replay)
    debouncer(payloadB);
    debouncer(payloadA); // Attempt 3 (replay)

    await sleep(80);

    // The moveDebouncer is generic and batches everything passed to it within the window.
    // True "idempotency" is handled downstream, but here we verify that the debouncer
    // correctly captures all replays without mutating the payloads and maintains
    // strict multi-tenant association.
    assert.strictEqual(receivedItems.length, 5);

    // Ensure all requests from facility1::deptA are present and identical
    const itemsA = receivedItems.filter(i => i.tenant_id === "facility1::deptA");
    assert.strictEqual(itemsA.length, 3);
    itemsA.forEach(item => {
      assert.deepStrictEqual(item, payloadA);
    });

    // Ensure all requests from facility2::deptB are present and identical
    const itemsB = receivedItems.filter(i => i.tenant_id === "facility2::deptB");
    assert.strictEqual(itemsB.length, 2);
    itemsB.forEach(item => {
      assert.deepStrictEqual(item, payloadB);
    });

    // Final multi-tenant counts verification
    assert.strictEqual(callCounts.get("facility1::deptA"), 3);
    assert.strictEqual(callCounts.get("facility2::deptB"), 2);
  });
});
