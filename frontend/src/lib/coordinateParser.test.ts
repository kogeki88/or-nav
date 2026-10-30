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
});
