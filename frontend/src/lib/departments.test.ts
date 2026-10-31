import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  DEPARTMENTS,
  getActiveDepartmentId,
  setActiveDepartmentId,
  getDepartment,
  LOCAL_STORAGE_DEPT_KEY,
  DEFAULT_DEPARTMENT_ID,
} from "./departments.ts";

const mockStorage = new Map<string, string>();
(global as { window?: unknown }).window = {
  dispatchEvent: () => true,
};
(global as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => mockStorage.get(key) || null,
  setItem: (key: string, value: string) => mockStorage.set(key, value),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
};

describe("Departments Configuration and Lookups", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  describe("DEPARTMENTS Definition", () => {
    const requiredDepts = ["or_main", "icu_critical_care", "er_trauma", "pacu_periop"];

    test("should have all required departments registered", () => {
      requiredDepts.forEach((dept) => {
        assert.ok(DEPARTMENTS[dept]);
      });
    });

    test("each department should have valid properties", () => {
      Object.values(DEPARTMENTS).forEach((dept) => {
        assert.ok(dept.id);
        assert.strictEqual(typeof dept.id, "string");

        assert.ok(dept.name);
        assert.strictEqual(typeof dept.name, "string");

        assert.ok(Array.isArray(dept.starterPrompts));
        dept.starterPrompts.forEach((sp) => {
          assert.ok(sp.label);
          assert.ok(sp.prompt);
        });
      });
    });
  });

  describe("getActiveDepartmentId", () => {
    test("should return DEFAULT_DEPARTMENT_ID when no active department is set", () => {
      assert.strictEqual(getActiveDepartmentId(), DEFAULT_DEPARTMENT_ID);
    });

    test("should return the saved department if it is valid", () => {
      mockStorage.set(LOCAL_STORAGE_DEPT_KEY, "er_trauma");
      assert.strictEqual(getActiveDepartmentId(), "er_trauma");
    });

    test("should resolve 'general_memorial_cvor' to DEFAULT_DEPARTMENT_ID", () => {
      mockStorage.set(LOCAL_STORAGE_DEPT_KEY, "general_memorial_cvor");
      assert.strictEqual(getActiveDepartmentId(), DEFAULT_DEPARTMENT_ID);
    });

    test("should fallback to DEFAULT_DEPARTMENT_ID if an invalid ID is saved", () => {
      mockStorage.set(LOCAL_STORAGE_DEPT_KEY, "invalid_dept");
      assert.strictEqual(getActiveDepartmentId(), DEFAULT_DEPARTMENT_ID);
    });
  });

  describe("setActiveDepartmentId", () => {
    test("should save the active department to localStorage", () => {
      setActiveDepartmentId("pacu_periop");
      assert.strictEqual(mockStorage.get(LOCAL_STORAGE_DEPT_KEY), "pacu_periop");
    });
  });

  describe("getDepartment", () => {
    test("should return DEFAULT_DEPARTMENT_ID department if no id is provided", () => {
      const dept = getDepartment();
      assert.deepStrictEqual(dept, DEPARTMENTS[DEFAULT_DEPARTMENT_ID]);
    });

    test("should return or_main when 'general_memorial_cvor' is passed", () => {
      const dept = getDepartment("general_memorial_cvor");
      assert.deepStrictEqual(dept, DEPARTMENTS.or_main);
    });

    test("should return the correct department for a valid id", () => {
      const dept = getDepartment("icu_critical_care");
      assert.deepStrictEqual(dept, DEPARTMENTS.icu_critical_care);
    });

    test("should fallback to DEFAULT_DEPARTMENT_ID department for an invalid id", () => {
      const dept = getDepartment("some_invalid_id");
      assert.deepStrictEqual(dept, DEPARTMENTS[DEFAULT_DEPARTMENT_ID]);
    });
  });
});
