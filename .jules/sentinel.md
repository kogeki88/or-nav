## 2024-11-01 - Sentinel Security Task: API Rate Limiting

**Vulnerability:** DoS vulnerability in rate limiting setup.
**Learning:** Adding `@limiter.limit("60/minute")` to an endpoint requires explicitly adding a `request: Request` parameter in the endpoint function signature. If `slowapi` checks for the rate limit but the `Request` object is missing from the function definition, an error is raised (often caught globally and returning HTTP 500) rendering the rate limit ineffective and the endpoint broken.
**Prevention:** Always verify endpoint signatures have `request: Request` when decorating them with `@limiter.limit`. Add integration tests validating 429 status code returns explicitly with a `TestClient` initialized with an enabled limiter.
