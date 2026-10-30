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
});
