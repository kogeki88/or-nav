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
