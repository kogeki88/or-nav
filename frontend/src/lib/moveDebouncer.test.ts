import { test, describe } from "node:test";
import assert from "node:assert";

// Implementation of move debouncer to batch rapid reports
export function createMoveDebouncer<T>(callback: (items: T[]) => void, delay: number) {
  let timeoutId: NodeJS.Timeout | null = null;
  let batchedItems: T[] = [];

  return (item: T) => {
    batchedItems.push(item);

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      callback([...batchedItems]);
      batchedItems = [];
      timeoutId = null;
    }, delay);
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
});
