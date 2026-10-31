1. **Extend `coordinateParser.test.ts` for Multi-Tenant & Offline Replay Idempotency**:
   - I will use `replace_with_git_merge_diff` to add two new tests inside `describe("Invariants: Offline-First & Multi-Tenant Isolation")` in `frontend/src/lib/coordinateParser.test.ts`.
   - The first test will be for Offline Mutation Replay Idempotency, running the exact same input sequentially multiple times to prove the output is identical, verifying idempotency and offline statelessness.
   - The second test will enforce Multi-Tenant Boundary format `facility_id::dept_id`, mapping specific inputs to different isolated tenants and then resolving them concurrently using `Promise.all` + `setTimeout` micro-delays to ensure strict boundary enforcement and no state leakage across simulated concurrent facilities.
2. **Verify File Modifications**:
   - Use `run_in_bash_session` to execute `cat` or `sed` on the modified sections of `frontend/src/lib/coordinateParser.test.ts` to verify the changes were applied correctly.
3. **Verify Zero Regressions**:
   - Execute `npx tsx --test "frontend/**/*.test.ts"` using `run_in_bash_session` to guarantee zero regressions across the frontend.
4. Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
5. **Submit PR**: Call `submit` to push changes to the repository immediately upon successful verification.
