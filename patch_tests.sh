cat << 'INNER_EOF' > /tmp/patch_file.patch
<<<<<<< SEARCH
  it("should enforce offline-first invariants gracefully", async () => {
    global.fetch = undefined as any;

    render(
=======
  it("should enforce offline-first invariants gracefully", async () => {
    global.fetch = mock.fn(() => Promise.reject(new TypeError("Failed to fetch"))) as any;

    render(
>>>>>>> REPLACE
<<<<<<< SEARCH
  it("should verify offline mutation replay idempotency", async () => {
    global.fetch = undefined as any;

    const propsA = {
=======
  it("should verify offline mutation replay idempotency", async () => {
    global.fetch = mock.fn(() => Promise.reject(new TypeError("Failed to fetch"))) as any;

    const propsA = {
>>>>>>> REPLACE
<<<<<<< SEARCH
    assert.ok(screen.getByText("Missing some fields"));
    // Default open badge fallback should happen or error out safely
    assert.ok(screen.getByText("Open Question"));
  });
});
=======
    assert.ok(screen.getByText("Missing some fields"));
    // Default open badge fallback should happen or error out safely
    assert.ok(screen.getByText("Open Question"));
  });

  it("should handle concurrent burst execution and race condition resistance", async () => {
    const { unmount } = render(
      <QuestionsDrawer
        isOpen={true}
        onClose={() => {}}
        tenantId={tenantId}
        questions={mockQuestions}
        onRefreshQuestions={onRefreshQuestions}
      />
    );

    const input = screen.getByPlaceholderText("e.g. Where are backup 5-0 Prolene sutures kept?") as HTMLInputElement;
    const askButton = screen.getByText("Ask").closest("button") as HTMLButtonElement;

    // Simulate typing a question
    await userEvent.type(input, "Concurrent Question");

    // Burst click the ask button multiple times without waiting
    userEvent.click(askButton);
    userEvent.click(askButton);
    userEvent.click(askButton);
    userEvent.click(askButton);
    userEvent.click(askButton);

    await waitFor(() => {
      assert.strictEqual(input.value, "");
    }, { timeout: 1000 });

    // Ensure it was only submitted once due to UI disabled state / submitting guard
    const fetchCalls = fetchMock.mock.calls.filter((c: any) => c.arguments[0].includes("/api/questions") && c.arguments[1].method === "POST");
    assert.strictEqual(fetchCalls.length, 1);
    assert.strictEqual(onRefreshQuestions.mock.calls.length, 1);

    unmount();
  });

  it("should handle extreme network latency gracefully during submission", async () => {
    // Simulate high latency
    fetchMock = mock.fn(async (url: any, options: any) => {
      await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
      return { ok: true, json: async () => ({}) };
    });
    global.fetch = fetchMock;

    const { unmount } = render(
      <QuestionsDrawer
        isOpen={true}
        onClose={() => {}}
        tenantId={tenantId}
        questions={mockQuestions}
        onRefreshQuestions={onRefreshQuestions}
      />
    );

    const input = screen.getByPlaceholderText("e.g. Where are backup 5-0 Prolene sutures kept?") as HTMLInputElement;
    const askButton = screen.getByText("Ask").closest("button") as HTMLButtonElement;

    await userEvent.type(input, "Latency Question");

    // We don't await the click because we want to inspect intermediate state
    const user = userEvent.setup();
    const clickPromise = user.click(askButton);

    // wait for state update
    await waitFor(() => {
        assert.strictEqual(askButton.disabled, true);
    });

    await clickPromise;

    await waitFor(() => {
      assert.strictEqual(input.value, "");
      assert.strictEqual(askButton.disabled, true); // It gets disabled when empty
    }, { timeout: 2000 });

    const fetchCalls = fetchMock.mock.calls.filter((c: any) => c.arguments[0].includes("/api/questions") && c.arguments[1].method === "POST");
    assert.strictEqual(fetchCalls.length, 1);

    unmount();
  });
});
>>>>>>> REPLACE
INNER_EOF
