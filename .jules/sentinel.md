## 2026-11-01 - Auth Token Rotation Test Enhancement
**Vulnerability:** Weak enforcement of offline-first invariants and missing idempotency/rotation coverage for the `/api/auth/reset-password` endpoint.
**Learning:** Out-of-bounds network requests could theoretically bypass HTTPX mocks if a direct socket connection is made, and dynamically generated metrics mask true structural data equality checks, weakening replay idempotency verifications.
**Prevention:** Override `socket.socket` while explicitly bypassing `AF_UNIX` to preserve `asyncio` event loops. Strip temporal metrics (like `latency_ms`) directly from payloads before comparing API test responses sequentially to ensure true idempotency validation without breaking the system.
