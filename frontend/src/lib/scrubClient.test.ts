import { test, describe } from "node:test";
import assert from "node:assert";
import { scrubPhi, REDACTION } from "./scrubClient";

describe("scrubPhi adversarial stress tests", () => {
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

  test("hyphenated surgeon/patient names", () => {
    const tests = [
      { input: "patient Mary-Jane Parker", expected: `patient ${REDACTION}` },
      { input: "pt Jean-Luc Picard", expected: `pt ${REDACTION}` },
      { input: "patient named Sarah Connor-Smith", expected: `patient named ${REDACTION}` },
      { input: "pt. Mary Johnson", expected: `pt. ${REDACTION}` }
    ];
    for (const { input, expected } of tests) {
      assert.strictEqual(scrubPhi(input).text, expected);
    }
  });

  test("mixed clinical queries", () => {
    const tests = [
      {
        input: "Schedule pt Mary-Jane Parker born on March 4th 1982 with MRN# 12-34-56",
        expected: `Schedule pt ${REDACTION} ${REDACTION} with ${REDACTION}`
      },
    ];
    for (const { input, expected } of tests) {
      assert.strictEqual(scrubPhi(input).text, expected);
    }
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
