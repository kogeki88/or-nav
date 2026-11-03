import "jsdom-global/register";
import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import React from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuestionsDrawer from "./src/components/QuestionsDrawer";
import "fake-indexeddb/auto";

// We override fetch to track API calls without proxyquire
const originalFetch = global.fetch;

describe("QuestionsDrawer Concurrent Tests", () => {
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
    fetchMock = mock.fn(async (url: any, options: any) => {
      // Simulate network latency
      await new Promise(resolve => setTimeout(resolve, 50));
      return { ok: true, json: async () => ({}) };
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    mock.restoreAll();
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
    const askButton = screen.getByText("Ask") as HTMLButtonElement;

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
});
