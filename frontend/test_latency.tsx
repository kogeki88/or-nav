import "jsdom-global/register";
import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import React from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuestionsDrawer from "./src/components/QuestionsDrawer";
import "fake-indexeddb/auto";

const originalFetch = global.fetch;

describe("QuestionsDrawer Latency Tests", () => {
  const tenantId = "test-tenant-123";
  let mockQuestions: any[] = [];
  let onRefreshQuestions: any;
  let fetchMock: any;

  beforeEach(() => {
    mockQuestions = [
      {
        id: "q1",
        question_text: "Where are the 5-0 prolene sutures? Department: CVOR",
        status: "open",
        asked_by_role: "Clinical Orientee RN",
        answers: [],
      }
    ];
    onRefreshQuestions = mock.fn(() => Promise.resolve());
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    mock.restoreAll();
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
    const askButton = screen.getByText("Ask").closest('button') as HTMLButtonElement;

    await userEvent.type(input, "Latency Question");

    // We don't await the click because we want to inspect intermediate state
    const user = userEvent.setup();
    const clickPromise = user.click(askButton);

    // Verify it's in a submitting state / disabled
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
