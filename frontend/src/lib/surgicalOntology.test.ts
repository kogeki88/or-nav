import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  stripSpokenDisfluencies,
  normalizeAcousticSpeech,
  normalizeOrLingo,
  extractEponyms,
  isGenericClassOnly,
  isEponymConflict,
  lingoCache,
  cacheStats, // Caching exports needed for performance tests
} from "./surgicalOntology.ts";
import { extractGaugeAndSpecs } from "./standaloneEngine.ts";

test("Normalize OR Lingo", () => {
  assert.strictEqual(normalizeOrLingo("metz"), "metzenbaum scissors");
});

test("Cache performance test with 10,000 rapid lookup iterations", () => {
  // Clear cache to ensure isolated test environment
  lingoCache.clear();
  cacheStats.hits = 0;
  cacheStats.misses = 0;

  const iterations = 10000;
  // Repeatedly look up a mix of queries
  const queries = ["metz", "pickups", "cherry", "ray tec", "bovie", "unrelated term", "the bakey", "castro"];

  for (let i = 0; i < iterations; i++) {
    const query = queries[i % queries.length];
    normalizeOrLingo(query);
  }

  const totalLookups = cacheStats.hits + cacheStats.misses;
  const hitRate = cacheStats.hits / totalLookups;

  assert.strictEqual(totalLookups, iterations);
  assert.strictEqual(cacheStats.misses, 8);
  assert.strictEqual(cacheStats.hits, 9992);
  assert.ok(hitRate > 0.95, `Expected hit rate > 95%, but got ${(hitRate * 100).toFixed(2)}%`);
});

