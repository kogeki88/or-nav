## 2026-11-01 - Auth Token Rotation Test Enhancement
**Vulnerability:** Weak enforcement of offline-first invariants and missing idempotency/rotation coverage for the `/api/auth/reset-password` endpoint.
**Learning:** Out-of-bounds network requests could theoretically bypass HTTPX mocks if a direct socket connection is made, and dynamically generated metrics mask true structural data equality checks, weakening replay idempotency verifications.
**Prevention:** Override `socket.socket` while explicitly bypassing `AF_UNIX` to preserve `asyncio` event loops. Strip temporal metrics (like `latency_ms`) directly from payloads before comparing API test responses sequentially to ensure true idempotency validation without breaking the system.

## 2026-11-01 - Preference Card Tenant Isolation Verification
**Vulnerability:** Attempted cross-tenant preference card updates across `facility_id::dept_id` boundaries.
**Learning:** Evaluated backend endpoints for potential cross-tenant writes to `preference_cards.json`. Tested the ingest endpoint and path traversal vulnerabilities for multi-tenant database isolation invariant. Found that the API endpoints handle reads correctly across tenant boundaries and explicitly prevent writes directly to the `.json` files via the `/api/packs/file` and `/api/ingest` endpoints through HTTP method restrictions (405) and strict validations (400).
**Prevention:** Strict file type validation and method allowed restrictions prevent arbitrary cross-tenant JSON overwrites. Ensuring the test coverage maintains explicit checks for these boundaries guarantees no regressions.
