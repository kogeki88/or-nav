Plan:
1. Add high-concurrency benchmarks for SurgicalOntologyService functions in `backend/tests/test_surgical_ontology.py`. We need tests to check:
    - High-concurrency performance of string parsing and extraction (`normalize_or_lingo`, `extract_eponyms`, `strip_spoken_disfluencies`) via `concurrent.futures.ThreadPoolExecutor`.
    - Total average wall latency calculations (`< 50ms`) due to GIL impact.
    - Multi-tenant isolation simulation (passing different payloads concurrently and verifying responses).
    - Offline-first invariants mock assertions during concurrent load.