describe("Surgical Ontology & Engine Spec Extraction", () => {
  describe("extractGaugeAndSpecs", () => {
    test("extracts standard suture gauges", () => {
      const tests = [
        { text: "silk 2-0", expected: ["2-0"] },
        { text: "vicryl 3-0", expected: ["3-0"] },
        { text: "prolene 0", expected: ["0"] },
        { text: "size 0 suture", expected: ["0"] },
        { text: "pds 5-0", expected: ["5-0"] },
        { text: "chromic 4-0", expected: ["4-0"] },
        { text: "1", expected: [] },
        { text: "size 1", expected: [] }
      ];

      for (const t of tests) {
        const specs = extractGaugeAndSpecs(t.text);
        const gauges = Array.from(specs.suture_gauges);
        for (const exp of t.expected) {
          assert.ok(gauges.includes(exp), `Expected ${exp} in ${gauges.join(", ")} for "${t.text}"`);
        }
      }
    });

    test("extracts needle codes", () => {
      const tests = [
        { text: "vicryl sh needle", expected: ["sh"] },
        { text: "prolene ct-1", expected: ["ct-1"] },
        { text: "ps-2 needle", expected: ["ps-2"] },
        { text: "ur-6", expected: ["ur-6"] }
      ];

      for (const t of tests) {
        const specs = extractGaugeAndSpecs(t.text);
        const codes = Array.from(specs.needle_codes);
        for (const exp of t.expected) {
          assert.ok(codes.includes(exp), `Expected needle code ${exp} in ${codes.join(", ")} for "${t.text}"`);
        }
      }
    });

    test("extracts material types", () => {
      const tests = [
        { text: "vicryl 2-0", expected: ["vicryl"] },
        { text: "silk suture", expected: ["silk"] },
        { text: "monocryl 4-0", expected: ["monocryl"] },
        { text: "pds suture", expected: ["pds"] },
        { text: "ethibond", expected: ["ethibond"] },
        { text: "prolene mesh", expected: ["prolene"] }
      ];

      for (const t of tests) {
        const specs = extractGaugeAndSpecs(t.text);
        const materials = Array.from(specs.suture_materials);
        for (const exp of t.expected) {
          assert.ok(materials.includes(exp), `Expected material ${exp} in ${materials.join(", ")} for "${t.text}"`);
        }
      }
    });

    test("handles edge cases: unknown items, conflicting numbers, non-suture instruments", () => {
      // unknown items
      const specs1 = extractGaugeAndSpecs("unobtanium laser forceps");
      assert.strictEqual(specs1.suture_gauges.size, 0);
      assert.strictEqual(specs1.needle_codes.size, 0);
      assert.strictEqual(specs1.suture_materials.size, 0);

      // conflicting numbers
      const specs2 = extractGaugeAndSpecs("vicryl 2-0 3-0");
      assert.ok(specs2.suture_gauges.has("2-0"));
      assert.ok(specs2.suture_gauges.has("3-0"));

      // non-suture instruments
      const specs3 = extractGaugeAndSpecs("metzenbaum scissors");
      assert.strictEqual(specs3.suture_gauges.size, 0);
      assert.strictEqual(specs3.needle_codes.size, 0);
      assert.strictEqual(specs3.suture_materials.size, 0);
    });
  });

  describe("normalizeAcousticSpeech", () => {
    test("handles disfluencies", () => {
      assert.strictEqual(normalizeAcousticSpeech("uh get me a metz"), "get me a metz");
      assert.strictEqual(normalizeAcousticSpeech("um grab a scalpel"), "grab a scalpel");
      assert.strictEqual(normalizeAcousticSpeech("i mean we need a hemostat"), "we need a hemostat");
      assert.strictEqual(normalizeAcousticSpeech("let's see grab a kelly"), "grab a kelly");
      assert.strictEqual(normalizeAcousticSpeech("well basically find the bovie"), "find the bovie");
    });
  });

  describe("normalizeOrLingo", () => {
    test("normalizes lingo", () => {
      assert.strictEqual(normalizeOrLingo("metz"), "metzenbaum scissors");
      assert.strictEqual(normalizeOrLingo("pickups"), "forceps");
      assert.strictEqual(normalizeOrLingo("snaps"), "crile hemostat clamp");
      assert.strictEqual(normalizeOrLingo("sweetheart"), "harrington sweetheart retractor");
      assert.strictEqual(normalizeOrLingo("ray tec"), "ray-tec sponge");
      assert.strictEqual(normalizeOrLingo("bovie"), "electrosurgical bovie pencil");
      assert.strictEqual(normalizeOrLingo("lap"), "laparotomy sponge");
    });
  });

  describe("isGenericClassOnly", () => {
    test("identifies generic classes", () => {
      assert.strictEqual(isGenericClassOnly("forceps"), true);
      assert.strictEqual(isGenericClassOnly("scissors"), true);
      assert.strictEqual(isGenericClassOnly("clamp"), true);
      assert.strictEqual(isGenericClassOnly("retractor"), true);
      assert.strictEqual(isGenericClassOnly("sponge"), true);
    });

    test("returns false for non-generic classes", () => {
      assert.strictEqual(isGenericClassOnly("adson forceps"), false);
      assert.strictEqual(isGenericClassOnly("mayo scissors"), false);
      assert.strictEqual(isGenericClassOnly("kelly clamp"), false);
      assert.strictEqual(isGenericClassOnly("army navy retractor"), false);
      assert.strictEqual(isGenericClassOnly("castroviejo needle driver"), false);
      assert.strictEqual(isGenericClassOnly("ray-tec sponge"), false);
    });
  });

  describe("isEponymConflict", () => {
    test("detects eponym conflicts", () => {
      assert.strictEqual(isEponymConflict("adson forceps", "debakey forceps"), true);
      assert.strictEqual(isEponymConflict("mayo scissors", "metzenbaum scissors"), true);
      assert.strictEqual(isEponymConflict("kelly clamp", "crile clamp"), true);
      assert.strictEqual(isEponymConflict("army navy retractor", "senn retractor"), true);
    });

    test("returns false when no conflict", () => {
      assert.strictEqual(isEponymConflict("adson forceps", "adson pickups"), false);
      assert.strictEqual(isEponymConflict("mayo scissors", "mayo scissors"), false);
      assert.strictEqual(isEponymConflict("kelly clamp", "kelly clamp"), false);
      assert.strictEqual(isEponymConflict("army navy retractor", "army navy retractor"), false);
    });
  });

  describe("Optimization: caching canonical gauge and instrument mappings", () => {
    test("tests 10,000 rapid lookup iterations and verifies cache hit rate > 95% on repetitive clinical terms", () => {
      lingoCache.clear();
      cacheStats.hits = 0;
      cacheStats.misses = 0;

      const iterations = 10000;
      const queries = ["vicryl 3-0 gauge", "prolene 0 instrument", "kelly clamp", "mayo scissors", "metz", "pickups"];

      for (let i = 0; i < iterations; i++) {
        normalizeOrLingo(queries[i % queries.length]);
      }

      const totalLookups = cacheStats.hits + cacheStats.misses;
      const hitRate = cacheStats.hits / totalLookups;

      assert.strictEqual(totalLookups, iterations);
      assert.ok(hitRate > 0.95, `Expected hit rate > 95%, but got ${(hitRate * 100).toFixed(2)}%`);
    });
  });
});
