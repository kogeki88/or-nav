## 2024-10-30 - Graph Pathfinding Performance

When performing Breadth-First Search across highly-connected synthetic graphs (1,000+ entities), standard array spreading (e.g. `[...currentPath, neighbor]`) inside the queue creates excessive memory pressure and allocation overhead, slowing down traversal times significantly.

By refactoring the queue to only store node identifiers and using a separate `Map<string, string>` to track parent pointers (`parentMap.set(neighbor, currentNode)`), we eliminate dynamic array creation. Reconstructing the path at the end by backtracking through the parent map drastically improved traversal time from >19ms to under 5ms, well within the performance envelope for real-time edge processing.

Cycles were handled correctly in both implementations by ensuring visited nodes were trapped in a `Set<string>` before evaluating neighborhood edges.

## 2024-05-18 - Dexie Bulk Operations & Compound Index Performance
- **Learnings**: IndexedDB operations in PWA context can bottleneck if not indexed appropriately. Adding a compound index `[tenant_id+status]` to the `inventoryItems` store significantly optimizes frontend data querying tasks avoiding full table scans.
- **Edge cases**: Existing schemas must define indices properly. If an index does not exist natively, queries might fall back to JavaScript-level filtering, dropping performance dramatically. Upgrading Dexie versioning correctly ensures existing cached instances don't corrupt and they successfully apply new schema.
- **Bottlenecks**: Inserting 500+ records one-by-one is unviable on weak mobile devices; utilizing `bulkPut` ensures completion well under the 200ms threshold (measured at ~50-80ms).

## 2024-11-20 - [Performance] Optimized offline sync payload
- Reduced sync payload size by transmitting only minimal JSON diffs between local modified state and remote records instead of entire item payloads. Implemented a generic `diffRecords` utility robustly handling primitive changes, nested objects, and field additions/removals.

## 2024-05-18 - Surgical Ontology Cache Optimization
**Component:** `frontend/src/lib/surgicalOntology.ts` (`normalizeOrLingo`)
**Problem:** Frequent clinical synonym lookup operations used inline regex recompilations on every query, causing an unnecessary performance drag when dealing with large volumes of lookups.
**Solution:**
1. Extracted all mapping objects (`EPONYM_PHONETIC_STT_MAP` and `OR_LINGO_EQUIVALENCE`) to pre-compiled `RegExp` objects executed iteratively over cached arrays (`PRECOMPILED_STT_KEYS` and `PRECOMPILED_LINGO_KEYS`).
2. Implemented an inline caching mechanism (`lingoCache`) mapping pre-normalized input strings to their fully substituted output using a standard `Map`.
3. Created performance test with 10,000 lookup iterations showing rapid response times with >95% cache hit rates.
