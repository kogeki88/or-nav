import { test, describe } from "node:test";
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
});
