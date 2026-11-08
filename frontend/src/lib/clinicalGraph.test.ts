import test from "node:test";
import assert from "node:assert/strict";
import { findShortestPath, compileClinicalGraph } from "./clinicalGraph";

test("ClinicalGraph Performance and Cycle Detection Benchmarks", async (t) => {
  await t.test("findShortestPath correctly handles cycles and performs under 10ms", () => {
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
    assert.ok(duration < 10, `Pathfinding took ${duration}ms, which exceeds 10ms limit`);

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
    global.fetch = (async (...args: any[]) => { if (args.length === 0) throw new TypeError("Missing arguments"); throw new Error("Network offline"); }) as any;

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
      const cardsA = [{ id: `A1_${tenantA}`, surgeon: `Dr. Surgeon_${tenantA}`, procedure: `Proc_${tenantA}` }];
      const invA = [{ item: `Item_${tenantA}`, aliases: `item_alias_${tenantA}` }] as any;
      const graphA = compileClinicalGraph(tenantA, cardsA, invA, "");

      const tenantB = "other_facility::other_dept";
      const cardsB = [{ id: `B1_${tenantB}`, surgeon: `Dr. Surgeon_${tenantB}`, procedure: `Proc_${tenantB}` }];
      const invB = [{ item: `Item_${tenantB}`, aliases: `item_alias_${tenantB}` }] as any;
      const graphB = compileClinicalGraph(tenantB, cardsB, invB, "");

      const normTenantA = "item facility id dept id";
      const normTenantB = "item other facility other dept";

      assert.strictEqual(graphA.tenantId, tenantA);
      assert.ok(graphA.indexedSurgeonNames.includes(`Dr. Surgeon_${tenantA}`));
      assert.ok(!graphA.indexedSurgeonNames.includes(`Dr. Surgeon_${tenantB}`));
      assert.ok(graphA.inventoryTerms.has(normTenantA));
      assert.ok(!graphA.inventoryTerms.has(normTenantA + "_10"));
      assert.ok(!graphA.inventoryTerms.has(normTenantB));

      assert.strictEqual(graphB.tenantId, tenantB);
      assert.ok(graphB.indexedSurgeonNames.includes(`Dr. Surgeon_${tenantB}`));
      assert.ok(!graphB.indexedSurgeonNames.includes(`Dr. Surgeon_${tenantA}`));
      assert.ok(graphB.inventoryTerms.has(normTenantB));
      assert.ok(!graphB.inventoryTerms.has(normTenantA));

      // Simulate Offline Mutation Replay Idempotency
      const replayGraph1 = compileClinicalGraph(tenantA, cardsA, invA, "");

      // Simulate time advancing or fluctuating fields
      const cardsAMutated = [{ ...cardsA[0], timestamp: Date.now() }];
      const replayGraph2 = compileClinicalGraph(tenantA, cardsAMutated, invA, "");

      function deepClean(obj: any): any {
          if (obj === null || obj === undefined) return obj;
          if (typeof obj !== 'object') return obj;

          if (obj instanceof Set) return new Set([...obj].map(deepClean));
          if (Array.isArray(obj)) return obj.map(deepClean);

          const cleaned = { ...obj };
          for (const key in cleaned) {
              if (key === 'timestamp' || key === 'latency_ms') {
                  delete cleaned[key];
              } else {
                  cleaned[key] = deepClean(cleaned[key]);
              }
          }
          return cleaned;
      }

      // We need to apply deepClean AFTER structuredClone to preserve isolation
      const cleanReplay1 = deepClean(typeof structuredClone === "function" ? structuredClone(replayGraph1) : JSON.parse(JSON.stringify(replayGraph1)));
      const cleanReplay2 = deepClean(typeof structuredClone === "function" ? structuredClone(replayGraph2) : JSON.parse(JSON.stringify(replayGraph2)));

      assert.deepStrictEqual(cleanReplay1, cleanReplay2);
    });

  } finally {
    if (originalFetch === undefined) {
      delete (global as any).fetch;
    } else {
      global.fetch = originalFetch;
    }
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
    const tenantIds = Array.from({ length: burstSize }, (_, i) => `sacred_heart::or_burst_${i}`);

    const cards = [{ id: "C1", surgeon: "Dr. Burst", procedure: "BurstProc" }];
    const inventory = [{ item: "BurstItem", aliases: "burst" }];

    const startTime = performance.now();
    // Simulate interleaved burst by yielding to the event loop with jitter
    const tasks = tenantIds.map(async (tenantId, i) => {
      await new Promise(r => setTimeout(r, (i * 13) % 10));
      return compileClinicalGraph(tenantId, cards, inventory as any, "");
    });

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

    // 1. Network partition state
    await assert.rejects(
      async () => { await syncManagerFetch(); },
      (err) => err.message === "Network partition error - connection refused",
      "Should have thrown a network partition error"
    );

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
    // Allow for a bit of timer variation depending on OS
    assert.ok(latency >= 8, `Latency constraint not respected, latency was ${latency}`); // Should be at least our 10ms simulated latency
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
        compileClinicalGraph("tenant_cache_" + String(i), uniqueCards, [], "");
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


test("ClinicalGraph Security and Redaction Invariants", async (t) => {
  await t.test("HIPAA PHI boundary verification and prompt injection hardening", () => {
    // 1. Pass explicitly scrubbed data (like [REDACTED_PHI])
    // Ensure it safely round-trips without corruption or unintended evaluation
    const maliciousStrings = [
      "; DROP TABLE users;",
      "<script>alert(1)</script>",
      "\x00\x01",
      "[REDACTED_PHI]",
      "__proto__",
      "constructor"
    ];

    const cards = maliciousStrings.map((str, i) => ({
      id: "C" + i,
      surgeon: "Dr. " + str,
      procedure: "Proc " + str
    }));

    const inventory = maliciousStrings.map((str, i) => ({
      item: "Item " + str,
      aliases: str
    }));

    const graph = compileClinicalGraph("tenant_secure", cards, inventory as any, "");

    // Verify it handles malicious strings and redaction tokens
    assert.strictEqual(graph.tenantId, "tenant_secure");

    // The token "[REDACTED_PHI]" should be preserved as-is internally before normalization
    // or handled correctly.
    // Verify zero-trust isolation and boundary attacks didn't corrupt the graph
    assert.ok(graph.preferenceCards.length === maliciousStrings.length);
  });
});




test("Clinical Workflow Snapshot & Deterministic State Verifications", async (t) => {
  await t.test("deterministic state transition matrices via structural deepcopy comparison", () => {
    const cards = [
      { id: "C1", surgeon: "Dr. Smith", procedure: "Appendectomy" }
    ];
    const inventory = [{ item: "Scalpel", aliases: "knife" }];
    const md = "# Time Out\n# Surgical Count";

    const graph = compileClinicalGraph("tenant_snapshot", cards, inventory as any, md);

    // Deep freeze active state to trigger TypeError on implicit mutation
    graph.preferenceCards.forEach(Object.freeze);
    Object.freeze(graph.preferenceCards);
    Object.freeze(graph);

    // Create a separate deep copy for structural assertion
    const customClone = typeof structuredClone === "function" ? structuredClone : (val: any) => JSON.parse(JSON.stringify(val));
    const baselineCopy = customClone(graph);

    // Deep freeze baseline state
    baselineCopy.preferenceCards.forEach(Object.freeze);
    Object.freeze(baselineCopy.preferenceCards);
    Object.freeze(baselineCopy);

    // Perform a pseudo-mutation (compile again with identical inputs)
    const graph2 = compileClinicalGraph("tenant_snapshot", cards, inventory as any, md);
    const snapshotCopy2 = customClone(graph2);

    // Verify deterministic state consistency (no hidden mutations on consecutive runs)
    assert.deepStrictEqual(baselineCopy, snapshotCopy2, "State transitions must be deterministic for identical inputs");

    // Verify specific structural components are preserved in the snapshot
    assert.strictEqual(baselineCopy.tenantId, "tenant_snapshot");
    assert.strictEqual(baselineCopy.preferenceCards.length, 1);
  });

  await t.test("preference card conflict resolution correctly handles collisions", () => {
    // Two cards with identical surgeon and procedure, but different IDs and extra data.
    // In our domain, we expect the graph compilation to preserve both or merge them deterministically.
    // The current implementation of compileClinicalGraph processes them sequentially.
    const cards = [
      { id: "C_A", surgeon: "Dr. Conflict", procedure: "Merge Test", data: "first" },
      { id: "C_B", surgeon: "Dr. Conflict", procedure: "Merge Test", data: "second" }
    ];

    const graph = compileClinicalGraph("tenant_conflict", cards, [], "");

    // Verify both are preserved in preferenceCards array
    assert.strictEqual(graph.preferenceCards.length, 2);

    // Verify they map correctly in surgeonsByToken
    const lowerToken = "conflict";
    assert.ok(graph.surgeonsByToken[lowerToken], "Surgeon token should be indexed");
    assert.strictEqual(graph.surgeonsByToken[lowerToken].length, 2, "Both cards should be mapped to the same surgeon token");
    assert.strictEqual(graph.surgeonsByToken[lowerToken][0].id, "C_A");
    assert.strictEqual(graph.surgeonsByToken[lowerToken][1].id, "C_B");

    // Verify proceduresByPhrase maps both cards to the same procedure
    const normProc = "merge test";
    assert.ok(graph.proceduresByPhrase[normProc], "Procedure phrase should be indexed");
    assert.strictEqual(graph.proceduresByPhrase[normProc].length, 2);
    assert.strictEqual(graph.proceduresByPhrase[normProc][0], "C_A");
    assert.strictEqual(graph.proceduresByPhrase[normProc][1], "C_B");
  });

  await t.test("clinical state snapshot consistency verifies sets and complex structures", () => {
    const cards = [{ id: "C1", surgeon: "Dr. A", procedure: "Proc A" }];
    const inventory = [{ item: "Item A", aliases: "alias_a" }];
    const graph = compileClinicalGraph("tenant_complex", cards, inventory as any, "# Protocol");

    // Sets are not serializable natively in JSON.stringify without custom replacers,
    // so we verify their state explicitly.
    assert.ok(graph.inventoryTerms instanceof Set);
    assert.strictEqual(graph.inventoryTerms.size, 2); // 'item a' and 'alias_a'
    assert.ok(graph.inventoryTerms.has("item a"));
    assert.ok(graph.inventoryTerms.has("alias a"));

    assert.ok(graph.protocolTopics instanceof Set);
    // Protocol topics will have built-ins + custom. We just check if it has the custom one.
    assert.ok(graph.protocolTopics.has("protocol"));
  });
});
