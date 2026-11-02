import { test } from "node:test";
import assert from "node:assert/strict";
import { getActiveDepartmentId, setActiveDepartmentId, DEFAULT_DEPARTMENT_ID, getDepartment, LOCAL_STORAGE_DEPT_KEY } from "./src/lib/departments.ts";

const mockStorage = new Map<string, string>();
(global as any).window = {};
(global as any).localStorage = {
  getItem: (key: string) => mockStorage.get(key) || null,
  setItem: (key: string, value: string) => mockStorage.set(key, value),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};

test("fuzzing and boundary inputs", () => {
    mockStorage.clear();
    const fuzzInputs = [
        "",
        "   ",
        "null",
        "undefined",
        "{}",
        "[]",
        "<script>alert(1)</script>",
        "DROP TABLE departments;",
        "' OR '1'='1",
        "or_main\0",
        "a".repeat(10000), // Huge string
        // Note: we can't test actual numbers or objects if TS types are strictly string, but we can test malformed strings.
    ];

    for (const input of fuzzInputs) {
        // Test setActiveDepartmentId
        assert.doesNotThrow(() => setActiveDepartmentId(input));

        // It sets it in local storage, but getActiveDepartmentId should fall back to DEFAULT if not in DEPARTMENTS
        assert.strictEqual(getActiveDepartmentId(), DEFAULT_DEPARTMENT_ID, `Failed on getActiveDepartmentId for input: ${input}`);

        // Test getDepartment
        const dept = getDepartment(input);
        assert.deepStrictEqual(dept, getDepartment(DEFAULT_DEPARTMENT_ID), `Failed on getDepartment for input: ${input}`);
    }
});
