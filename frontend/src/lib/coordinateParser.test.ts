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
  });

  describe("normalizeLocationCoordinate", () => {
    test("normalizes shorthand location strings", () => {
      assert.strictEqual(normalizeLocationCoordinate("OR 21 A 2 C"), "OR 21 A 2 C");
    });
  });
});
