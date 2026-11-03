import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { scrubPhi, REDACTION } from "./scrubClient.ts";

describe("scrubClient standard and adversarial tests", () => {
  describe("Medical Record Numbers (MRNs)", () => {
    test("should scrub MRN in standard format", () => {
      const result = scrubPhi("MRN 1234567");
      assert.strictEqual(result.text, REDACTION);
      assert.strictEqual(result.redactionCount, 1);
    });

    test("should scrub MRN with colon", () => {
      const result = scrubPhi("MRN: 12345678");
      assert.strictEqual(result.text, REDACTION);
      assert.strictEqual(result.redactionCount, 1);
    });

    test("should scrub MRN with hash", () => {
      const result = scrubPhi("MRN#1234567890");
      assert.strictEqual(result.text, REDACTION);
      assert.strictEqual(result.redactionCount, 1);
    });

    test("should scrub MRN inside a sentence", () => {
      const result = scrubPhi("Patient with MRN 1234567 needs surgery");
      assert.strictEqual(result.text, `Patient with ${REDACTION} needs surgery`);
      assert.strictEqual(result.redactionCount, 1);
    });

    test("obfuscated MRNs", () => {
      const tests = [
        { input: "My MRN# 12-34-56", expected: `My ${REDACTION}` },
        { input: "M.R.N. 998877", expected: `${REDACTION}` },
        { input: "MRN: 12345678", expected: `${REDACTION}` },
        { input: "MRN 123456", expected: `${REDACTION}` },
        { input: "patient has M.R.N. 12-34-56 today", expected: `patient has ${REDACTION} today` },
      ];
      for (const { input, expected } of tests) {
        assert.strictEqual(scrubPhi(input).text, expected);
      }
    });
  });

  describe("Patient Names", () => {
    test("should scrub 'patient John Smith'", () => {
      const result = scrubPhi("patient John Smith");
      assert.strictEqual(result.text, `patient ${REDACTION}`);
      assert.strictEqual(result.redactionCount, 1);
    });

    test("should scrub 'patient named Sarah Connor'", () => {
      const result = scrubPhi("patient named Sarah Connor");
      assert.strictEqual(result.text, `patient named ${REDACTION}`);
      assert.strictEqual(result.redactionCount, 1);
    });

    test("should scrub 'pt Jane Doe'", () => {
      const result = scrubPhi("pt Jane Doe");
      assert.strictEqual(result.text, `pt ${REDACTION}`);
      assert.strictEqual(result.redactionCount, 1);
    });

    test("should scrub 'pt. Mary Johnson'", () => {
      const result = scrubPhi("pt. Mary Johnson");
      assert.strictEqual(result.text, `pt. ${REDACTION}`);
      assert.strictEqual(result.redactionCount, 1);
    });

    test("hyphenated patient names", () => {
      const tests = [
        { input: "patient Mary-Jane Parker", expected: `patient ${REDACTION}` },
        { input: "pt Jean-Luc Picard", expected: `pt ${REDACTION}` },
        { input: "patient named Sarah Connor-Smith", expected: `patient named ${REDACTION}` },
      ];
      for (const { input, expected } of tests) {
        assert.strictEqual(scrubPhi(input).text, expected);
      }
    });

    test("should NOT scrub eponymous instruments named after people", () => {
      const result = scrubPhi("Hand me the mayo scissors and kelly clamp");
      assert.strictEqual(result.text, "Hand me the mayo scissors and kelly clamp");
      assert.strictEqual(result.redactionCount, 0);

      const result2 = scrubPhi("patient needs a kelly clamp");
      assert.strictEqual(result2.text, "patient needs a kelly clamp");
      assert.strictEqual(result2.redactionCount, 0);
    });

    test("should NOT scrub doctors names", () => {
      const result = scrubPhi("patient of Dr. Smith");
      assert.strictEqual(result.text, "patient of Dr. Smith");
      assert.strictEqual(result.redactionCount, 0);

      const result2 = scrubPhi("doctor John Smith");
      assert.strictEqual(result2.text, "doctor John Smith");
      assert.strictEqual(result2.redactionCount, 0);
    });
  });

  describe("Dates of Birth (DOB)", () => {
    test("should scrub DOB with slashes", () => {
      const result = scrubPhi("DOB 01/15/1980");
      assert.strictEqual(result.text, REDACTION);
      assert.strictEqual(result.redactionCount, 1);
    });

    test("should scrub DOB with dashes and colon", () => {
      const result = scrubPhi("DOB: 1-15-1980");
      assert.strictEqual(result.text, REDACTION);
      assert.strictEqual(result.redactionCount, 1);
    });

    test("should scrub 'date of birth'", () => {
      const result = scrubPhi("date of birth 12/25/90");
      assert.strictEqual(result.text, REDACTION);
      assert.strictEqual(result.redactionCount, 1);
    });

    test("spoken birth dates", () => {
      const tests = [
        { input: "born on March 4th 1982", expected: `${REDACTION}` },
        { input: "patient was born on Jan 1st 2000", expected: `patient was ${REDACTION}` },
        { input: "DOB: 12/25/1990", expected: `${REDACTION}` },
        { input: "date of birth 1-2-90", expected: `${REDACTION}` },
      ];
      for (const { input, expected } of tests) {
        assert.strictEqual(scrubPhi(input).text, expected);
      }
    });
  });

  describe("Phone numbers and SSNs", () => {
    test("should scrub standard SSN", () => {
      const result = scrubPhi("My SSN is 123-45-6789");
      assert.strictEqual(result.text, `My SSN is ${REDACTION}`);
      assert.strictEqual(result.redactionCount, 1);
    });

    test("should scrub SSN with spaces", () => {
      const result = scrubPhi("SSN 123 45 6789");
      assert.strictEqual(result.text, `SSN ${REDACTION}`);
      assert.strictEqual(result.redactionCount, 1);
    });

    test("should scrub phone with parentheses", () => {
      const result = scrubPhi("Call me at (555) 123-4567");
      assert.strictEqual(result.text, `Call me at ${REDACTION}`);
      assert.strictEqual(result.redactionCount, 1);
    });

    test("should scrub phone with dashes", () => {
      const result = scrubPhi("Call 555-123-4567 for help");
      assert.strictEqual(result.text, `Call ${REDACTION} for help`);
      assert.strictEqual(result.redactionCount, 1);
    });

    test("should scrub phone with dots", () => {
      const result = scrubPhi("Phone: 555.123.4567");
      assert.strictEqual(result.text, `Phone: ${REDACTION}`);
      assert.strictEqual(result.redactionCount, 1);
    });

    test("should NOT scrub public hotline MHAUS", () => {
      const result = scrubPhi("Call MH Hotline 1-800-644-9737");
      assert.strictEqual(result.text, "Call MH Hotline 1-800-644-9737");
      assert.strictEqual(result.redactionCount, 0);
    });

    test("should NOT scrub internal extensions if they do not match full pattern", () => {
      const result = scrubPhi("Call extension x4-25663");
      assert.strictEqual(result.text, "Call extension x4-25663");
      assert.strictEqual(result.redactionCount, 0);
    });
  });

  describe("Edge cases & Clean Clinical Queries", () => {
    test("should handle empty string safely", () => {
      const result = scrubPhi("");
      assert.strictEqual(result.text, "");
      assert.strictEqual(result.redactionCount, 0);
    });

    test("should NOT scrub pure clinical queries without PHI", () => {
      const result = scrubPhi("Where is 3-0 silk?");
      assert.strictEqual(result.text, "Where is 3-0 silk?");
      assert.strictEqual(result.redactionCount, 0);

      const result2 = scrubPhi("We need a #10 blade and a 32Fr catheter.");
      assert.strictEqual(result2.text, "We need a #10 blade and a 32Fr catheter.");
      assert.strictEqual(result2.redactionCount, 0);
    });

    test("should handle mixed queries with multiple PHI types", () => {
      const result = scrubPhi("Where is 3-0 silk for patient John Doe MRN 1234567?");
      assert.strictEqual(result.text, `Where is 3-0 silk for patient ${REDACTION} ${REDACTION}?`);
      assert.strictEqual(result.redactionCount, 2);
    });

    test("should handle multiple redactions of the same type", () => {
      const result = scrubPhi("MRN 111111 and MRN 222222");
      assert.strictEqual(result.text, `${REDACTION} and ${REDACTION}`);
      assert.strictEqual(result.redactionCount, 2);
    });

    test("zero clinical terminology is mistakenly scrubbed", () => {
      const clinicalTerms = [
        "I need a 3-0 silk",
        "Get the Bovie pencil",
        "Pass the DeBakey forceps",
        "patient positioning is critical",
        "patient warming device",
        "patient transfer to PACU",
        "We need a 4-0 vicryl",
        "Blade #10 please",
        "32Fr chest tube",
        "Move to OR 21 A 2 C",
        "Dr. Smith is here",
        "Ask doctor Johnson",
        "patient positioning",
        "patient draping",
        "patient safety",
      ];

      for (const term of clinicalTerms) {
        assert.strictEqual(scrubPhi(term).text, term, `Term "${term}" should not be scrubbed`);
      }
    });
  });

  describe("Offline-first and Multi-tenant Isolation", () => {
    test("scrubPhi executes successfully completely offline (offline-first invariant)", async () => {
      const originalFetch = (global as any).fetch;
      try {
        (global as any).fetch = mock.fn(() => Promise.reject(new TypeError("Failed to fetch")));
        const result = scrubPhi("Patient MRN 123456 needs 3-0 silk");
        assert.strictEqual(result.text, `Patient ${REDACTION} needs 3-0 silk`);
        assert.strictEqual(result.redactionCount, 1);
      } finally {
        (global as any).fetch = originalFetch;
      }
    });

    test("offline mutation replay idempotency", async () => {
      const originalFetch = (global as any).fetch;
      try {
        (global as any).fetch = mock.fn(() => Promise.reject(new TypeError("Failed to fetch")));
        const mutationPayload = "Update patient MRN 123456";

        const replay1 = scrubPhi(mutationPayload);
        const replay2 = scrubPhi(mutationPayload);
        const replay3 = scrubPhi(mutationPayload);

        assert.strictEqual(replay1.text, `Update patient ${REDACTION}`);
        assert.deepStrictEqual(replay1, replay2);
        assert.deepStrictEqual(replay2, replay3);
      } finally {
        (global as any).fetch = originalFetch;
      }
    });

    test("scrubPhi maintains stateless multi-tenant isolation", () => {
      const tenantAData = "Tenant A (fac_1::dept_1) patient John Smith MRN 111111";
      const tenantBData = "Tenant B (fac_2::dept_2) pt Jane Doe MRN 222222";

      const resultA1 = scrubPhi(tenantAData);
      const resultB1 = scrubPhi(tenantBData);
      const resultA2 = scrubPhi(tenantAData);
      const resultB2 = scrubPhi(tenantBData);

      assert.strictEqual(resultA1.text, `Tenant A (fac_1::dept_1) patient ${REDACTION} ${REDACTION}`);
      assert.strictEqual(resultB1.text, `Tenant B (fac_2::dept_2) pt ${REDACTION} ${REDACTION}`);
      assert.strictEqual(resultA2.text, `Tenant A (fac_1::dept_1) patient ${REDACTION} ${REDACTION}`);
      assert.strictEqual(resultB2.text, `Tenant B (fac_2::dept_2) pt ${REDACTION} ${REDACTION}`);
      assert.strictEqual(resultA1.redactionCount, 2);
      assert.strictEqual(resultB1.redactionCount, 2);
      assert.strictEqual(resultA2.redactionCount, 2);
      assert.strictEqual(resultB2.redactionCount, 2);
    });
  });

  describe("Malformed Payload Resilience, Fuzzing & Schema", () => {
    test("malformed payload resilience", () => {
      const badInputs = [null, undefined, 123, {}, [], Symbol("test"), () => {}, NaN];
      for (const input of badInputs) {
        const result = scrubPhi(input as any);
        assert.strictEqual(result.text, "");
        assert.strictEqual(result.redactionCount, 0);
      }
    });

    test("fuzzing and boundary inputs", () => {
      const hugeString = "a".repeat(100000);
      assert.strictEqual(scrubPhi(hugeString).text, hugeString);

      const controlChars = "\u0000\u0001\u0002MRN 1234567\u0003\u0004";
      assert.strictEqual(scrubPhi(controlChars).text, `\u0000\u0001\u0002${REDACTION}\u0003\u0004`);

      const repetitive = "patient patient patient patient";
      assert.strictEqual(scrubPhi(repetitive).text, "patient patient patient patient");
    });

    test("strict schema validation", () => {
      const result = scrubPhi("hello");
      assert.deepStrictEqual(Object.keys(result).sort(), ["redactionCount", "text"]);
      assert.strictEqual(typeof result.text, "string");
      assert.strictEqual(typeof result.redactionCount, "number");
    });
  });

  describe("High-Concurrency & Stress Benchmarks", () => {
    test("concurrent burst execution and race condition resistance", async () => {
      const iterations = 5000;
      const inputs = [
        "Patient MRN 123456 needs surgery",
        "Where is the 3-0 silk?",
        "Call me at 555-123-4567",
        null,
        "Tenant A pt Jane Doe DOB 01/15/1980",
        undefined,
        "We need a #10 blade",
      ];

      const originalFetch = (global as any).fetch;
      try {
        // Enforce offline-first invariant during stress test
        (global as any).fetch = mock.fn(() => Promise.reject(new TypeError("Failed to fetch")));

        const promises = Array.from({ length: iterations }, (_, i) => {
          const input = inputs[i % inputs.length];
          return new Promise<void>((resolve) => {
            // Slight randomized delay to force interleaving
            setTimeout(() => {
              const res = scrubPhi(input as any);
              if (input === "Patient MRN 123456 needs surgery") {
                assert.strictEqual(res.text, `Patient ${REDACTION} needs surgery`);
              } else if (input === "Where is the 3-0 silk?") {
                assert.strictEqual(res.text, input);
              } else if (input === "Call me at 555-123-4567") {
                assert.strictEqual(res.text, `Call me at ${REDACTION}`);
              } else if (input === null || input === undefined) {
                assert.strictEqual(res.text, "");
              } else if (input === "Tenant A pt Jane Doe DOB 01/15/1980") {
                assert.strictEqual(res.text, `Tenant A pt ${REDACTION} ${REDACTION}`);
              } else if (input === "We need a #10 blade") {
                assert.strictEqual(res.text, input);
              }
              resolve();
            }, Math.random() * 10);
          });
        });

        await Promise.all(promises);
      } finally {
        (global as any).fetch = originalFetch;
      }
    });

    test("latency benchmarks under sustained stress", () => {
      const iterations = 10000;
      const input = "Patient MRN 123456 and pt Jane Doe DOB 01/01/1990 need 3-0 silk";

      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        scrubPhi(input);
      }
      const end = performance.now();

      const totalTimeMs = end - start;
      const avgTimeMs = totalTimeMs / iterations;

      // Ensure average processing time is extremely low (e.g. < 1ms per operation)
      assert.ok(avgTimeMs < 1, `Average latency too high: ${avgTimeMs}ms`);
    });
  });
});
