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
});
