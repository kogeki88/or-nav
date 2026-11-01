## 2026-11-01 - Auth Token Rotation Test Enhancement
**Vulnerability:** Weak enforcement of offline-first invariants and missing idempotency/rotation coverage for the `/api/auth/reset-password` endpoint.
**Learning:** Out-of-bounds network requests could theoretically bypass HTTPX mocks if a direct socket connection is made, and dynamically generated metrics mask true structural data equality checks, weakening replay idempotency verifications.
**Prevention:** Override `socket.socket` while explicitly bypassing `AF_UNIX` to preserve `asyncio` event loops. Strip temporal metrics (like `latency_ms`) directly from payloads before comparing API test responses sequentially to ensure true idempotency validation without breaking the system.
## 2024-05-24 - API Input Fuzzing, Offline Idempotency, and Tenant Boundary Hardening
**Vulnerability:** Missing fuzzing protections for various inventory mutations and questions endpoints, potential lack of isolated offline mutation replay, and multi-tenant data leaks.
**Learning:** Some POST endpoints lacked extensive fuzzing bounds to handle erratic sizes, and data scopes between distinct `or_main` vs `general_memorial_cvor` could potentially leak items/questions without strict test validations mapping out the data flow per tenant.
**Prevention:** Fuzz test string payload fields across API boundaries regularly, ensure multi-tenant logic relies strictly on isolating internal DB context by `tenant_id` early in routing, and enforce stateless mutation idempotency check assertions in backend tests using deterministic parameters.
## 2026-11-01 - CSP and Camera Media Protection Test
**Vulnerability:** Insufficient testing of backend security headers for media and framing origins.
**Learning:** We need to explicitly verify that the backend framework enforces strict Content-Security-Policy rules for `media-src` and `frame-ancestors` to prevent unauthorized framing and media access.
**Prevention:** Implement unit tests using FastAPIs `TestClient` to verify the presence of `media-src 'self' mediastream:` and `frame-ancestors 'none'` in the `Content-Security-Policy` header.
