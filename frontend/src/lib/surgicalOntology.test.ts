import test from "node:test";
import assert from "node:assert";
import { normalizeOrLingo, cacheStats, lingoCache } from "./surgicalOntology";

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
        // use modulo to loop through the test words
        const query = queries[i % queries.length];
        normalizeOrLingo(query);
    }

    const totalLookups = cacheStats.hits + cacheStats.misses;
    const hitRate = cacheStats.hits / totalLookups;

    assert.strictEqual(totalLookups, iterations);
    // Since there are 8 distinct queries, we expect 8 misses and 9992 hits.
    assert.strictEqual(cacheStats.misses, 8);
    assert.strictEqual(cacheStats.hits, 9992);

    assert.ok(hitRate > 0.95, `Expected hit rate > 95%, but got ${(hitRate * 100).toFixed(2)}%`);
});
