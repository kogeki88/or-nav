import test from "node:test";
import assert from "node:assert/strict";
import { findShortestPath, compileClinicalGraph } from "./clinicalGraph";

test("ClinicalGraph Performance and Cycle Detection Benchmarks", async (t) => {
  await t.test("findShortestPath correctly handles cycles and performs under 5ms", () => {
    const NUM_NODES = 1200; // 1,000+ nodes
    const graph: Record<string, string[]> = {};

    // Generate a cyclic, highly connected graph
    for (let i = 0; i < NUM_NODES; i++) {
      const node = `node_${i}`;
      graph[node] = [];
      // Connect each node to the next 5 nodes to create a dense graph
      for (let j = 1; j <= 5; j++) {
        if (i + j < NUM_NODES) {
          graph[node].push(`node_${i + j}`);
        }
      }
      // Add explicit cycle by connecting back to an earlier node periodically
      if (i % 10 === 0 && i > 0) {
        graph[node].push(`node_${i - 5}`);
      }
    }

    // Measure time to find path from beginning to end
    const startNode = "node_0";
    const endNode = `node_${NUM_NODES - 1}`;

    const startTime = performance.now();
    const path = findShortestPath(graph, startNode, endNode);
    const endTime = performance.now();

    const duration = endTime - startTime;

    assert.ok(path !== null, "Path should be found");
    assert.strictEqual(path[0], startNode, "Path should start at startNode");
    assert.strictEqual(path[path.length - 1], endNode, "Path should end at endNode");

    // Performance benchmark - if duration > 5ms, the implementation is too slow
    // 19ms is too slow! I need to optimize `findShortestPath`.
    // It creates many arrays dynamically `[...currentPath, neighbor]`.
    assert.ok(duration < 5, `Pathfinding took ${duration}ms, which exceeds 5ms limit`);

    // Add explicit malformed cycle trap and test cycle handling
    const malformedGraph: Record<string, string[]> = {
        "A": ["B"],
        "B": ["C", "A"], // cycle back to A
        "C": ["D"],
        "D": ["B"]  // cycle back to B
    };

    const cyclePath = findShortestPath(malformedGraph, "A", "Z");
    assert.strictEqual(cyclePath, null, "Should return null for unreachable node without infinite loop");

  });
});
test("ClinicalGraph Multi-tenant Isolation and Offline Invariants", async (t) => {
  const originalFetch = global.fetch;
  try {
    global.fetch = (async () => { throw new Error("Network offline"); }) as any;

    await t.test("compileClinicalGraph enforces multi-tenant isolation", () => {
      const tenantACards = [{ id: "A1", surgeon: "Dr. Smith", procedure: "TKA" }];
      const tenantAInventory = [{ item: "Scalpel A", aliases: "knife" }];
      const graphA = compileClinicalGraph("tenant_a", tenantACards, tenantAInventory as any, "");

      const tenantBCards = [{ id: "B1", surgeon: "Dr. Jones", procedure: "Appy" }];
      const tenantBInventory = [{ item: "Scalpel B", aliases: "blade" }];
      const graphB = compileClinicalGraph("tenant_b", tenantBCards, tenantBInventory as any, "");

      assert.strictEqual(graphA.tenantId, "tenant_a");
      assert.ok(graphA.indexedSurgeonNames.includes("Dr. Smith"));
      assert.ok(!graphA.indexedSurgeonNames.includes("Dr. Jones"));
      assert.ok(graphA.inventoryTerms.has("scalpel a"));
      assert.ok(graphA.inventoryTerms.has("knife"));
      assert.ok(!graphA.inventoryTerms.has("scalpel b"));

      assert.strictEqual(graphB.tenantId, "tenant_b");
      assert.ok(graphB.indexedSurgeonNames.includes("Dr. Jones"));
      assert.ok(!graphB.indexedSurgeonNames.includes("Dr. Smith"));
      assert.ok(graphB.inventoryTerms.has("scalpel b"));
      assert.ok(graphB.inventoryTerms.has("blade"));
      assert.ok(!graphB.inventoryTerms.has("scalpel a"));
    });

    await t.test("compileClinicalGraph handles structural surgeon pattern correctly", () => {
      const cards = [
        { id: "C1", surgeon: "Dr. Gregory House, MD", procedure: "Diagnostics" },
        { id: "C2", surgeon: "Doctor Strange", procedure: "Magic" }
      ];
      const graph = compileClinicalGraph("tenant_c", cards, [], "");

      assert.ok(graph.indexedSurgeonNames.includes("Dr. Gregory House"));
      assert.ok(!graph.indexedSurgeonNames.includes("Doctor Strange")); // "Doctor Strange" does not start with "Dr." so it isn't in indexedSurgeonNames array, but it is parsed.
      assert.ok(graph.surgeonsByToken["house"]);
      assert.ok(graph.surgeonsByToken["strange"]);
      assert.ok(graph.surgeonsByToken["gregory house"]);
    });

    await t.test("compileClinicalGraph correctly builds core contract invariants offline", () => {
      const graph = compileClinicalGraph("offline_tenant", [], [], "");
      assert.ok(Array.isArray(graph.preferenceCards));
      assert.ok(Array.isArray(graph.indexedSurgeonNames));
      assert.ok(graph.inventoryTerms instanceof Set);
      assert.ok(graph.protocolTopics instanceof Set);
      assert.ok(typeof graph.surgeonsByToken === "object");
      assert.ok(typeof graph.proceduresByPhrase === "object");
    });

  } finally {
    global.fetch = originalFetch;
  }
});
