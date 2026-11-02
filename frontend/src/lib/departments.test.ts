import { describe, test, beforeEach, afterEach } from "node:test";
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

  describe("Server-Side Rendering (SSR) Context", () => {
    let originalWindow: unknown;

    beforeEach(() => {
      originalWindow = (global as { window?: unknown }).window;
      delete (global as { window?: unknown }).window;
    });

    afterEach(() => {
      (global as { window?: unknown }).window = originalWindow;
    });

    test("getActiveDepartmentId should return DEFAULT_DEPARTMENT_ID when window is undefined", () => {
      assert.strictEqual(getActiveDepartmentId(), DEFAULT_DEPARTMENT_ID);
    });

    test("setActiveDepartmentId should not throw when window is undefined", () => {
      assert.doesNotThrow(() => {
        setActiveDepartmentId("icu_critical_care");
      });
      assert.strictEqual(mockStorage.size, 0);
    });
  });

  describe("Multi-tenant isolation invariants", () => {
    test("mutations from one user/tenant do not improperly leak into or corrupt another user's isolated state", () => {
      const userAStorage = new Map<string, string>();
      const userBStorage = new Map<string, string>();

      const ls = (global as { localStorage?: any }).localStorage;

      // Mock localStorage for User A
      ls.getItem = (key: string) => userAStorage.get(key) || null;
      ls.setItem = (key: string, value: string) => userAStorage.set(key, value);

      setActiveDepartmentId("icu_critical_care");
      assert.strictEqual(getActiveDepartmentId(), "icu_critical_care");
      assert.strictEqual(userAStorage.get(LOCAL_STORAGE_DEPT_KEY), "icu_critical_care");

      // Mock localStorage for User B
      ls.getItem = (key: string) => userBStorage.get(key) || null;
      ls.setItem = (key: string, value: string) => userBStorage.set(key, value);

      // User B should not see User A's department
      assert.strictEqual(getActiveDepartmentId(), DEFAULT_DEPARTMENT_ID);

      // User B sets their own department
      setActiveDepartmentId("er_trauma");
      assert.strictEqual(getActiveDepartmentId(), "er_trauma");
      assert.strictEqual(userBStorage.get(LOCAL_STORAGE_DEPT_KEY), "er_trauma");

      // Verify User A's state is uncorrupted
      ls.getItem = (key: string) => userAStorage.get(key) || null;
      assert.strictEqual(getActiveDepartmentId(), "icu_critical_care");

      // Restore default mockStorage behavior
      ls.getItem = (key: string) => mockStorage.get(key) || null;
      ls.setItem = (key: string, value: string) => mockStorage.set(key, value);
    });
  });

  describe("Offline-first invariants", () => {
    test("should maintain configuration and contract invariants offline without network access", async () => {
      const originalFetch = global.fetch;
      try {
        global.fetch = async () => { throw new Error('Network offline'); };

        setActiveDepartmentId("pacu_periop");
        assert.strictEqual(getActiveDepartmentId(), "pacu_periop");

        const dept = getDepartment(getActiveDepartmentId());
        assert.strictEqual(dept.id, "pacu_periop");
        assert.strictEqual(dept.name, "PACU / Pre-Op");

      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
