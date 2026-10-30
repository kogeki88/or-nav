import { test, describe } from "node:test";
import assert from "node:assert";
import v8 from "v8";
import vm from "vm";
import { scrubPhi } from "./scrubClient";

v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc');

describe("PHI Scrubber Performance & Memory Benchmark", () => {
  const words = [
    "The", "patient", "named", "John", "Doe", "is", "scheduled", "for", "surgery",
    "today.", "MRN", "12345678", "and", "DOB", "01/15/1980.", "Contact", "at",
    "555-123-4567.", "Clinical", "positioning", "is", "critical.", "Get", "the",
    "DeBakey", "forceps", "and", "3-0", "silk.", "Move", "to", "OR", "21", "A", "2", "C.",
    "Patient", "Mary-Jane", "Parker", "was", "born", "on", "March", "4th", "1982."
  ];

  // Generate a string with roughly 10,000 words.
  // The base array has 47 words. Repeating it 213 times yields ~10,011 words.
  const dictationText = Array(213).fill(words.join(" ")).join(" ");

  test("Execution time is < 15ms for ~10,000 words", () => {
    const start = performance.now();
    scrubPhi(dictationText);
    const end = performance.now();

    const durationMs = end - start;
    console.log(`Execution time for ~10,000 words: ${durationMs.toFixed(2)} ms`);
    assert.ok(durationMs < 15, `Execution time ${durationMs.toFixed(2)}ms exceeded the 15ms limit.`);
  });

  test("Zero memory leaks across 500 benchmark iterations", () => {
    // Force GC to get a clean baseline
    gc();
    const initialMemory = process.memoryUsage().heapUsed;

    for (let i = 0; i < 500; i++) {
      scrubPhi(dictationText);
    }

    // Force GC after iterations to measure retained memory
    gc();
    const finalMemory = process.memoryUsage().heapUsed;

    const diffMb = (finalMemory - initialMemory) / 1024 / 1024;
    console.log(`Memory difference after 500 iterations: ${diffMb.toFixed(4)} MB`);

    // We consider < 2MB difference as no memory leak
    assert.ok(diffMb < 2.0, `Memory leak detected: heap increased by ${diffMb.toFixed(2)} MB`);
  });
});
