import "jsdom-global/register";
import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import React from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuestionsDrawer from "./QuestionsDrawer";
import "fake-indexeddb/auto"; // Keep IndexedDB mock just in case

// We override fetch to track API calls without proxyquire
const originalFetch = global.fetch;

describe("QuestionsDrawer", () => {
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
      },
      {
        id: "q2",
        question_text: "Who is the contact for emergency blood? Department: ER",
        status: "open",
        asked_by_role: "Clinical Orientee RN",
        answers: [],
      },
      {
        id: "q3",
        question_text: "Verified question here Department: CVOR",
        status: "verified",
        asked_by_role: "Clinical Orientee RN",
        answers: [],
      }
    ];
    onRefreshQuestions = mock.fn(() => Promise.resolve());

    fetchMock = mock.fn(async (url: any, options: any) => {
      return {
        ok: true,
        json: async () => ({})
      };
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    mock.restoreAll();
  });

  it("should not render when isOpen is false", () => {
    const { container } = render(
      <QuestionsDrawer
        isOpen={false}
        onClose={() => {}}
        tenantId={tenantId}
        questions={mockQuestions}
        onRefreshQuestions={onRefreshQuestions}
      />
    );
    assert.strictEqual(container.firstChild, null);
  });

  it("should render questions when isOpen is true", () => {
    render(
      <QuestionsDrawer
        isOpen={true}
        onClose={() => {}}
        tenantId={tenantId}
        questions={mockQuestions}
        onRefreshQuestions={onRefreshQuestions}
      />
    );
    assert.ok(screen.getByText("Where are the 5-0 prolene sutures? Department: CVOR"));
    assert.ok(screen.getByText("Who is the contact for emergency blood? Department: ER"));
    assert.ok(screen.getByText("Verified question here Department: CVOR"));
  });

  it("should filter questions by department (using search term)", async () => {
    render(
      <QuestionsDrawer
        isOpen={true}
        onClose={() => {}}
        tenantId={tenantId}
        questions={mockQuestions}
        onRefreshQuestions={onRefreshQuestions}
      />
    );

    const searchInput = screen.getByPlaceholderText("Search questions or surgeon tags...");
    await userEvent.type(searchInput, "CVOR");

    assert.ok(screen.getByText("Where are the 5-0 prolene sutures? Department: CVOR"));
    assert.strictEqual(screen.queryByText("Who is the contact for emergency blood? Department: ER"), null);
    assert.ok(screen.getByText("Verified question here Department: CVOR"));
  });

  it("should filter questions by search term", async () => {
    render(
      <QuestionsDrawer
        isOpen={true}
        onClose={() => {}}
        tenantId={tenantId}
        questions={mockQuestions}
        onRefreshQuestions={onRefreshQuestions}
      />
    );

    const searchInput = screen.getByPlaceholderText("Search questions or surgeon tags...");
    await userEvent.type(searchInput, "blood");

    assert.strictEqual(screen.queryByText("Where are the 5-0 prolene sutures? Department: CVOR"), null);
    assert.ok(screen.getByText("Who is the contact for emergency blood? Department: ER"));
    assert.strictEqual(screen.queryByText("Verified question here Department: CVOR"), null);
  });

  it("should filter by 'Show only unanswered'", async () => {
    render(
      <QuestionsDrawer
        isOpen={true}
        onClose={() => {}}
        tenantId={tenantId}
        questions={mockQuestions}
        onRefreshQuestions={onRefreshQuestions}
      />
    );

    const filterCheckbox = screen.getByLabelText("Show only unanswered");
    await userEvent.click(filterCheckbox);

    assert.ok(screen.getByText("Where are the 5-0 prolene sutures? Department: CVOR"));
    assert.ok(screen.getByText("Who is the contact for emergency blood? Department: ER"));
    assert.strictEqual(screen.queryByText("Verified question here Department: CVOR"), null);
  });

  it("should type answer and dispatch answer submission", async () => {
    render(
      <QuestionsDrawer
        isOpen={true}
        onClose={() => {}}
        tenantId={tenantId}
        questions={mockQuestions}
        onRefreshQuestions={onRefreshQuestions}
      />
    );

    const draftInputs = screen.getAllByPlaceholderText("Write a peer answer for the orientee...");
    assert.strictEqual(draftInputs.length, 2); // q1 and q2 are open, q3 is verified

    // Type into the first draft input (for q1)
    await userEvent.type(draftInputs[0], "Top shelf on the right");

    // Get the confident button for the first question
    const confidentButtons = screen.getAllByText("Confident");
    assert.strictEqual(confidentButtons.length, 2);

    // Click the confident button
    await userEvent.click(confidentButtons[0]);

    await waitFor(() => {
        // Find the fetch call made to the answer endpoint
        const fetchCalls = fetchMock.mock.calls;
        let answerCall = null;
        for (const call of fetchCalls) {
            const url = call.arguments[0];
            if (typeof url === 'string' && url.includes('/api/questions/q1/answer')) {
                answerCall = call;
                break;
            }
        }

        assert.ok(answerCall, "Fetch to answer endpoint was not called");

        const options = answerCall.arguments[1];
        const body = JSON.parse(options.body);

        assert.strictEqual(body.tenant_id, tenantId);
        assert.strictEqual(body.answer_text, "Top shelf on the right");
        assert.strictEqual(body.confidence, "confident");
        assert.strictEqual(body.responder_role, "CVOR Peer RN");

        assert.strictEqual(onRefreshQuestions.mock.calls.length, 1);
    });
  });
});
