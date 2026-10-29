## 2026-10-29 - [Path Traversal in API]
**Vulnerability:** Path traversal in `get_pack_file` endpoint due to insufficient validation of the target path.
**Learning:** Checking for `..` is not sufficient, as absolute paths or normalized strings can bypass this logic, allowing arbitrary file reading (e.g. source code, `.env`).
**Prevention:** Always use `pathlib.Path.resolve()` and `Path.is_relative_to()` to strictly bound the target path to an allowed base directory.
## 2024-10-29 - Strict CORS & Security Headers Validation

When securing FastAPI applications, it's essential to:
1. Prevent permissive CORS configurations like `allow_origins=["*"]`. Instead, use `allow_origin_regex` to restrict origins to expected local development addresses and explicitly allowed external domains (like `trycloudflare.com` for local dev tunnels).
2. Explicitly define security headers via a custom middleware. Important headers include `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Content-Security-Policy: default-src 'self'`.
3. Validate CORS restrictions in automated tests by sending an OPTIONS request with an untrusted Origin header, ensuring the API responds with a `400 Bad Request`.
4. Validate header presence and exact configuration values in tests to prevent future regressions.
