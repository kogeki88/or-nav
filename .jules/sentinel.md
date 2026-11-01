## 2026-11-01 - Auth Token Rotation Test Enhancement
**Vulnerability:** Weak enforcement of offline-first invariants and missing idempotency/rotation coverage for the `/api/auth/reset-password` endpoint.
**Learning:** Out-of-bounds network requests could theoretically bypass HTTPX mocks if a direct socket connection is made, and dynamically generated metrics mask true structural data equality checks, weakening replay idempotency verifications.
**Prevention:** Override `socket.socket` while explicitly bypassing `AF_UNIX` to preserve `asyncio` event loops. Strip temporal metrics (like `latency_ms`) directly from payloads before comparing API test responses sequentially to ensure true idempotency validation without breaking the system.
## 2025-02-19 - Prevent Query Injection in Dexie Search
**Vulnerability:** Core standalone offline search functions did not have tests proving robustness against adversarial queries like regex metacharacters, ReDoS payloads, or basic SQL injection fragments.
**Learning:** Testing string-matching functions against a suite of adversarial inputs ensures the local offline index (Dexie) search remains stable. The underlying functions correctly handle and sanitize input without hanging or crashing.
**Prevention:** Include adversarial and payload testing as part of standard unit tests for all user input processors.
