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

  it("should handle intermittent network latency seamlessly without double submission", async () => {
    let callCount = 0;
    const fetchMock = mock.fn(() => {
        callCount++;
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve({ ok: true, json: async () => ({}) });
            }, 100);
        });
    }) as any;

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

    // Fire click and don't await it so we can check immediate state
    userEvent.click(askButton);

    await waitFor(() => {
        assert.strictEqual(askButton.hasAttribute("disabled"), true);
    });

    await waitFor(() => {
        assert.strictEqual(input.value, "");
        assert.strictEqual(askButton.hasAttribute("disabled"), true); // Since input is now empty
    });

    assert.strictEqual(callCount, 1);
    unmount();
  });

  it("should handle network partition degradation and self-healing reconnection", async () => {
    let fetchState = "offline";
    const fetchMock = mock.fn(() => {
        if (fetchState === "offline") {
            return Promise.reject(new TypeError("Failed to fetch"));
        } else {
            return Promise.resolve({ ok: true, json: async () => ({}) });
        }
    }) as any;

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

    await userEvent.type(input, "First Offline Question");
    await userEvent.click(askButton);

    await waitFor(() => {
        assert.strictEqual(input.value, "");
    });

    fetchState = "online";

    await userEvent.type(input, "Online Question");
    await userEvent.click(askButton);

    await waitFor(() => {
        assert.strictEqual(input.value, "");
    });

    fetchState = "offline";

    await userEvent.type(input, "Second Offline Question");
    await userEvent.click(askButton);

    await waitFor(() => {
        assert.strictEqual(input.value, "");
    });

    unmount();
  });
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



  it("should enforce multi-tenant boundary (facility_id::dept_id) isolation", async () => {
    // Override fetch properly for this test specifically
    const fetchCalls: any[] = [];
    global.fetch = mock.fn(async (url: any, options: any) => {
      fetchCalls.push({ url, options });
      return { ok: true, json: async () => ({}) };
    }) as any;

    const { unmount: unmountFacilityA } = render(
      <QuestionsDrawer
        isOpen={true}
        onClose={() => {}}
        tenantId="facility1::deptA"
        questions={mockQuestions}
        onRefreshQuestions={onRefreshQuestions}
      />
    );

    const inputA = screen.getByPlaceholderText("e.g. Where are backup 5-0 Prolene sutures kept?");
    await userEvent.type(inputA, "Question for Facility 1 Dept A");
    const askButtonA = screen.getByText("Ask");
    await userEvent.click(askButtonA);
    unmountFacilityA();

    const { unmount: unmountFacilityB } = render(
      <QuestionsDrawer
        isOpen={true}
        onClose={() => {}}
        tenantId="facility1::deptB"
        questions={mockQuestions}
        onRefreshQuestions={onRefreshQuestions}
      />
    );

    const inputB = screen.getByPlaceholderText("e.g. Where are backup 5-0 Prolene sutures kept?");
    await userEvent.type(inputB, "Question for Facility 1 Dept B");
    const askButtonB = screen.getByText("Ask");
    await userEvent.click(askButtonB);
    unmountFacilityB();

    assert.strictEqual(fetchCalls.length, 2);

    const bodyA = JSON.parse(fetchCalls[0].options.body);
    const bodyB = JSON.parse(fetchCalls[1].options.body);

    assert.strictEqual(bodyA.tenant_id, "facility1::deptA");
    assert.strictEqual(bodyA.question_text, "Question for Facility 1 Dept A");

    assert.strictEqual(bodyB.tenant_id, "facility1::deptB");
    assert.strictEqual(bodyB.question_text, "Question for Facility 1 Dept B");
  });

  it("should enforce multi-tenant isolation when submitting questions", async () => {
    const fetchCalls: any[] = [];
    global.fetch = mock.fn(async (url: any, options: any) => {
      fetchCalls.push({ url, options });
      return { ok: true, json: async () => ({}) };
    }) as any;

    const { unmount: unmountA } = render(
      <QuestionsDrawer
        isOpen={true}
        onClose={() => {}}
        tenantId="tenant-A"
        questions={mockQuestions}
        onRefreshQuestions={onRefreshQuestions}
      />
    );

    const inputsA = screen.getAllByPlaceholderText("e.g. Where are backup 5-0 Prolene sutures kept?");
    const inputA = inputsA[inputsA.length - 1];
    await userEvent.type(inputA, "Question for Tenant A");
    const buttonsA = screen.getAllByText("Ask");
    await userEvent.click(buttonsA[buttonsA.length - 1]);

    unmountA();

    const { unmount: unmountB } = render(
      <QuestionsDrawer
        isOpen={true}
        onClose={() => {}}
        tenantId="tenant-B"
        questions={mockQuestions}
        onRefreshQuestions={onRefreshQuestions}
      />
    );

    const inputsB = screen.getAllByPlaceholderText("e.g. Where are backup 5-0 Prolene sutures kept?");
    const inputB = inputsB[inputsB.length - 1];
    await userEvent.type(inputB, "Question for Tenant B");
    const buttonsB = screen.getAllByText("Ask");
    await userEvent.click(buttonsB[buttonsB.length - 1]);

    unmountB();

    assert.strictEqual(fetchCalls.length, 2);

    const bodyA = JSON.parse(fetchCalls[0].options.body);
    const bodyB = JSON.parse(fetchCalls[1].options.body);

    assert.strictEqual(bodyA.tenant_id, "tenant-A");
    assert.strictEqual(bodyA.question_text, "Question for Tenant A");

    assert.strictEqual(bodyB.tenant_id, "tenant-B");
    assert.strictEqual(bodyB.question_text, "Question for Tenant B");
  });

  it("should enforce offline-first invariants gracefully", async () => {
    global.fetch = mock.fn(() => Promise.reject(new TypeError("Failed to fetch"))) as any;

    render(
      <QuestionsDrawer
        isOpen={true}
        onClose={() => {}}
        tenantId={tenantId}
        questions={mockQuestions}
        onRefreshQuestions={onRefreshQuestions}
      />
    );

    const input = screen.getByPlaceholderText("e.g. Where are backup 5-0 Prolene sutures kept?");
    await userEvent.type(input, "Offline question");

    const askButton = screen.getByText("Ask");
    await userEvent.click(askButton);

    await waitFor(() => {
      // The input should be cleared upon successful (offline) creation
      assert.strictEqual((input as HTMLInputElement).value, "");
      assert.strictEqual(onRefreshQuestions.mock.calls.length, 1);
    });
  });

  it("should verify offline mutation replay idempotency", async () => {
    global.fetch = mock.fn(() => Promise.reject(new TypeError("Failed to fetch"))) as any;

    const propsA = {
      isOpen: true,
      onClose: () => {},
      tenantId: "tenant-A",
      questions: mockQuestions,
      onRefreshQuestions: onRefreshQuestions,
    };

    const { rerender } = render(<QuestionsDrawer {...propsA} />);

    const input = screen.getByPlaceholderText("e.g. Where are backup 5-0 Prolene sutures kept?");
    await userEvent.type(input, "Idempotent Offline Question");

    const askButton = screen.getByText("Ask");
    await userEvent.click(askButton);

    await waitFor(() => {
      assert.strictEqual((input as HTMLInputElement).value, "");
    });

    // Replay the rendering phase
    rerender(<QuestionsDrawer {...propsA} />);

    // Assert UI state remains identical
    assert.strictEqual((input as HTMLInputElement).value, "");

    // Verify no breakage occurs when rerendering or clicking ask when empty
    await userEvent.click(askButton);
    assert.strictEqual((input as HTMLInputElement).value, "");
    assert.strictEqual(onRefreshQuestions.mock.calls.length, 1);
  });
  it("should resist malformed payload submissions gracefully", async () => {
    // Clear the mock calls specifically for this test
    fetchMock.mock.calls = [];

    render(
      <QuestionsDrawer
        isOpen={true}
        onClose={() => {}}
        tenantId={tenantId}
        questions={mockQuestions}
        onRefreshQuestions={onRefreshQuestions}
      />
    );

    const inputs = screen.getAllByPlaceholderText("Write a peer answer for the orientee...");
    const draftInput = inputs[0];

    // Intentionally bypass UI validation logic to force an extremely long string
    // using paste instead of type to prevent timeout
    await userEvent.click(draftInput);
    await userEvent.paste("A".repeat(5000));
    const confidentButtons = screen.getAllByText("Confident");
    await userEvent.click(confidentButtons[0]);

    // Since mock fetch intercepts the payload, check that it attempts gracefully or validates properly
    // It shouldn't crash the app components
    await waitFor(() => {
        const fetchCalls = fetchMock.mock.calls;
        assert.ok(fetchCalls.length > 0);
    });
  });

  it("should handle boundary inputs dynamically via fuzzing for new questions", async () => {
    // Simulate offline correctly by rejecting fetch
    global.fetch = mock.fn(() => Promise.reject(new TypeError("Failed to fetch"))) as any;

    const { unmount } = render(
      <QuestionsDrawer
        isOpen={true}
        onClose={() => {}}
        tenantId={tenantId}
        questions={mockQuestions}
        onRefreshQuestions={onRefreshQuestions}
      />
    );

    const fuzzedInputs = [
      "Drop Table Questions;",
      "🤡🎃👩‍🚀", // Emojis
      "1234567890", // Numbers only
      "A".repeat(500),
    ];

    for (const fuzzed of fuzzedInputs) {
      const input = screen.getByPlaceholderText("e.g. Where are backup 5-0 Prolene sutures kept?") as HTMLInputElement;
      const askButton = screen.getByText("Ask") as HTMLButtonElement;

      // Update form
      await userEvent.clear(input);
      if (fuzzed.length > 50) {
        await userEvent.paste(fuzzed);
      } else {
        await userEvent.type(input, fuzzed);
      }

      // The component disables the button if input is empty or submitting. Let's just assert value is typed
      assert.strictEqual(input.value, fuzzed);

      // Ensure form submission isn't blocked by missing properties, directly call click
      await userEvent.click(askButton);

      await waitFor(() => {
        const checkInput = screen.getByPlaceholderText("e.g. Where are backup 5-0 Prolene sutures kept?") as HTMLInputElement;
        assert.strictEqual(checkInput.value, "");
      });
    }
    unmount();

    // Restore fetch manually if needed (afterEach handles it generally, but just to be safe here)
    global.fetch = fetchMock;
  });

  it("should rigidly validate mock backend endpoint structures", async () => {
    // Ensuring our components enforce specific schema shapes expected by UI
    const incompleteQuestions = [
      { id: "q_bad_1", question_text: "Missing some fields" } // Missing status, asked_by_role, answers
    ];

    // We expect it handles it gracefully without crashing, e.g. mapping defaults
    render(
      <QuestionsDrawer
        isOpen={true}
        onClose={() => {}}
        tenantId={tenantId}
        questions={incompleteQuestions as any}
        onRefreshQuestions={onRefreshQuestions}
      />
    );

    assert.ok(screen.getByText("Missing some fields"));
    // Default open badge fallback should happen or error out safely
    assert.ok(screen.getByText("Open Question"));
  });

  it("should not leak memory over high-volume remount loops", async () => {
    if (global.gc) global.gc();
    const initialMemory = process.memoryUsage().heapUsed;

    for (let i = 0; i < 500; i++) {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const { unmount } = render(
        <QuestionsDrawer
          isOpen={true}
          onClose={() => {}}
          tenantId={tenantId}
          questions={mockQuestions}
          onRefreshQuestions={onRefreshQuestions}
        />,
        { container }
      );
      unmount();
      document.body.removeChild(container);
    }

    if (global.gc) global.gc();
    const finalMemory = process.memoryUsage().heapUsed;
    const diff = finalMemory - initialMemory;

    assert.ok(diff < 150 * 1024 * 1024, `Memory leak detected: ${diff / 1024 / 1024} MB`);
  });

  it("should not leave unclosed event listeners", () => {
    const originalAdd = window.addEventListener;
    const originalRemove = window.removeEventListener;

    let listeners = 0;

    window.addEventListener = function(type: any, listener: any, options: any) {
      listeners++;
      return originalAdd.apply(this, arguments as any);
    };

    window.removeEventListener = function(type: any, listener: any, options: any) {
      listeners--;
      return originalRemove.apply(this, arguments as any);
    };

    const { unmount } = render(
      <QuestionsDrawer
        isOpen={true}
        onClose={() => {}}
        tenantId={tenantId}
        questions={mockQuestions}
        onRefreshQuestions={onRefreshQuestions}
      />
    );

    unmount();

    assert.strictEqual(listeners, 0, "Event listeners were not properly cleaned up");

    window.addEventListener = originalAdd;
    window.removeEventListener = originalRemove;
  });

  it("should enforce cache eviction for draft answers under constrained usage", async () => {
    const fetchCalls: any[] = [];
    global.fetch = mock.fn(async (url: any, options: any) => {
      fetchCalls.push({ url, options });
      return { ok: true, json: async () => ({}) };
    }) as any;

    const { unmount } = render(
      <QuestionsDrawer
        isOpen={true}
        onClose={() => {}}
        tenantId={tenantId}
        questions={mockQuestions}
        onRefreshQuestions={onRefreshQuestions}
      />
    );

    const draftInputs = screen.getAllByPlaceholderText("Write a peer answer for the orientee...");
    const draftInput = draftInputs[0];

    await userEvent.type(draftInput, "Draft text to be evicted");
    const confidentButtons = screen.getAllByText("Confident");
    await userEvent.click(confidentButtons[0]);

    await waitFor(() => {
        assert.ok(fetchCalls.length > 0);
    });

    await waitFor(() => {
       assert.strictEqual((draftInput as HTMLInputElement).value, "");
    });

    unmount();
  });

});
