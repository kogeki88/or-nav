1. **Extend tests in `QuestionsDrawer.test.tsx`**
   - Use `replace_with_git_merge_diff` to add new test cases handling multi-tenant isolation, offline-first execution, and idempotent offline mutation replays.
   - The test for multi-tenant isolation will render the component with distinct `tenantId`s and verify that each `fetch` call preserves the assigned tenant ID.
   - The offline-first test will temporarily mock `global.fetch = undefined as any` and attempt to add a question, verifying no crash occurs and `onRefreshQuestions` is called successfully (relying on the offline fallback implemented in `api.ts`).
   - The offline idempotency test will simulate consecutive duplicate operations (like clicking "Ask" rapidly) under offline conditions, and assert stable UI state without redundant submissions or crashes.

2. **Verify tests**
   - Run the frontend tests via `cd frontend && npx tsx --test "**/*.test.ts"` to ensure all unit tests pass, achieving zero regressions.

3. **Pre-commit step**
   - Ensure proper testing, verification, review, and reflection are done by invoking the pre-commit script.

4. **Submit PR**
   - Submit the PR once everything checks out.
