## 2024-05-18 - Dexie Bulk Operations & Compound Index Performance

- **Learnings**: IndexedDB operations in PWA context can bottleneck if not indexed appropriately. Adding a compound index `[tenant_id+status]` to the `inventoryItems` store significantly optimizes frontend data querying tasks avoiding full table scans.
- **Edge cases**: Existing schemas must define indices properly. If an index does not exist natively, queries might fall back to JavaScript-level filtering, dropping performance dramatically. Upgrading Dexie versioning correctly ensures existing cached instances don't corrupt and they successfully apply new schema.
- **Bottlenecks**: Inserting 500+ records one-by-one is unviable on weak mobile devices; utilizing `bulkPut` ensures completion well under the 200ms threshold (measured at ~50-80ms).
## 2024-11-20 - [Performance] Optimized offline sync payload
- Reduced sync payload size by transmitting only minimal JSON diffs between local modified state and remote records instead of entire item payloads. Implemented a generic `diffRecords` utility robustly handling primitive changes, nested objects, and field additions/removals.
