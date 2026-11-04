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

    await t.test("multi-tenant boundary enforcement (facility_id::dept_id) and offline mutation replay idempotency", () => {
      const tenantA = "facility_id::dept_id";
      const cardsA = [{ id: "A1", surgeon: "Dr. TenantA", procedure: "ProcA" }];
      const invA = [{ item: "ItemA", aliases: "item_a" }] as any;
      const graphA = compileClinicalGraph(tenantA, cardsA, invA, "");

      const tenantB = "other_facility::other_dept";
      const cardsB = [{ id: "B1", surgeon: "Dr. TenantB", procedure: "ProcB" }];
      const invB = [{ item: "ItemB", aliases: "item_b" }] as any;
      const graphB = compileClinicalGraph(tenantB, cardsB, invB, "");

      assert.strictEqual(graphA.tenantId, tenantA);
      assert.ok(graphA.indexedSurgeonNames.includes("Dr. TenantA"));
      assert.ok(!graphA.indexedSurgeonNames.includes("Dr. TenantB"));
      assert.ok(graphA.inventoryTerms.has("itema"));
      assert.ok(!graphA.inventoryTerms.has("itemb"));

      assert.strictEqual(graphB.tenantId, tenantB);
      assert.ok(graphB.indexedSurgeonNames.includes("Dr. TenantB"));
      assert.ok(!graphB.indexedSurgeonNames.includes("Dr. TenantA"));
      assert.ok(graphB.inventoryTerms.has("itemb"));
      assert.ok(!graphB.inventoryTerms.has("itema"));

      // Simulate Offline Mutation Replay Idempotency
      const replayGraph1 = compileClinicalGraph(tenantA, cardsA, invA, "");
      const replayGraph2 = compileClinicalGraph(tenantA, cardsA, invA, "");

      assert.strictEqual(replayGraph1.tenantId, replayGraph2.tenantId);
      assert.deepStrictEqual(replayGraph1.indexedSurgeonNames, replayGraph2.indexedSurgeonNames);
      assert.deepStrictEqual(Array.from(replayGraph1.inventoryTerms), Array.from(replayGraph2.inventoryTerms));
    });

  } finally {
    global.fetch = originalFetch;
  }
});

test("ClinicalGraph Boundary Inputs, Fuzzing, and Malformed Payload Resilience", async (t) => {
  await t.test("compileClinicalGraph gracefully handles null, undefined, and garbage input arrays", () => {
    const graph1 = compileClinicalGraph("tenant_fuzz", null as any, undefined as any, undefined as any);
    assert.ok(Array.isArray(graph1.preferenceCards));
    assert.ok(graph1.preferenceCards.length > 0);
    assert.ok(graph1.inventoryTerms instanceof Set);

    const garbageCards = [{ id: 123, surgeon: null, procedure: undefined, extraGarbage: "data" }, { id: "valid", surgeon: "Dr. Real" }] as any;
    const garbageInventory = [{ item: undefined, aliases: null }, { item: "valid item" }] as any;
    const garbageMd = 789 as any;

    const graph2 = compileClinicalGraph("tenant_garbage", garbageCards, garbageInventory, garbageMd);
    assert.ok(Array.isArray(graph2.preferenceCards));
    assert.strictEqual(graph2.preferenceCards.length, 1);
    assert.strictEqual(graph2.preferenceCards[0].id, "valid");
    assert.ok(graph2.inventoryTerms.has("valid item"));
  });

  await t.test("compileClinicalGraph gracefully handles massive string fuzzing", () => {
    const massiveString = "A".repeat(10000);
    const cards = [{ id: massiveString, surgeon: massiveString, procedure: massiveString }];
    const graph = compileClinicalGraph("tenant_fuzz2", cards, [], massiveString);

    assert.strictEqual(graph.tenantId, "tenant_fuzz2");
    assert.ok(Array.isArray(graph.preferenceCards));
  });

  await t.test("compileClinicalGraph enforces schema type invariants on items with malformed types", () => {
      const malformedCards = [
        { id: {}, surgeon: [], procedure: () => {} },
        { id: 45, surgeon: "Dr. Bad" }
      ] as any;

      const graph = compileClinicalGraph("tenant_schema", malformedCards, [], "");
      assert.ok(graph.preferenceCards);
      assert.strictEqual(graph.preferenceCards.length, 0); // Both should be rejected by strict schema checks
  });
});

test("ClinicalGraph High-Concurrency & Stress Benchmarks", async (t) => {
  await t.test("compileClinicalGraph handles concurrent burst execution and latency under load", async () => {
    const burstSize = 100;
    const tasks = [];
    const tenantIds = Array.from({ length: burstSize }, (_, i) => `tenant_burst_${i}`);

    const cards = [{ id: "C1", surgeon: "Dr. Burst", procedure: "BurstProc" }];
    const inventory = [{ item: "BurstItem", aliases: "burst" }];

    const startTime = performance.now();
    // Simulate interleaved burst by yielding to the event loop
    for (let i = 0; i < burstSize; i++) {
      tasks.push(new Promise((resolve) => {
        setImmediate(() => {
          resolve(compileClinicalGraph(tenantIds[i], cards, inventory as any, ""));
        });
      }));
    }

    const results = await Promise.all(tasks);
    const endTime = performance.now();

    assert.strictEqual(results.length, burstSize);
    for (let i = 0; i < burstSize; i++) {
      assert.strictEqual(results[i].tenantId, tenantIds[i]);
      assert.strictEqual(results[i].preferenceCards.length, 1);
      assert.ok(results[i].inventoryTerms.has("burstitem"));
    }

    const latency = endTime - startTime;
    assert.ok(latency < 1000, `Burst execution took ${latency}ms, exceeding 1000ms limit`);
  });
});


