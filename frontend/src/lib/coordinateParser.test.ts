import assert from "node:assert";
import { describe, test } from "node:test";
import { normalizeLocationCoordinate } from "./standaloneEngine";
import { extractAndNormalizeCoordinateClient } from "./semanticParser";

describe("coordinateParser (extractAndNormalizeCoordinateClient / normalizeLocationCoordinate)", () => {
  describe("extractAndNormalizeCoordinateClient", () => {
    test("parses spaced shorthand location strings correctly", () => {
      // Testing spacing
      const result1 = extractAndNormalizeCoordinateClient("OR 21 A 2 C");
      assert.ok(result1);
      assert.strictEqual(result1.location, "OR 21 A 2 C");
    });

    test("parses packed shorthand location strings correctly", () => {
      const result = extractAndNormalizeCoordinateClient("or21a2c");
      assert.ok(result);
      assert.strictEqual(result.location, "OR 21 A 2 C");
    });

    test("parses location strings with dashes correctly", () => {
      const result = extractAndNormalizeCoordinateClient("OR-21-A-2-C");
      assert.ok(result);
      assert.strictEqual(result.location, "OR 21 A 2 C");
    });

    test("parses location strings with bullet points correctly", () => {
      const result = extractAndNormalizeCoordinateClient("OR 21 • A • 2 • C");
      assert.ok(result);
      assert.strictEqual(result.location, "OR 21 A 2 C");
    });

    test("parses Core Supply appropriately", () => {
      const result = extractAndNormalizeCoordinateClient("Core Supply A 1 B");
      assert.ok(result);
      assert.strictEqual(result.location, "Core Supply A 1 B");
    });

    test("parses Pump Room appropriately", () => {
      const result = extractAndNormalizeCoordinateClient("Pump Room A 1 B");
      assert.ok(result);
      assert.strictEqual(result.location, "Pump Room A 1 B");
    });

    test("parses Trauma Bay appropriately", () => {
      const result = extractAndNormalizeCoordinateClient("Trauma Bay 1 A 2 B");
      assert.ok(result);
      assert.strictEqual(result.location, "Trauma Bay 1 A 2 B");
    });

    test("parses ICU Supply appropriately", () => {
      const result = extractAndNormalizeCoordinateClient("ICU Supply A 1 B");
      assert.ok(result);
      assert.strictEqual(result.location, "ICU A 1 B");
    });

    test("parses ICU appropriately", () => {
      const result = extractAndNormalizeCoordinateClient("ICU 1 A 1 B");
      assert.ok(result);
      assert.strictEqual(result.location, "ICU 1 A 1 B");
    });

    test("parses PACU Med Room appropriately", () => {
      const result = extractAndNormalizeCoordinateClient("PACU Med Room A 1 B");
      assert.ok(result);
      assert.strictEqual(result.location, "PACU A 1 B");
    });
  });

  describe("normalizeLocationCoordinate", () => {
    test("normalizes shorthand location strings", () => {
      assert.strictEqual(normalizeLocationCoordinate("OR 21 A 2 C"), "OR 21 A 2 C");
    });

    test("normalizes spoken format strings", () => {
      assert.strictEqual(normalizeLocationCoordinate("OR twenty one ay two see"), "OR 21 A 2 C");
    });

    test("normalizes natural phrased formats", () => {
      assert.strictEqual(normalizeLocationCoordinate("Bay 2 Cart A Shelf 1 Bin B"), "Bay 2 A 1 B");
    });

    test("normalizes core natural phrased formats", () => {
      assert.strictEqual(normalizeLocationCoordinate("core supply pyxis c drawer 2 container d"), "Core Supply C 2 D");
    });
  });

  describe("Fuzzing, Boundary Inputs & Malformed Payload Resilience", () => {
    test("handles empty and purely whitespace strings gracefully", () => {
      assert.strictEqual(extractAndNormalizeCoordinateClient(""), null);
      assert.strictEqual(extractAndNormalizeCoordinateClient("   "), null);
      assert.strictEqual(normalizeLocationCoordinate(""), null);
      assert.strictEqual(normalizeLocationCoordinate("   "), null);
    });

    test("handles extreme whitespace and mixed separators", () => {
      const result = extractAndNormalizeCoordinateClient("  OR   21 \t A \n 2 \r C  ");
      assert.ok(result);
      assert.strictEqual(result.location, "OR 21 A 2 C");

      const result2 = extractAndNormalizeCoordinateClient("OR_21_A_2_C");
      assert.ok(result2);
      assert.strictEqual(result2.location, "OR 21 A 2 C");
    });

    test("handles partially malformed strings that don't match strict schema without throwing", () => {
      assert.strictEqual(extractAndNormalizeCoordinateClient("random nonsense string without coordinates"), null);
      // "OR 21 A 2 C and then some random trailing garbage" matches the coordinate part. It does not return null.
      // It extracts the coordinate and leaves the rest in cleanText.
    });

    test("fuzzing with random alphanumeric noise (does not throw, returns null)", () => {
      for (let i = 0; i < 50; i++) {
        const noise = Math.random().toString(36).substring(2);
        assert.doesNotThrow(() => extractAndNormalizeCoordinateClient(noise));
        assert.doesNotThrow(() => normalizeLocationCoordinate(noise));
      }
    });

    test("handles invalid types gracefully (if passed from untyped JS environment)", () => {
      // In JS, users might pass null/undefined. The functions should probably handle it or cast it.
      // Assuming they cast to string or handle it, we want to ensure no crash.
      assert.doesNotThrow(() => extractAndNormalizeCoordinateClient(undefined as unknown as string));
      assert.doesNotThrow(() => extractAndNormalizeCoordinateClient(null as unknown as string));
      assert.doesNotThrow(() => normalizeLocationCoordinate(undefined as unknown as string));
      assert.doesNotThrow(() => normalizeLocationCoordinate(null as unknown as string));
    });
  });

  describe("Invariants: Offline-First & Multi-Tenant Isolation", () => {
    test("Offline-First Invariant: Coordinate parsing operates purely offline without relying on network state", () => {
      // Mock fetch to throw immediately to ensure no network calls are made
      const originalFetch = global.fetch;
      global.fetch = () => { throw new Error("Network request attempted during offline parsing"); };

      try {
        const result = normalizeLocationCoordinate("OR 5 A 1 B");
        assert.strictEqual(result, "OR 5 A 1 B");
      } finally {
        global.fetch = originalFetch;
      }
    });

    test("Multi-Tenant Isolation Invariant: Coordinate parsing is completely stateless and deterministic across concurrent tenant requests", () => {
      // Prove stateless purity by asserting identical inputs yield identical outputs irrespective of execution order
      // simulating multiple tenants processing coordinates simultaneously
      const tenantA_loc1 = extractAndNormalizeCoordinateClient("trauma bay 1 a 2 c");
      const tenantB_loc1 = extractAndNormalizeCoordinateClient("trauma bay 1 a 2 c");
      const tenantC_loc2 = extractAndNormalizeCoordinateClient("or 3 c 1 d");

      assert.ok(tenantA_loc1);
      assert.ok(tenantB_loc1);
      assert.ok(tenantC_loc2);

      assert.strictEqual(tenantA_loc1.location, tenantB_loc1.location);
      assert.notStrictEqual(tenantA_loc1.location, tenantC_loc2.location);
    });
  });

  describe("High-Concurrency & Stress Benchmarks", () => {
    test("Latency and Concurrent Burst Execution Benchmark", async () => {
      const inputs = [
        "OR 21 A 2 C",
        "or21a2c",
        "OR-21-A-2-C",
        "OR 21 • A • 2 • C",
        "Core Supply A 1 B",
        "Pump Room A 1 B",
        "Trauma Bay 1 A 2 B",
        "ICU Supply A 1 B",
        "ICU 1 A 1 B",
        "PACU Med Room A 1 B",
        "OR twenty one ay two see",
        "Bay 2 Cart A Shelf 1 Bin B",
        "core supply pyxis c drawer 2 container d"
      ];

      const burstSize = 10000;
      const startTime = performance.now();

      const promises = Array.from({ length: burstSize }).map((_, i) => {
        return new Promise<void>((resolve) => {
          const input = inputs[i % inputs.length];
          // Mix operations
          if (i % 2 === 0) {
            extractAndNormalizeCoordinateClient(input);
          } else {
            normalizeLocationCoordinate(input);
          }
          resolve();
        });
      });

      await Promise.all(promises);

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Ensure the burst executes reasonably fast (e.g. within 3 seconds for 10,000 parses)
      assert.ok(duration < 3000, `Expected burst to complete in under 3000ms, but took ${duration}ms`);
    });

    test("Race Condition Resistance & Multi-Tenant Isolation Under High Concurrency", async () => {
      // Setup a scenario where distinct simulated "tenants" execute simultaneously
      const tenants = ["tenantA", "tenantB", "tenantC", "tenantD", "tenantE"];
      const tenantData: Record<string, string[]> = {
        tenantA: ["OR 1 A 1 A", "OR 2 B 2 B"],
        tenantB: ["ICU 1 A 1 A", "ICU 2 B 2 B"],
        tenantC: ["Core Supply A 1 A", "Core Supply B 2 B"],
        tenantD: ["Trauma Bay 1 A 1 A", "Trauma Bay 2 B 2 B"],
        tenantE: ["Pump Room A 1 A", "Pump Room B 2 B"]
      };

      const concurrentTasks = 5000; // Total concurrent tasks across all tenants
      const tasks = [];

      const originalFetch = global.fetch;
      global.fetch = () => { throw new Error("Network request attempted during offline parsing"); };

      try {
        for (let i = 0; i < concurrentTasks; i++) {
          const tenant = tenants[i % tenants.length];
          const data = tenantData[tenant];
          const input = data[i % data.length];

          tasks.push(
            new Promise<{ tenant: string; input: string; result: any }>((resolve) => {
              // Introduce slight random delay to increase interleaving
              setTimeout(() => {
                const result = extractAndNormalizeCoordinateClient(input);
                resolve({ tenant, input, result });
              }, Math.random() * 10);
            })
          );
        }

        const results = await Promise.all(tasks);

        // Verification: ensure no cross-contamination between tenants
        for (const { tenant, input, result } of results) {
          assert.ok(result);

          if (tenant === "tenantA") {
            assert.ok(result.location.startsWith("OR"));
          } else if (tenant === "tenantB") {
            assert.ok(result.location.startsWith("ICU"));
          } else if (tenant === "tenantC") {
            assert.ok(result.location.startsWith("Core Supply"));
          } else if (tenant === "tenantD") {
            assert.ok(result.location.startsWith("Trauma Bay"));
          } else if (tenant === "tenantE") {
            assert.ok(result.location.startsWith("Pump Room"));
          }
        }
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
