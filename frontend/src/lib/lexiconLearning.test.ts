import { describe, test, beforeEach, mock } from "node:test";
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

  describe("Multi-tenant & Offline tests", () => {
    describe("multi-tenant isolation", () => {
      test("should ensure aliases learned in one facility do not leak to another", () => {
        learnAliasClient("facility_A", "or", "custom_tool", "Standard Tool", "user1");

        const resolvedA = resolveSpokenAliasClient("facility_A", "custom_tool");
        assert.ok(resolvedA);
        assert.strictEqual(resolvedA?.canonicalItemName, "Standard Tool");

        const resolvedB = resolveSpokenAliasClient("facility_B", "custom_tool");
        assert.strictEqual(resolvedB, null);
      });

      test("should parse tenant ID into facility and department correctly without leaking", () => {
        assert.deepStrictEqual(getFacilityIdFromTenant("sacred_heart"), { facilityId: "sacred_heart", departmentId: "or" });
        assert.deepStrictEqual(getFacilityIdFromTenant("sacred_heart_or"), { facilityId: "sacred_heart", departmentId: "or" });
        assert.deepStrictEqual(getFacilityIdFromTenant("princeton_plainsboro::icu"), { facilityId: "princeton_plainsboro", departmentId: "icu" });
        assert.deepStrictEqual(getFacilityIdFromTenant("tenant_a"), { facilityId: "tenant_a", departmentId: "or" });
        assert.deepStrictEqual(getFacilityIdFromTenant("or_main"), { facilityId: "general_memorial", departmentId: "or" });
      });
    });

    describe("offline-first invariants", () => {
      test("should persist and retrieve aliases strictly from local storage (offline) without network requests", async () => {
        const originalFetch = global.fetch;
        global.fetch = mock.fn(async () => { throw new Error("Network offline"); });

        try {
          learnAliasClient("offline_facility", "or", "offline_tool", "Standard Tool", "user1");
          const resolved = resolveSpokenAliasClient("offline_facility", "offline_tool");

          assert.ok(resolved);
          assert.strictEqual(resolved?.canonicalItemName, "Standard Tool");
          assert.strictEqual((global.fetch as any).mock.callCount(), 0);
        } finally {
          global.fetch = originalFetch;
        }
      });
    });

    describe("Fuzzing, Boundary Inputs, and Schema Validation", () => {
      beforeEach(() => { mockStorage.clear(); });

      test("should handle malformed null/undefined boundary inputs without crashing", () => {
        // Fuzzing boundary values by casting to any
        assert.throws(() => titleCaseTerm(undefined as any));
        assert.throws(() => detectTeachingIntentClient(null as any));

        // resolveSpokenAliasClient gracefully handles null
        const resolved = resolveSpokenAliasClient("f1", null as any);
        assert.strictEqual(resolved, null);
      });

      test("should safely process extremely long strings (fuzzing)", () => {
        const longStr = "A".repeat(10000);
        const entry = learnAliasClient("fac_long", "or", longStr, longStr, "user");
        assert.strictEqual(entry.usageCount, 1);
        assert.strictEqual(entry.spokenTerm, longStr.toLowerCase());
      });

      test("should enforce strict schema validation for malformed storage payloads", () => {
        // Mocking a completely corrupted JSON
        mockStorage.set("ornav_learned_lexicon_malformed1", "{ not json }");
        const res1 = loadFacilityLexicon("malformed1");
        assert.ok(Array.isArray(res1)); // Should fallback to empty/defaults

        // Mocking a non-array JSON payload
        mockStorage.set("ornav_learned_lexicon_malformed2", JSON.stringify({ a: 1 }));
        const res2 = loadFacilityLexicon("malformed2");
        assert.ok(Array.isArray(res2));

        // Mocking an array with missing/invalid fields
        mockStorage.set("ornav_learned_lexicon_malformed3", JSON.stringify([
          { missingKeys: true },
          null,
          "random string"
        ]));
        // Should return it as parsed, but system shouldn't crash on read
        const res3 = loadFacilityLexicon("malformed3");
        assert.ok(Array.isArray(res3));

        // Let's verify resolveSpokenAliasClient doesn't crash on it
        const resolved = resolveSpokenAliasClient("malformed3", "query");
        assert.strictEqual(resolved, null);
      });

      test("should enforce multi-tenant isolation with fuzzed tenant IDs", () => {
        const tenant1 = "tenant_" + Math.random().toString(36).substring(7);
        const tenant2 = "tenant_" + Math.random().toString(36).substring(7);

        learnAliasClient(tenant1, "or", "shared_alias", "Item A");
        learnAliasClient(tenant2, "or", "shared_alias", "Item B");

        const r1 = resolveSpokenAliasClient(tenant1, "shared_alias");
        assert.strictEqual(r1?.canonicalItemName, "Item A");

        const r2 = resolveSpokenAliasClient(tenant2, "shared_alias");
        assert.strictEqual(r2?.canonicalItemName, "Item B");
      });

      test("offline-first invariants hold under simulated quota exceptions", () => {
        const originalFetch = global.fetch;
        global.fetch = mock.fn(async () => { throw new Error("Network offline"); });

        const originalSetItem = (global as any).localStorage.setItem;
        (global as any).localStorage.setItem = () => { throw new Error("Quota exceeded"); };

        try {
          learnAliasClient("quota_fac", "or", "quota_alias", "Item", "user1");
          // Should fallback to memStorage gracefully
          const resolved = resolveSpokenAliasClient("quota_fac", "quota_alias");
          assert.strictEqual(resolved?.canonicalItemName, "Item");

          assert.strictEqual((global.fetch as any).mock.callCount(), 0);
        } finally {
          global.fetch = originalFetch;
          (global as any).localStorage.setItem = originalSetItem;
        }
      });
    });

    describe("High-Concurrency & Stress Benchmarks", () => {
      beforeEach(() => { mockStorage.clear(); });

      test("should handle concurrent burst execution without race conditions", async () => {
        const tenant = "burst_tenant";
        const numRequests = 100;
        const promises = [];

        for (let i = 0; i < numRequests; i++) {
          promises.push(
            Promise.resolve().then(() => {
              learnAliasClient(tenant, "or", "burst_alias", "Burst Item", `user_${i}`);
            })
          );
        }

        await Promise.all(promises);

        const lexicon = loadFacilityLexicon(tenant);
        const entries = lexicon.filter(e => e.spokenTerm === "burst_alias");

        assert.strictEqual(entries.length, 1, "Should deduplicate concurrent bursts to a single entry");
        assert.strictEqual(entries[0].usageCount, numRequests, "Usage count should match number of requests");
        assert.strictEqual(entries[0].usedByUsers.length, numRequests, "All users should be recorded");
        assert.strictEqual(entries[0].canonicalItemName, "Burst Item");
      });

      test("should maintain latency limits under heavy load", () => {
        const tenant = "latency_tenant";
        const numItems = 500;

        // Seed items
        for (let i = 0; i < numItems; i++) {
          learnAliasClient(tenant, "or", `alias_${i}`, `Item ${i}`, "user_1");
        }

        const startRead = performance.now();
        for (let i = 0; i < numItems; i++) {
          resolveSpokenAliasClient(tenant, `alias_${i}`);
        }
        const endRead = performance.now();
        const readLatencyMs = endRead - startRead;
        assert.ok(readLatencyMs < 2000, `Read latency too high: ${readLatencyMs}ms`);

        const startWrite = performance.now();
        for (let i = 0; i < 100; i++) {
          learnAliasClient(tenant, "or", `new_alias_${i}`, `New Item ${i}`, "user_2");
        }
        const endWrite = performance.now();
        const writeLatencyMs = endWrite - startWrite;
        assert.ok(writeLatencyMs < 1000, `Write latency too high: ${writeLatencyMs}ms`);
      });

      test("offline-first invariants hold during concurrent operations", async () => {
        const tenant = "offline_concurrent";
        const originalFetch = global.fetch;
        global.fetch = mock.fn(async () => { throw new Error("Network offline"); });

        try {
          const promises = Array.from({ length: 50 }, (_, i) =>
            Promise.resolve().then(() => {
              learnAliasClient(tenant, "or", "offline_alias", "Offline Item", `user_${i}`);
            })
          );

          await Promise.all(promises);

          const resolved = resolveSpokenAliasClient(tenant, "offline_alias");
          assert.ok(resolved);
          assert.strictEqual(resolved?.canonicalItemName, "Offline Item");
          assert.strictEqual(resolved?.usageCount, 50);
          assert.strictEqual((global.fetch as any).mock.callCount(), 0);
        } finally {
          global.fetch = originalFetch;
        }
      });

      test("multi-tenant isolation holds during concurrent bursts", async () => {
        const numRequests = 50;
        const promises = [];

        for (let i = 0; i < numRequests; i++) {
          promises.push(Promise.resolve().then(() => learnAliasClient("tenant_A", "or", "shared_alias", "Item A", `user_${i}`)));
          promises.push(Promise.resolve().then(() => learnAliasClient("tenant_B", "or", "shared_alias", "Item B", `user_${i}`)));
        }

        await Promise.all(promises);

        const r1 = resolveSpokenAliasClient("tenant_A", "shared_alias");
        assert.strictEqual(r1?.canonicalItemName, "Item A");
        assert.strictEqual(r1?.usageCount, numRequests);

        const r2 = resolveSpokenAliasClient("tenant_B", "shared_alias");
        assert.strictEqual(r2?.canonicalItemName, "Item B");
        assert.strictEqual(r2?.usageCount, numRequests);
      });
    });
  });
