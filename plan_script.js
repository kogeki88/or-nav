const assert = require('assert');

// I'll create the search and replace diff logic.

// Here is the replacement diff I will apply to `frontend/src/lib/semanticParser.test.ts`.

/*
<<<<<<< SEARCH
      // Assert multi-tenant isolation / race condition resistance
      for (const res of results) {
        assert.strictEqual(res.parsed.intent, ClinicalIntent.FIND_INVENTORY);
        assert.strictEqual(res.parsed.entities.gauge, res.expectedGauge, `Race condition detected for ID ${res.id}`);
      }

      // Latency benchmark
      const duration = endTime - startTime;
      // Allow up to 2500ms for 1000 iterations to account for CI environments
      assert.ok(duration < 2500, `Burst execution took too long: ${duration}ms`);
    } finally {
      global.fetch = originalFetch;
    }
  });

  await t.test("Latency benchmark for complex query parsing", () => {
=======
      // Assert multi-tenant isolation / race condition resistance
      for (const res of results) {
        assert.strictEqual(res.parsed.intent, ClinicalIntent.FIND_INVENTORY);
        assert.strictEqual(res.parsed.entities.gauge, res.expectedGauge, `Race condition detected for ID ${res.id}`);
        // Ensure no data leaked from other concurrent parses (e.g. no array concatenation or shared objects)
        assert.ok(!res.parsed.entities.item?.includes((res.id + 1).toString()), `Data leakage detected from ID ${res.id + 1} into ${res.id}`);
      }

      // Latency benchmark
      const duration = endTime - startTime;
      // Allow up to 2500ms for 1000 iterations to account for CI environments
      assert.ok(duration < 2500, `Burst execution took too long: ${duration}ms`);
    } finally {
      global.fetch = originalFetch;
    }
  });

  await t.test("Offline-first invariant strictly enforced without network overhead", () => {
    // Asserting no network calls and evaluating offline performance
    const originalFetch = global.fetch;
    let fetchCalled = false;
    global.fetch = () => {
      fetchCalled = true;
      throw new Error("Network call detected");
    };

    try {
      const startTime = performance.now();
      const r = parseClinicalIntent("where is the 2-0 vicryl", "tenant_A");
      const endTime = performance.now();

      assert.strictEqual(fetchCalled, false, "Offline invariant violated: fetch was called");
      assert.strictEqual(r.intent, ClinicalIntent.FIND_INVENTORY);
      assert.ok((endTime - startTime) < 5, "Offline execution should be strictly under 5ms without network overhead");
    } finally {
      global.fetch = originalFetch;
    }
  });

  await t.test("Latency benchmark for complex query parsing", () => {
>>>>>>> REPLACE
*/
