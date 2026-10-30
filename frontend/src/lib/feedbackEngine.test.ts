import 'fake-indexeddb/auto';
import { test } from "node:test";
import assert from "node:assert";
import { JSDOM } from 'jsdom';

// Setup JSDOM
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost'
});
global.window = dom.window as any;
global.document = dom.window.document as any;
global.navigator = dom.window.navigator as any;

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem(key: string) {
      return store[key] || null;
    },
    setItem(key: string, value: string) {
      store[key] = value.toString();
    },
    clear() {
      store = {};
    },
    removeItem(key: string) {
      delete store[key];
    }
  };
})();
global.localStorage = localStorageMock as any;
global.window.localStorage = localStorageMock as any;
global.window.dispatchEvent = () => true;

import {
  interceptChatComplaint,
  submitManualFeedback,
  upvoteFeedback,
  updateFeedbackStatus,
  FEEDBACK_OFFLINE_QUEUE_KEY,
  getOfflineQueue,
  FEEDBACK_STORAGE_KEY,
  getLocalFeedback,
  drainFeedbackQueue,
  classifyText
} from "./feedbackEngine";

test("FeedbackEngine - Offline Queueing and Storage Persistence", async (t) => {
  // Clear storage
  localStorage.clear();

  // Mock fetch to simulate offline state by throwing an error
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };

  Object.defineProperty(navigator, 'onLine', {
    value: true, // We keep it true so it enqueues but fetch fails
    configurable: true
  });

  await t.test("interceptChatComplaint appends to offline queue on network error", async () => {
    localStorage.clear();
    const result = await interceptChatComplaint("This stupid thing keeps crashing and it is terrible.");

    assert.ok(result);
    assert.strictEqual(result.sentimentScore, -0.6, "Sentiment should be heavily negative");

    const localQueue = getOfflineQueue();
    assert.strictEqual(localQueue.length, 1);
    assert.strictEqual(localQueue[0].type, "CREATE");
    assert.strictEqual(localQueue[0].payload.id, result.id);
  });

  await t.test("submitManualFeedback appends to offline queue on network error", async () => {
    localStorage.clear();
    const result = await submitManualFeedback({ rawText: "I love this new feature!" });

    assert.ok(result);
    assert.strictEqual(result.sentimentScore, 0.3, "Sentiment should be positive");

    const localQueue = getOfflineQueue();
    assert.strictEqual(localQueue.length, 1);
    assert.strictEqual(localQueue[0].type, "CREATE");
    assert.strictEqual(localQueue[0].payload.id, result.id);
  });

  await t.test("upvoteFeedback appends to offline queue on network error", async () => {
    localStorage.clear();
    // Pre-seed an item
    const mockItem = await submitManualFeedback({ rawText: "Test feedback for upvote" });
    // This will create a CREATE queue item, let's clear the queue first
    localStorage.setItem(FEEDBACK_OFFLINE_QUEUE_KEY, "[]");

    const upvoted = await upvoteFeedback(mockItem.id);
    assert.ok(upvoted);
    assert.strictEqual(upvoted.upvotes, 2); // 1 initial + 1 upvote

    const localQueue = getOfflineQueue();
    assert.strictEqual(localQueue.length, 1);
    assert.strictEqual(localQueue[0].type, "UPVOTE");
    assert.ok(localQueue[0].endpoint.includes(mockItem.id));
  });

  await t.test("updateFeedbackStatus appends to offline queue on network error", async () => {
    localStorage.clear();
    const mockItem = await submitManualFeedback({ rawText: "Test feedback for status" });
    localStorage.setItem(FEEDBACK_OFFLINE_QUEUE_KEY, "[]");

    const updated = await updateFeedbackStatus(mockItem.id, "resolved");
    assert.ok(updated);
    assert.strictEqual(updated.status, "resolved");

    const localQueue = getOfflineQueue();
    assert.strictEqual(localQueue.length, 1);
    assert.strictEqual(localQueue[0].type, "UPDATE_STATUS");
    assert.strictEqual(localQueue[0].payload.status, "resolved");
  });

  // Restore fetch
  global.fetch = originalFetch;
});

test("FeedbackEngine - Retry with Exponential Backoff", async (t) => {
  localStorage.clear();

  const mockItem = await submitManualFeedback({ rawText: "Backoff test" });
  // clear initial queue
  localStorage.setItem(FEEDBACK_OFFLINE_QUEUE_KEY, "[]");

  let fetchAttempts = 0;
  global.fetch = async () => {
    fetchAttempts++;
    throw new TypeError("Failed to fetch");
  };

  Object.defineProperty(navigator, 'onLine', {
    value: true,
    configurable: true
  });

  const endpoint = "/api/feedback/" + mockItem.id + "/upvote";
  await upvoteFeedback(mockItem.id); // This queues an item (attempt 0 handled implicitly in enqueue)

  const queue1 = getOfflineQueue();
  assert.strictEqual(queue1.length, 1);
  assert.strictEqual(queue1[0].retryCount, 0);

  // Call drain - this should fail, bumping retryCount to 1 and setting lastAttempt
  await drainFeedbackQueue();
  const queue2 = getOfflineQueue();
  assert.strictEqual(queue2[0].retryCount, 1);
  const lastAttempt1 = queue2[0].lastAttempt!;

  // Call drain immediately again - should be skipped due to backoff (2^1 * 1000ms = 2000ms)
  let fetchAttemptsBeforeSkip = fetchAttempts;
  await drainFeedbackQueue();
  const queue3 = getOfflineQueue();
  assert.strictEqual(queue3[0].retryCount, 1, "Should not retry yet due to backoff");
  assert.strictEqual(fetchAttempts, fetchAttemptsBeforeSkip, "Fetch should not have been called");

  // Fake time travel by modifying lastAttempt
  queue3[0].lastAttempt = Date.now() - 3000;
  localStorage.setItem(FEEDBACK_OFFLINE_QUEUE_KEY, JSON.stringify(queue3));

  // Call drain - this should now run and fail again, bumping retryCount to 2
  await drainFeedbackQueue();
  const queue4 = getOfflineQueue();
  assert.strictEqual(queue4[0].retryCount, 2);

  // Fake time travel and successful fetch
  queue4[0].lastAttempt = Date.now() - 5000; // 2^2 * 1000 = 4000ms backoff
  localStorage.setItem(FEEDBACK_OFFLINE_QUEUE_KEY, JSON.stringify(queue4));

  global.fetch = async () => {
    return { ok: true, status: 200 } as any;
  };

  await drainFeedbackQueue();
  const queue5 = getOfflineQueue();
  assert.strictEqual(queue5.length, 0, "Queue should be empty after successful sync");
});

test("FeedbackEngine - Sentiment Scoring edge cases", async (t) => {
  assert.strictEqual(classifyText("Love this great app!").sentimentScore, 0.6);
  assert.strictEqual(classifyText("This is broken and I hate it").sentimentScore, -0.6);

  // Clamping check (-1 to 1)
  const superNegative = "broken hate frustrating awful terrible worst crash";
  assert.strictEqual(classifyText(superNegative).sentimentScore, -1);

  const superPositive = "love great awesome perfect good nice helpful thanks";
  assert.strictEqual(classifyText(superPositive).sentimentScore, 1);
});
