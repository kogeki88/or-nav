import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  learnAliasClient,
  loadFacilityLexicon,
  resolveSpokenAliasClient,
  getAllAliasesForItemClient,
  detectTeachingIntentClient,
  titleCaseTerm,
  getFacilityIdFromTenant,
  recordPhoneticCorrection,
} from "./lexiconLearning.ts";

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

describe("lexiconLearning & Teaching Intent", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  describe("titleCaseTerm", () => {
    test("should title case a single lowercase word", () => {
      assert.strictEqual(titleCaseTerm("apple"), "Apple");
    });

    test("should title case multiple lowercase words", () => {
      assert.strictEqual(titleCaseTerm("adson pickups"), "Adson Pickups");
    });

    test("should correctly handle mixed case words", () => {
      assert.strictEqual(titleCaseTerm("mIxTer clAmPs"), "Mixter Clamps");
    });

    test("should preserve formatting if already title cased", () => {
      assert.strictEqual(titleCaseTerm("Rat Tooth"), "Rat Tooth");
    });

    test("should correctly handle uppercase words", () => {
      assert.strictEqual(titleCaseTerm("FORCEPS"), "Forceps");
    });

    test("should handle single character strings", () => {
      assert.strictEqual(titleCaseTerm("a"), "A");
      assert.strictEqual(titleCaseTerm("X"), "X");
    });

    test("should remove extra whitespace between words", () => {
      assert.strictEqual(titleCaseTerm("  rat   tooth  "), "Rat Tooth");
    });

    test("should handle empty strings", () => {
      assert.strictEqual(titleCaseTerm(""), "");
    });

    test("should handle strings with non-alphabet characters", () => {
      assert.strictEqual(titleCaseTerm("1x2 pickups"), "1x2 Pickups");
      assert.strictEqual(titleCaseTerm("right-angle clamp"), "Right-angle Clamp");
    });

    test("should handle whitespace only strings", () => {
      assert.strictEqual(titleCaseTerm("   "), "");
    });
  });

  describe("learnAliasClient", () => {
    test("should record new spoken terms/aliases for surgical items", () => {
      const entry = learnAliasClient("facility_1", "or", "snips", "Mayo Scissors", "user1");
      assert.strictEqual(entry.spokenTerm, "snips");
      assert.strictEqual(entry.canonicalItemName, "Mayo Scissors");
      assert.strictEqual(entry.usageCount, 1);
      assert.ok(entry.usedByUsers.includes("user1"));
      assert.strictEqual(entry.confidence, "personal");
    });

    test("should increment usage counts when terms are reused by same user", () => {
      learnAliasClient("facility_1", "or", "snips", "Mayo Scissors", "user1");
      const entry = learnAliasClient("facility_1", "or", "snips", "Mayo Scissors", "user1");
      assert.strictEqual(entry.usageCount, 2);
      assert.strictEqual(entry.usedByUsers.length, 1);
      assert.strictEqual(entry.confidence, "facility_consensus");
    });

    test("should promote term to facility_consensus once threshold is achieved", () => {
      learnAliasClient("facility_1", "or", "snips", "Mayo Scissors", "user1");
      const entry = learnAliasClient("facility_1", "or", "snips", "Mayo Scissors", "user2");
      assert.strictEqual(entry.usageCount, 2);
      assert.strictEqual(entry.usedByUsers.length, 2);
      assert.strictEqual(entry.confidence, "facility_consensus");
    });

    test("should handle admin user correctly (immediate facility consensus)", () => {
      const entry = learnAliasClient("facility_1", "or", "snips", "Mayo Scissors", "admin");
      assert.strictEqual(entry.confidence, "facility_consensus");
    });

    test("should handle edge cases: case insensitivity, trimming whitespace", () => {
      learnAliasClient("facility_1", "or", "  Snips  ", "Mayo Scissors", "user1");
      const entry = learnAliasClient("facility_1", "or", "SNIPS", "Mayo Scissors", "user2");
      assert.strictEqual(entry.usageCount, 2);
      assert.strictEqual(entry.spokenTerm, "snips");
    });
  });

  describe("resolveSpokenAliasClient", () => {
    test("should resolve a spoken alias exactly", () => {
      learnAliasClient("facility_1", "or", "snips", "Mayo Scissors", "user1");
      const resolved = resolveSpokenAliasClient("facility_1", "snips");
      assert.ok(resolved !== null);
      assert.strictEqual(resolved?.canonicalItemName, "Mayo Scissors");
    });

    test("should resolve a spoken alias with plural stem match", () => {
      learnAliasClient("facility_1", "or", "snip", "Mayo Scissors", "user1");
      const resolved = resolveSpokenAliasClient("facility_1", "snips");
      assert.ok(resolved !== null);
      assert.strictEqual(resolved?.canonicalItemName, "Mayo Scissors");
    });

    test("should resolve word-bounded subphrase match", () => {
      learnAliasClient("facility_1", "or", "cherry", "Kittner Dissector Sponges", "user1");
      const resolved = resolveSpokenAliasClient("facility_1", "pass me a cherry please");
      assert.ok(resolved !== null);
      assert.strictEqual(resolved?.canonicalItemName, "Kittner Dissector Sponges");
    });

    test("should return null for unknown aliases", () => {
      const resolved = resolveSpokenAliasClient("facility_1", "unknown_term");
      assert.strictEqual(resolved, null);
    });
  });

  describe("getAllAliasesForItemClient", () => {
    test("should return all unique aliases for an item", () => {
      learnAliasClient("facility_1", "or", "snips", "Mayo Scissors", "user1");
      learnAliasClient("facility_1", "or", "heavy scissors", "Mayo Scissors", "user2");
      learnAliasClient("facility_1", "or", "Snips", "Mayo Scissors", "user3");

      const aliases = getAllAliasesForItemClient("facility_1", "Mayo Scissors");
      assert.strictEqual(aliases.length, 2);
      assert.ok(aliases.includes("Snips"));
      assert.ok(aliases.includes("Heavy Scissors"));
    });
  });

  describe("detectTeachingIntentClient", () => {
    test("should detect '[X] is called [Y]'", () => {
      const result = detectTeachingIntentClient("Mayo Scissors is called snips");
      assert.deepStrictEqual(result, { target: "Mayo Scissors", alias: "snips" });
    });

    test("should detect 'In this facility, [X] is called [Y]'", () => {
      const result = detectTeachingIntentClient("In this facility, the Mayo Scissors is called snips");
      assert.deepStrictEqual(result, { target: "Mayo Scissors", alias: "snips" });
    });

    test("should detect 'Remember that [X] are called [Y]'", () => {
      const result = detectTeachingIntentClient("Remember that Mayo Scissors are called snips");
      assert.deepStrictEqual(result, { target: "Mayo Scissors", alias: "snips" });
    });

    test("should detect 'Here we call [X] [Y]'", () => {
      const result = detectTeachingIntentClient("Here we call the 1x2 forceps toothed adson");
      assert.deepStrictEqual(result, { target: "1x2 forceps", alias: "toothed adson" });
    });

    test("should detect 'Alias [X] to [Y]'", () => {
      const result = detectTeachingIntentClient("Alias 1x2 forceps to toothed adson");
      assert.deepStrictEqual(result, { target: "1x2 forceps", alias: "toothed adson" });
    });

    test("should return null for non-teaching sentences", () => {
      assert.strictEqual(detectTeachingIntentClient("Pass me the Mayo Scissors"), null);
      assert.strictEqual(detectTeachingIntentClient("What is an adson pickup?"), null);
      assert.strictEqual(detectTeachingIntentClient("Where are the sutures located?"), null);
    });
  });
});
  describe("recordPhoneticCorrection", () => {
    beforeEach(() => { mockStorage.clear(); });
    test("should record a phonetic correction with strict type narrowing", () => {
      const entry = recordPhoneticCorrection("facility_unseeded", "or", "adds in", "Adson Pickups", "user1");
      assert.strictEqual(entry.type, "phonetic");
      assert.strictEqual(entry.spokenTerm, "adds in");
      assert.strictEqual(entry.canonicalItemName, "Adson Pickups");
      assert.strictEqual(entry.usageCount, 1);
      assert.ok(entry.usedByUsers.includes("user1"));

      const saved = loadFacilityLexicon("facility_unseeded");
      const found = saved.find(e => e.aliasId === entry.aliasId);
      assert.ok(found);
      if (found) {
        assert.strictEqual(found.type, "phonetic");
      }
    });

    test("should increment usage counts for phonetic corrections and verify storage format", () => {
      recordPhoneticCorrection("facility_unseeded", "or", "adds in", "Adson Pickups", "user1");
      const entry = recordPhoneticCorrection("facility_unseeded", "or", "adds in", "Adson Pickups", "user1");
      assert.strictEqual(entry.type, "phonetic");
      assert.strictEqual(entry.usageCount, 2);
    });

    test("assert zero null pointer errors on unseeded terms", () => {
      const entry = recordPhoneticCorrection("facility_unknown", "or", "misheard_unseeded", "actual_item", "user1");
      assert.strictEqual(entry.spokenTerm, "misheard_unseeded");
      const resolved = resolveSpokenAliasClient("facility_unknown", "misheard_unseeded");
      assert.ok(resolved);
      assert.strictEqual(resolved?.canonicalItemName, "actual_item");
    });
  });
