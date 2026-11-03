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
