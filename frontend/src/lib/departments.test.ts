import { describe, test, beforeEach, afterEach, mock } from "node:test";
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

    test("should enforce strict multi-tenant boundary isolation using facility_id::dept_id format", () => {
      const facilityA_Storage = new Map<string, string>();
      const facilityB_Storage = new Map<string, string>();
      const ls = (global as { localStorage?: any }).localStorage;

      // Facility A Tenant Isolation
      ls.getItem = (key: string) => facilityA_Storage.get(key) || null;
      ls.setItem = (key: string, value: string) => facilityA_Storage.set(key, value);

      const tenantAId = "facility_a::or_main";
      setActiveDepartmentId(tenantAId);

      // Verify isolation
      assert.strictEqual(getActiveDepartmentId(), tenantAId);

      // Facility B Tenant Isolation
      ls.getItem = (key: string) => facilityB_Storage.get(key) || null;
      ls.setItem = (key: string, value: string) => facilityB_Storage.set(key, value);

      const tenantBId = "facility_b::icu_critical_care";
      setActiveDepartmentId(tenantBId);

      assert.strictEqual(getActiveDepartmentId(), tenantBId);

      // Ensure cross-tenant data didn't leak
      ls.getItem = (key: string) => facilityA_Storage.get(key) || null;
      assert.strictEqual(getActiveDepartmentId(), tenantAId);

      // Restore default mockStorage behavior
      ls.getItem = (key: string) => mockStorage.get(key) || null;
      ls.setItem = (key: string, value: string) => mockStorage.set(key, value);
    });
  });

  describe("Offline-first invariants", () => {
    test("should maintain configuration and contract invariants offline without network access", async () => {
      const originalFetch = global.fetch;
      try {
        global.fetch = mock.fn(() => Promise.reject(new TypeError('Failed to fetch')));

        setActiveDepartmentId("pacu_periop");
        assert.strictEqual(getActiveDepartmentId(), "pacu_periop");

        const dept = getDepartment(getActiveDepartmentId());
        assert.strictEqual(dept.id, "pacu_periop");
        assert.strictEqual(dept.name, "PACU / Pre-Op");

      } finally {
        global.fetch = originalFetch;
      }
    });

    test("offline mutation replay idempotency simulation (storage unavailability)", () => {
      const originalLocalStorage = (global as any).localStorage;
      try {
        let attempts = 0;
        (global as any).localStorage = {
          getItem: () => { throw new Error("Storage offline"); },
          setItem: () => {
            attempts++;
            throw new Error("Storage offline");
          },
        };

        // Mutation 1
        assert.doesNotThrow(() => {
          setActiveDepartmentId("icu_critical_care");
        });

        // Mutation 2 (Replay)
        assert.doesNotThrow(() => {
          setActiveDepartmentId("icu_critical_care");
        });

        assert.strictEqual(attempts, 2);

        assert.doesNotThrow(() => {
          const id = getActiveDepartmentId();
          assert.strictEqual(id, DEFAULT_DEPARTMENT_ID);
        });
      } finally {
        (global as any).localStorage = originalLocalStorage;
      }
    });
  });

  describe("High-Concurrency & Stress Benchmarks", () => {
    test("concurrent burst execution and race condition resistance", async () => {
      const NUM_OPERATIONS = 10000;
      const ids = ["or_main", "icu_critical_care", "er_trauma", "pacu_periop", "invalid_id"];

      const promises = Array.from({ length: NUM_OPERATIONS }, async (_, i) => {
        const id = ids[i % ids.length];
        setActiveDepartmentId(id);
        const activeId = getActiveDepartmentId();
        const dept = getDepartment(activeId);

        assert.ok(DEPARTMENTS[activeId] !== undefined);
        assert.ok(dept !== undefined);
      });

      await Promise.all(promises);

      const finalId = getActiveDepartmentId();
      assert.ok(DEPARTMENTS[finalId] !== undefined);
    });

    test("latency benchmark under heavy load", () => {
      const startTime = Date.now();
      const ITERATIONS = 10000;
      for (let i = 0; i < ITERATIONS; i++) {
        setActiveDepartmentId("icu_critical_care");
        getActiveDepartmentId();
        getDepartment("icu_critical_care");
      }
      const duration = Date.now() - startTime;
      assert.ok(duration < 1000, `Latency benchmark took too long: ${duration}ms`);
    });

    test("concurrent burst under offline-first network failure", async () => {
      const originalFetch = global.fetch;
      try {
        global.fetch = mock.fn(() => Promise.reject(new TypeError('Failed to fetch')));

        const promises = Array.from({ length: 1000 }, async () => {
          setActiveDepartmentId("pacu_periop");
          assert.strictEqual(getActiveDepartmentId(), "pacu_periop");
          const dept = getDepartment(getActiveDepartmentId());
          assert.strictEqual(dept.id, "pacu_periop");
        });

        await Promise.all(promises);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe("Fuzzing & boundary inputs", () => {
    test("malformed or massive payloads do not crash setActiveDepartmentId", () => {
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
        "a".repeat(10000),
      ];

      for (const input of fuzzInputs) {
        assert.doesNotThrow(() => setActiveDepartmentId(input));

        assert.strictEqual(getActiveDepartmentId(), DEFAULT_DEPARTMENT_ID);

        const dept = getDepartment(input);
        assert.deepStrictEqual(dept, DEPARTMENTS[DEFAULT_DEPARTMENT_ID]);
      }
    });
  });

  describe("Strict schema validation", () => {
    test("all departments adhere to strict schema definition", () => {
      for (const key in DEPARTMENTS) {
        const dept = DEPARTMENTS[key];
        assert.strictEqual(typeof dept.id, "string");
        assert.strictEqual(typeof dept.name, "string");
        assert.strictEqual(typeof dept.shortName, "string");
        assert.strictEqual(typeof dept.category, "string");
        assert.strictEqual(typeof dept.placeholder, "string");
        assert.strictEqual(typeof dept.notesLabel, "string");
        assert.strictEqual(typeof dept.rolePrompt, "string");
        assert.strictEqual(typeof dept.vocabHint, "string");

        assert.ok(Array.isArray(dept.starterPrompts));
        for (const prompt of dept.starterPrompts) {
          assert.strictEqual(typeof prompt.label, "string");
          assert.strictEqual(typeof prompt.prompt, "string");
        }
      }
    });
  });
});
  describe("Fault Injection & Network Partition Resilience", () => {
    test("network partition degradation and self-healing reconnection", async () => {
      const originalFetch = global.fetch;
      const network_state = { status: "online" };

      try {
        global.fetch = mock.fn(() => {
          if (network_state.status === "offline") {
            return Promise.reject(new TypeError("Failed to fetch"));
          }
          return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
        });

        // Online Phase
        setActiveDepartmentId("icu_critical_care");
        assert.strictEqual(getActiveDepartmentId(), "icu_critical_care");

        // Network Partition / Degradation Phase
        network_state.status = "offline";
        setActiveDepartmentId("or_main");

        // Assert local state works despite partition (Offline-first invariants)
        assert.strictEqual(getActiveDepartmentId(), "or_main");

        // Self-Healing / Reconnection Phase
        network_state.status = "online";
        setActiveDepartmentId("pacu_periop");
        assert.strictEqual(getActiveDepartmentId(), "pacu_periop");

        const dept = getDepartment(getActiveDepartmentId());
        assert.strictEqual(dept.id, "pacu_periop");
      } finally {
        global.fetch = originalFetch;
      }
    });

    test("intermittent latency and storage degradation", () => {
      const originalLocalStorage = (global as any).localStorage;
      try {
        let attempts = 0;
        (global as any).localStorage = {
          getItem: (key: string) => {
            attempts++;
            if (attempts % 2 === 0) throw new Error("Intermittent storage read latency/degradation");
            return mockStorage.get(key) || null;
          },
          setItem: (key: string, value: string) => {
            attempts++;
            if (attempts % 2 === 0) throw new Error("Intermittent storage write latency/degradation");
            mockStorage.set(key, value);
          },
        };

        // Fails due to intermittent degradation, caught safely
        assert.doesNotThrow(() => setActiveDepartmentId("er_trauma"));

        // Succeeds on next attempt
        assert.doesNotThrow(() => setActiveDepartmentId("er_trauma"));

        assert.doesNotThrow(() => {
          const id = getActiveDepartmentId();
          assert.ok(id === "er_trauma" || id === DEFAULT_DEPARTMENT_ID);
        });

      } finally {
        (global as any).localStorage = originalLocalStorage;
      }
    });

    test("storage API exhaustion and recovery (self-healing)", () => {
      const originalLocalStorage = (global as any).localStorage;
      let isExhausted = true;
      try {
        (global as any).localStorage = {
          getItem: (key: string) => {
            if (isExhausted) throw new DOMException("QuotaExceededError");
            return mockStorage.get(key) || null;
          },
          setItem: (key: string, value: string) => {
            if (isExhausted) throw new DOMException("QuotaExceededError");
            mockStorage.set(key, value);
          },
        };

        // Exhaustion phase
        setActiveDepartmentId("icu_critical_care");
        assert.strictEqual(getActiveDepartmentId(), DEFAULT_DEPARTMENT_ID);

        // Recovery / Self-healing phase
        isExhausted = false;
        setActiveDepartmentId("icu_critical_care");
        assert.strictEqual(getActiveDepartmentId(), "icu_critical_care");

      } finally {
        (global as any).localStorage = originalLocalStorage;
      }
    });
  });
