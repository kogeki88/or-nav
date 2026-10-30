import test from "node:test";
import assert from "node:assert";
import { performance } from "node:perf_hooks";
import v8 from "node:v8";
import vm from "node:vm";
import { compileClinicalGraph } from "./clinicalGraph";
import { planClinicalQuery } from "./clinicalQueryPlanner";

test("ClinicalQueryPlanner Performance Benchmark - 5-clause compound query", async () => {
  v8.setFlagsFromString("--expose_gc");
  const gc = vm.runInNewContext("gc");

  const graph = compileClinicalGraph("or_main");
  const query = "Find laparoscope in room 4, check mesh in cart 2, and page scrub nurse, get dr. chen's prolene, and locate the debakey forceps";

  // Warmup
  for (let i = 0; i < 10; i++) {
    planClinicalQuery(query, graph);
  }

  const iterations = 1000;

  // Attempt GC
  if (typeof gc === 'function') {
    gc();
  } else if (global.gc) {
    global.gc();
  }

  const memoryBefore = process.memoryUsage().heapUsed;

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    planClinicalQuery(query, graph);
  }
  const end = performance.now();

  const totalTime = end - start;
  const avgTime = totalTime / iterations;

  // Let the engine breathe for a tick to stabilize memory stats
  await new Promise(resolve => setTimeout(resolve, 10));

  if (typeof gc === 'function') {
    gc();
  } else if (global.gc) {
    global.gc();
  }

  const memoryAfter = process.memoryUsage().heapUsed;
  const memoryDiff = memoryAfter - memoryBefore;

  console.log(`Average time per query: ${avgTime.toFixed(3)}ms`);
  console.log(`Total time for ${iterations} queries: ${totalTime.toFixed(3)}ms`);
  console.log(`Memory before: ${memoryBefore}`);
  console.log(`Memory after:  ${memoryAfter}`);
  console.log(`Memory diff:   ${memoryDiff}`);

  // Assert execution time under 10ms
  assert.ok(avgTime < 10, `Execution time per query must be under 10ms, got ${avgTime}ms`);

  // Assert no significant memory leaks. A small positive memory diff might happen due to testing overhead,
  // but it shouldn't be larger than a few megabytes. Here we use 2MB as an arbitrary strict limit.
  assert.ok(memoryDiff < 2 * 1024 * 1024, `Memory leak detected! Diff: ${memoryDiff} bytes`);
});
