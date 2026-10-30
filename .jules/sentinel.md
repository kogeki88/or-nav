## 2025-02-14 - Prevent ReDoS and Query Injection via Regex Metacharacters

Identified a vulnerability in `frontend/src/lib/standaloneEngine.ts` where unescaped strings were dynamically injected into a `new RegExp` constructor (`highlightSurgeonNote` function). This allowed potential Regular Expression Denial of Service (ReDoS) via adversarial inputs like `.*` or SQL-like fragments.

Fix applied:
- Implemented `sLast.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` to escape regex metacharacters.
- Addressed boundary matching for escaped strings (which may fail `\b` assertions if they end in non-word characters) by switching to negative lookarounds `(?<!\w)` and `(?!\w)`.
- Protected intentional splitting logic (which splits on `;`) by ensuring that if a user's input legitimately contains `;`, it won't inadvertently break the phrase matching via premature splitting.
- Added comprehensive unit tests in `frontend/src/lib/standaloneEngine.test.ts` to assert that injection attempts (`.*`, `[a-z]+(a+)+$`, `' DROP TABLE items; --`) are handled securely and literally.

## 2024-10-29 - Strict CORS & Security Headers Validation

When securing FastAPI applications, it's essential to:
1. Prevent permissive CORS configurations like `allow_origins=["*"]`. Instead, use `allow_origin_regex` to restrict origins to expected local development addresses and explicitly allowed external domains (like `trycloudflare.com` for local dev tunnels).
2. Explicitly define security headers via a custom middleware. Important headers include `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Content-Security-Policy: default-src 'self'`.
3. Validate CORS restrictions in automated tests by sending an OPTIONS request with an untrusted Origin header, ensuring the API responds with a `400 Bad Request`.
4. Validate header presence and exact configuration values in tests to prevent future regressions.

## 2024-10-31 - [Enforcing Strict CSP Media Policies]
When modifying FastAPI security headers to strictly enforce Content-Security-Policy (CSP) for media and iframes, ensure that the policy explicitly includes `media-src 'self' mediastream:;` and `frame-ancestors 'none';`. This prevents unauthorized external sources from embedding the application or interacting with camera and microphone media APIs.

## 2024-11-20 - Enforcing Authorized Clinical Roles in Profile Update Modal
- Ensure UI inputs selecting authorization roles are strictly validated against the server-authorized (or pre-defined mapping) roles to prevent unauthenticated privilege escalation via DOM manipulation.
- Verify authorization changes successfully dispatch relevant audit logs/events to monitor for role tampering.

## 2026-10-30 - [Rate Limiter Middleware]

Rate limiting is critical to protect public endpoints (like `/api/chat` and `/api/voice/token`) against DoS and brute-force attacks. The slowapi package allows decorators like `@limiter.limit("60/minute")` to easily enforce these limits on FastAPI routers. Testing entails iterating over the threshold and asserting the `429 Too Many Requests` status code and the presence of a `retry-after` header in the response.
## 2026-10-29 - [Path Traversal in API]
**Vulnerability:** Path traversal in `get_pack_file` endpoint due to insufficient validation of the target path.
**Learning:** Checking for `..` is not sufficient, as absolute paths or normalized strings can bypass this logic, allowing arbitrary file reading (e.g. source code, `.env`).
**Prevention:** Always use `pathlib.Path.resolve()` and `Path.is_relative_to()` to strictly bound the target path to an allowed base directory.

## 2024-10-24 - [LiveKit JWT Voice Token Security]
- **Vulnerability**: JWT voice tokens lacked time-to-live enforcement (TTL).
- **Prevention**: Added a strictly enforced time-to-live to minted token (`.with_ttl(datetime.timedelta(minutes=10))`). Verified metadata and identity mappings using standard claims.
## 2023-10-29 - [Security Fix: Error Leakage Sanitization]
Implemented a global `Exception` handler in `backend/app/main.py` using FastAPI's `@app.exception_handler(Exception)` mechanism. This ensures that any unexpected runtime errors fail securely, returning a generic `500 Internal Server Error` response instead of a raw Python traceback.
This prevents the exposure of critical filesystem paths and environment variables (such as API keys and credentials) in publicly facing endpoints, addressing a critical vulnerability and ensuring robust information sanitization in the API responses.
