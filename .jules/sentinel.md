## 2024-05-15 - Hardening Offline Identity Mappings
**Vulnerability:** Scrubber logic for PHI mutations lacked assertions for true offline idempotency (sequential offline payloads could cause drift), and the function signature permitted malformed primitive boundaries (lists/dicts) without failing loudly.
**Learning:** Pure string processing functions that execute at the client or edge layer before a router must have strict validation logic to avoid coercing bad inputs that could bypass regex logic or cause unexpected JSON structural changes down stream.
**Prevention:** Strictly enforce type checking (`isinstance(text, str)`) around untyped regex targets to fail fast and write strict mutation replay assertions (`assert scrub(res.text) == res.text`).