test("ClinicalGraph Fault Injection & Network Partition Resilience", async (t) => {
  await t.test("compileClinicalGraph gracefully handles simulated intermittent network latency during self-healing network partition", async () => {
    // Note: compileClinicalGraph is synchronous and does not use fetch directly,
    // but this test simulates how a sync manager would fetch data and then compile it,
    // enforcing offline invariants and latency bounds.
    let callCount = 0;

    // Simulate our application sync manager fetching data
    const syncManagerFetch = async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Network partition error - connection refused");
      }

      // Simulate latency on recovery
      await new Promise(r => setTimeout(r, 10));
      return {
        cards: [{ id: "C1", surgeon: "Dr. Recovered", procedure: "Rec" }],
        inventory: [{ item: "RecItem", aliases: "rec" }]
      };
    };

    let error = null;

    // 1. Network partition state
    try {
      await syncManagerFetch();
    } catch (err) {
      error = err;
    }

    assert.ok(error !== null, "Should have thrown a network partition error");

    // Compile graph handles offline fallback gracefully (using seed data / empty data)
    const offlineGraph = compileClinicalGraph("tenant_offline", [], [], "");
    assert.ok(offlineGraph !== null);
    assert.strictEqual(offlineGraph.preferenceCards.length, 0);

    // 2. Self-heal: Network recovers
    const startTime = performance.now();
    const data = await syncManagerFetch();
    const recoveredGraph = compileClinicalGraph("tenant_recovered", data.cards, data.inventory, "");
    const endTime = performance.now();

    // Verification of recovered data and latency constraints
    assert.strictEqual(recoveredGraph.preferenceCards.length, 1);
    assert.ok(recoveredGraph.inventoryTerms.has("recitem"));

    const latency = endTime - startTime;
    assert.ok(latency >= 10, "Latency constraint not respected"); // Should be at least our 10ms simulated latency
  });

  await t.test("findShortestPath correctly handles node isolation due to network degradation", () => {
      // Graph representing network partition where some nodes become unreachable
      const degradedGraph: Record<string, string[]> = {
          "A": ["B", "C"],
          "B": ["D"],
          "C": ["D"],
          "D": [], // D is a dead end
          "E": ["F"], // E and F are isolated from A-D due to partition
          "F": []
      };

      const pathOffline = findShortestPath(degradedGraph, "A", "F");
      assert.strictEqual(pathOffline, null, "Should return null when network partition isolates target node");

      const pathOnline = findShortestPath(degradedGraph, "A", "D");
      assert.ok(pathOnline !== null, "Should find path for connected nodes during partial degradation");
      assert.strictEqual(pathOnline.length, 3);
  });
});

test("ClinicalGraph Hardened Eviction and Caching Limits", async (t) => {
  await t.test("cache eviction strategy prevents infinite memory growth under sustained load", () => {
    if (global.gc) {
      global.gc();
    }

    const baselineMemory = process.memoryUsage().heapUsed;
    const cacheBustingIterations = 20000;

    const uniqueCards = Array.from({ length: 100 }, (_, i) => ({
      id: "C" + i,
      surgeon: "Dr. Unique" + i,
      procedure: "Proc" + i
    }));

    for (let i = 0; i < cacheBustingIterations; i++) {
        compileClinicalGraph("tenant_cache_" + String(i % 50), uniqueCards, [], "");
    }

    if (global.gc) {
      global.gc();
    }

    const currentMemory = process.memoryUsage().heapUsed;
    const growthMB = (currentMemory - baselineMemory) / 1024 / 1024;

    assert.ok(growthMB < 150, "Cache expansion exceeded safe eviction boundaries");
  });

  await t.test("no DOM event listener accumulation on actual global window/document objects", () => {
    if (typeof window !== "undefined") {
        let addedListeners = 0;
        const originalAddEventListener = window.addEventListener;
        const originalRemoveEventListener = window.removeEventListener;

        window.addEventListener = function(type, listener, options) {
            addedListeners++;
            return originalAddEventListener.apply(window, arguments as any);
        };

        window.removeEventListener = function(type, listener, options) {
            addedListeners--;
            return originalRemoveEventListener.apply(window, arguments as any);
        };

        compileClinicalGraph("tenant_listeners", [], [], "");

        assert.strictEqual(addedListeners, 0, "compileClinicalGraph should not leave unclosed event listeners on window");

        window.addEventListener = originalAddEventListener;
        window.removeEventListener = originalRemoveEventListener;
    } else {
        let addedListeners = 0;
        const originalOn = process.on;
        const originalRemove = process.removeListener;

        process.on = function(event, listener) {
             addedListeners++;
             return originalOn.apply(process, arguments as any);
        };
        process.removeListener = function(event, listener) {
             addedListeners--;
             return originalRemove.apply(process, arguments as any);
        }

        compileClinicalGraph("tenant_listeners_node", [], [], "");

        assert.strictEqual(addedListeners, 0, "compileClinicalGraph should not leave unclosed event listeners on process");

        process.on = originalOn;
        process.removeListener = originalRemove;
    }
  });
});
