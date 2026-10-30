## 2025-02-14 - Prevent ReDoS and Query Injection via Regex Metacharacters

Identified a vulnerability in `frontend/src/lib/standaloneEngine.ts` where unescaped strings were dynamically injected into a `new RegExp` constructor (`highlightSurgeonNote` function). This allowed potential Regular Expression Denial of Service (ReDoS) via adversarial inputs like `.*` or SQL-like fragments.

Fix applied:
- Implemented `sLast.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` to escape regex metacharacters.
- Addressed boundary matching for escaped strings (which may fail `\b` assertions if they end in non-word characters) by switching to negative lookarounds `(?<!\w)` and `(?!\w)`.
- Protected intentional splitting logic (which splits on `;`) by ensuring that if a user's input legitimately contains `;`, it won't inadvertently break the phrase matching via premature splitting.
- Added comprehensive unit tests in `frontend/src/lib/standaloneEngine.test.ts` to assert that injection attempts (`.*`, `[a-z]+(a+)+$`, `' DROP TABLE items; --`) are handled securely and literally.
