import 'jsdom-global/register.js';
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const proxyquire = require('proxyquire');

const dummyProfile = {
  id: 'u1',
  fullName: 'Test Nurse',
  clinicalRole: 'Circulating RN',
  facilityId: 'facility-1',
  departmentId: 'dept-1'
};

const FeedbackModalMod = proxyquire('./FeedbackModal', {
    '@/lib/gamification': {
        awardClinicalXP: mock.fn()
    },
    '@/lib/auth': {
        isAdminUser: mock.fn(() => true), // Mock as admin to see all tabs
        getCurrentSession: mock.fn(() => null)
    },
    '@/lib/feedbackEngine': {
        submitManualFeedback: mock.fn(async () => ({
            id: 'fb-123',
            tenantId: 'facility-1::dept-1',
            userName: 'Test Nurse',
            userRole: 'Circulating RN',
            source: 'manual_submission',
            category: 'bug_friction',
            severity: 'medium',
            rawText: 'Test issue',
            aiRecommendation: 'Fix issue',
            suggestedFixPrompt: 'Fix this bug',
            upvotes: 1,
            status: 'open',
            createdAt: new Date().toISOString(),
        })),
        fetchFeedbackItems: mock.fn(async () => [
            {
                id: 'fb-123',
                tenantId: 'facility-1::dept-1',
                userName: 'Test Nurse',
                userRole: 'Circulating RN',
                source: 'manual_submission',
                category: 'bug_friction',
                severity: 'medium',
                rawText: 'Test issue',
                aiRecommendation: 'Fix issue',
                suggestedFixPrompt: 'Fix this bug',
                upvotes: 1,
                status: 'open',
                createdAt: new Date().toISOString(),
            }
        ]),
        upvoteFeedback: mock.fn(),
        updateFeedbackStatus: mock.fn(),
        FEEDBACK_EVENT_NAME: 'feedback_updated'
    }
});

const FeedbackModal = FeedbackModalMod.FeedbackModal;

beforeEach(() => {
    // reset mocks if needed
});

afterEach(() => {
  cleanup();
  mock.reset();
});

test('opens modal and allows selecting feedback type', async () => {
    const onCloseMock = mock.fn();
    render(<FeedbackModal isOpen={true} onClose={onCloseMock} userProfile={dummyProfile} />);

    // Check if modal is rendered
    assert.ok(screen.getByTestId('feedback-modal'));

    // Check categories
    const bugBtn = screen.getByText('🐛 Bug');
    const featureBtn = screen.getByText('✨ Feature');
    const dataBtn = screen.getByText('📦 Data');

    assert.ok(bugBtn);
    assert.ok(featureBtn);
    assert.ok(dataBtn);

    // Select Bug
    fireEvent.click(bugBtn);
    assert.ok(bugBtn.className.includes('bg-indigo-500/10'));
});

test('submits payload successfully', async () => {
    const onCloseMock = mock.fn();
    render(<FeedbackModal isOpen={true} onClose={onCloseMock} userProfile={dummyProfile} />);

    // Type text
    const textarea = screen.getByTestId('feedback-input-text');
    fireEvent.change(textarea, { target: { value: 'This is a test bug' } });

    // Submit
    const submitBtn = screen.getByTestId('btn-submit-feedback');
    fireEvent.click(submitBtn);

    // Success banner
    await waitFor(() => {
        assert.ok(screen.getByTestId('feedback-success-banner'));
    });
});

test('closes on backdrop click', async () => {
    const onCloseMock = mock.fn();
    render(<FeedbackModal isOpen={true} onClose={onCloseMock} userProfile={dummyProfile} />);

    const backdrop = screen.getByTestId('feedback-modal');
    fireEvent.click(backdrop);

    assert.strictEqual(onCloseMock.mock.callCount(), 1);
});

test('triage interactions for admin', async () => {
    const onCloseMock = mock.fn();
    render(<FeedbackModal isOpen={true} onClose={onCloseMock} userProfile={dummyProfile} />);

    // As an admin, triage hub is visible and fetchFeedbackItems should be called.
    // Wait for reloadFeedback to complete.
    await waitFor(() => {
        assert.ok(screen.getByTestId('tab-recommendations-hub'));
    });

    const triageTab = screen.getByTestId('tab-recommendations-hub');
    fireEvent.click(triageTab);

    await waitFor(() => {
        assert.ok(screen.getByTestId('recommendations-hub'));
        assert.ok(screen.getByText('"Test issue"'));
    });

    // Test interactions (like resolve)
    const resolveBtn = screen.getByTestId('btn-resolve-feedback');
    assert.ok(resolveBtn);
    fireEvent.click(resolveBtn);
});

test('star rating selection updates rating state', async () => {
    const onCloseMock = mock.fn();
    render(<FeedbackModal isOpen={true} onClose={onCloseMock} userProfile={dummyProfile} />);

    // Check if stars are rendered
    const stars = screen.getAllByRole('button', { name: /Rate \d stars/ });
    assert.strictEqual(stars.length, 5);

    // Initial state: no stars selected (all text-slate-700)
    for (const star of stars) {
        assert.ok(star.className.includes('text-slate-700'));
    }

    // Click 3rd star
    fireEvent.click(stars[2]); // Index 2 is 'Rate 3 stars'

    // First 3 stars should be selected (text-amber-400), last 2 should not
    assert.ok(stars[0].className.includes('text-amber-400'));
    assert.ok(stars[1].className.includes('text-amber-400'));
    assert.ok(stars[2].className.includes('text-amber-400'));
    assert.ok(stars[3].className.includes('text-slate-700'));
    assert.ok(stars[4].className.includes('text-slate-700'));
});

test('comment limits enforces maximum character length and displays counter', async () => {
    const onCloseMock = mock.fn();
    render(<FeedbackModal isOpen={true} onClose={onCloseMock} userProfile={dummyProfile} />);

    const textarea = screen.getByTestId('feedback-input-text');

    // Check initial counter display
    assert.ok(screen.getByText('0/500'));

    // Input 10 chars
    fireEvent.change(textarea, { target: { value: '1234567890' } });
    assert.ok(screen.getByText('10/500'));

    // Attempt to input more than 500 chars (it should slice to 500)
    const longString = 'A'.repeat(510);
    fireEvent.change(textarea, { target: { value: longString } });

    // Note: React Testing Library fireEvent.change bypasses standard maxLength behavior and sets the value directly.
    // However, our component handles the onChange event by slicing to 500 chars.
    assert.strictEqual((textarea as HTMLTextAreaElement).value.length, 500);
    assert.ok(screen.getByText('500/500'));
    // Counter should have error color applied (text-rose-400)
    assert.ok(screen.getByText('500/500').className.includes('text-rose-400'));
});

test('offline queueing shows specific success message', async () => {
    // Mock navigator.onLine to be false
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true
    });

    const onCloseMock = mock.fn();
    render(<FeedbackModal isOpen={true} onClose={onCloseMock} userProfile={dummyProfile} />);

    // Trigger offline event to update internal state if needed
    window.dispatchEvent(new Event('offline'));

    // Type text and submit
    const textarea = screen.getByTestId('feedback-input-text');
    fireEvent.change(textarea, { target: { value: 'Test offline bug' } });
    const submitBtn = screen.getByTestId('btn-submit-feedback');
    fireEvent.click(submitBtn);

    // Success banner should appear with offline message
    await waitFor(() => {
        assert.ok(screen.getByTestId('feedback-success-banner'));
        assert.ok(screen.getByText('Saved offline. Will sync when connected.'));
    });

    // Restore navigator.onLine
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true
    });
});

test('renders error banner when submission throws an exception', async () => {
    // Re-proxyquire with throwing mock for this specific test
    const ErrorFeedbackModalMod = proxyquire('./FeedbackModal', {
        '@/lib/gamification': {
            awardClinicalXP: mock.fn()
        },
        '@/lib/auth': {
            isAdminUser: mock.fn(() => true),
            getCurrentSession: mock.fn(() => null)
        },
        '@/lib/feedbackEngine': {
            submitManualFeedback: mock.fn(async () => {
                throw new Error('Network error');
            }),
            fetchFeedbackItems: mock.fn(async () => []),
            upvoteFeedback: mock.fn(),
            updateFeedbackStatus: mock.fn(),
            FEEDBACK_EVENT_NAME: 'feedback_updated'
        }
    });

    const ErrorFeedbackModal = ErrorFeedbackModalMod.FeedbackModal;

    const onCloseMock = mock.fn();
    render(<ErrorFeedbackModal isOpen={true} onClose={onCloseMock} userProfile={dummyProfile} />);

    // Type text and submit
    const textarea = screen.getByTestId('feedback-input-text');
    fireEvent.change(textarea, { target: { value: 'Test error bug' } });
    const submitBtn = screen.getByTestId('btn-submit-feedback');
    fireEvent.click(submitBtn);

    // Error banner should appear
    await waitFor(() => {
        assert.ok(screen.getByTestId('feedback-error-banner'));
        assert.ok(screen.getByText('❌ Failed to submit feedback. Please try again.'));
    });
});
test('multi-tenant isolation invariant: fetchFeedbackItems called with correct tenantId', async () => {
    const onCloseMock = mock.fn();
    const fetchFeedbackItemsMock = mock.fn(async () => []);

    const IsolatedFeedbackModalMod = proxyquire('./FeedbackModal', {
        '@/lib/gamification': {
            awardClinicalXP: mock.fn()
        },
        '@/lib/auth': {
            isAdminUser: mock.fn(() => true), // Mock as admin
            getCurrentSession: mock.fn(() => null)
        },
        '@/lib/feedbackEngine': {
            submitManualFeedback: mock.fn(),
            fetchFeedbackItems: fetchFeedbackItemsMock,
            upvoteFeedback: mock.fn(),
            updateFeedbackStatus: mock.fn(),
            FEEDBACK_EVENT_NAME: 'feedback_updated'
        }
    });

    const IsolatedFeedbackModal = IsolatedFeedbackModalMod.FeedbackModal;
    render(<IsolatedFeedbackModal isOpen={true} onClose={onCloseMock} userProfile={dummyProfile} />);

    await waitFor(() => {
        assert.ok(screen.getByTestId('tab-recommendations-hub'));
    });

    const triageTab = screen.getByTestId('tab-recommendations-hub');
    fireEvent.click(triageTab);

    await waitFor(() => {
        const calls = fetchFeedbackItemsMock.mock.calls;
        assert.ok(calls.length > 0, 'fetchFeedbackItems should have been called');

        let found = false;
        for (const call of calls) {
            if (call.arguments[0] && call.arguments[0].tenantId === 'facility-1::dept-1') {
                found = true;
                break;
            }
        }
        assert.ok(found, 'fetchFeedbackItems was not called with the correct tenantId.');
    });
});

test('offline-first invariant: handles fetch rejection gracefully and displays offline message', async () => {
    const onCloseMock = mock.fn();

    const originalFetch = global.fetch;
    global.fetch = mock.fn(async () => { throw new Error('Network offline'); }) as any;

    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true
    });

    render(<FeedbackModal isOpen={true} onClose={onCloseMock} userProfile={dummyProfile} />);

    window.dispatchEvent(new Event('offline'));

    const textarea = screen.getByTestId('feedback-input-text');
    fireEvent.change(textarea, { target: { value: 'Test offline first behavior' } });

    const submitBtn = screen.getByTestId('btn-submit-feedback');
    fireEvent.click(submitBtn);

    await waitFor(() => {
        assert.ok(screen.getByTestId('feedback-success-banner'));
        assert.ok(screen.getByText('Saved offline. Will sync when connected.'));
    });

    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true
    });
    global.fetch = originalFetch;
});

test('fuzzing boundary inputs: empty, large text, unicode, xss payloads', async () => {
    const onCloseMock = mock.fn();
    render(<FeedbackModal isOpen={true} onClose={onCloseMock} userProfile={dummyProfile} />);

    const textarea = screen.getByTestId('feedback-input-text');
    const submitBtn = screen.getByTestId('btn-submit-feedback');

    // 1. Empty Input
    fireEvent.change(textarea, { target: { value: '   ' } });
    assert.strictEqual((submitBtn as HTMLButtonElement).disabled, true);

    // 2. Fuzz with extreme characters
    const fuzzPayload = '💥\u0000\x00<script>alert(1)</script>😎👩‍👩‍👧‍👦';
    fireEvent.change(textarea, { target: { value: fuzzPayload } });
    assert.strictEqual((textarea as HTMLTextAreaElement).value, fuzzPayload);
    fireEvent.click(submitBtn);

    await waitFor(() => {
        assert.ok(screen.getByTestId('feedback-success-banner'));
    });
});

test('malformed payload resilience: handles missing userProfile fields gracefully', async () => {
    const onCloseMock = mock.fn();
    // Pass empty userProfile
    render(<FeedbackModal isOpen={true} onClose={onCloseMock} userProfile={{}} />);

    const textarea = screen.getByTestId('feedback-input-text');
    fireEvent.change(textarea, { target: { value: 'Valid input' } });

    const submitBtn = screen.getByTestId('btn-submit-feedback');
    fireEvent.click(submitBtn);

    await waitFor(() => {
        assert.ok(screen.getByTestId('feedback-success-banner'));
    });
});

test('tenant isolation fallback: missing facilityId and departmentId', async () => {
    const onCloseMock = mock.fn();
    const fetchFeedbackItemsMock = mock.fn(async () => []);

    const IsolatedFeedbackModalMod = proxyquire('./FeedbackModal', {
        '@/lib/gamification': {
            awardClinicalXP: mock.fn()
        },
        '@/lib/auth': {
            isAdminUser: mock.fn(() => true), // Admin to trigger fetch
            getCurrentSession: mock.fn(() => null)
        },
        '@/lib/feedbackEngine': {
            submitManualFeedback: mock.fn(),
            fetchFeedbackItems: fetchFeedbackItemsMock,
            upvoteFeedback: mock.fn(),
            updateFeedbackStatus: mock.fn(),
            FEEDBACK_EVENT_NAME: 'feedback_updated'
        }
    });

    const IsolatedFeedbackModal = IsolatedFeedbackModalMod.FeedbackModal;

    // Render with missing facility and dept
    render(<IsolatedFeedbackModal isOpen={true} onClose={onCloseMock} userProfile={{ fullName: 'Unknown' }} />);

    await waitFor(() => {
        assert.ok(screen.getByTestId('tab-recommendations-hub'));
    });

    const triageTab = screen.getByTestId('tab-recommendations-hub');
    fireEvent.click(triageTab);

    await waitFor(() => {
        const calls = fetchFeedbackItemsMock.mock.calls;
        assert.ok(calls.length > 0, 'fetchFeedbackItems should have been called');

        let found = false;
        for (const call of calls) {
            if (call.arguments[0] && call.arguments[0].tenantId === 'sacred_heart::or') {
                found = true;
                break;
            }
        }
        assert.ok(found, 'fetchFeedbackItems was not called with the correct fallback tenantId (sacred_heart::or).');
    });
});

test('schema validation: submits with expected types and boundary values', async () => {
    const onCloseMock = mock.fn();
    const submitManualFeedbackMock = mock.fn();

    const SchemaFeedbackModalMod = proxyquire('./FeedbackModal', {
        '@/lib/gamification': {
            awardClinicalXP: mock.fn()
        },
        '@/lib/auth': {
            isAdminUser: mock.fn(() => false),
            getCurrentSession: mock.fn(() => null)
        },
        '@/lib/feedbackEngine': {
            submitManualFeedback: submitManualFeedbackMock,
            fetchFeedbackItems: mock.fn(),
            upvoteFeedback: mock.fn(),
            updateFeedbackStatus: mock.fn(),
            FEEDBACK_EVENT_NAME: 'feedback_updated'
        }
    });

    const SchemaFeedbackModal = SchemaFeedbackModalMod.FeedbackModal;
    render(<SchemaFeedbackModal isOpen={true} onClose={onCloseMock} userProfile={dummyProfile} />);

    const textarea = screen.getByTestId('feedback-input-text');
    fireEvent.change(textarea, { target: { value: 'Test schema' } });

    // Check missing rating is undefined in payload, category defaults to feature_request
    const submitBtn = screen.getByTestId('btn-submit-feedback');
    fireEvent.click(submitBtn);

    await waitFor(() => {
        assert.strictEqual(submitManualFeedbackMock.mock.calls.length, 1);
        const payload = submitManualFeedbackMock.mock.calls[0].arguments[0];

        assert.strictEqual(payload.rawText, 'Test schema');
        assert.strictEqual(payload.category, 'feature_request');
        assert.strictEqual(payload.severity, 'low');
        assert.strictEqual(payload.rating, undefined);
        assert.deepStrictEqual(payload.userProfile, dummyProfile);
    });
});

test('concurrent burst execution: handles double clicks and prevents multiple submissions', async () => {
    const submitManualFeedbackMock = mock.fn(async () => {
        // Simulate network latency for race condition checks
        await new Promise(r => setTimeout(r, 50));
        return {
            id: 'fb-123',
            tenantId: 'facility-1::dept-1',
            userName: 'Test Nurse',
            userRole: 'Circulating RN',
            source: 'manual_submission',
            category: 'bug_friction',
            severity: 'medium',
            rawText: 'Test issue',
            aiRecommendation: 'Fix issue',
            suggestedFixPrompt: 'Fix this bug',
            upvotes: 1,
            status: 'open',
            createdAt: new Date().toISOString(),
        }
    });

    const FeedbackModalModLocal = proxyquire('./FeedbackModal', {
        '@/lib/gamification': { awardClinicalXP: mock.fn() },
        '@/lib/auth': { isAdminUser: mock.fn(() => true), getCurrentSession: mock.fn(() => null) },
        '@/lib/feedbackEngine': {
            submitManualFeedback: submitManualFeedbackMock,
            fetchFeedbackItems: mock.fn(async () => []),
            upvoteFeedback: mock.fn(),
            updateFeedbackStatus: mock.fn(),
            FEEDBACK_EVENT_NAME: 'feedback_updated'
        }
    });

    const LocalFeedbackModal = FeedbackModalModLocal.FeedbackModal;

    const onCloseMock = mock.fn();
    render(<LocalFeedbackModal isOpen={true} onClose={onCloseMock} userProfile={dummyProfile} />);

    const textarea = screen.getByTestId('feedback-input-text');
    fireEvent.change(textarea, { target: { value: 'Test double click' } });

    const submitBtn = screen.getByTestId('btn-submit-feedback');

    // Fire click multiple times concurrently
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    // Wait for the submission process to complete
    await waitFor(() => {
        assert.ok(screen.getByTestId('feedback-success-banner'));
    });

    assert.strictEqual(submitManualFeedbackMock.mock.calls.length, 1);
});

test('high latency resilience: displays loading state and processes event loop properly', async () => {
    const submitManualFeedbackMock = mock.fn(async () => {
        // Simulate high network latency
        await new Promise(r => setTimeout(r, 1000));
        return {
            id: 'fb-123',
            tenantId: 'facility-1::dept-1',
            userName: 'Test Nurse',
            userRole: 'Circulating RN',
            source: 'manual_submission',
            category: 'bug_friction',
            severity: 'medium',
            rawText: 'Test issue',
            aiRecommendation: 'Fix issue',
            suggestedFixPrompt: 'Fix this bug',
            upvotes: 1,
            status: 'open',
            createdAt: new Date().toISOString(),
        }
    });

    const FeedbackModalModLocal = proxyquire('./FeedbackModal', {
        '@/lib/gamification': { awardClinicalXP: mock.fn() },
        '@/lib/auth': { isAdminUser: mock.fn(() => true), getCurrentSession: mock.fn(() => null) },
        '@/lib/feedbackEngine': {
            submitManualFeedback: submitManualFeedbackMock,
            fetchFeedbackItems: mock.fn(async () => []),
            upvoteFeedback: mock.fn(),
            updateFeedbackStatus: mock.fn(),
            FEEDBACK_EVENT_NAME: 'feedback_updated'
        }
    });

    const LocalFeedbackModal = FeedbackModalModLocal.FeedbackModal;

    const onCloseMock = mock.fn();
    render(<LocalFeedbackModal isOpen={true} onClose={onCloseMock} userProfile={dummyProfile} />);

    const textarea = screen.getByTestId('feedback-input-text');
    fireEvent.change(textarea, { target: { value: 'High latency test' } });

    const submitBtn = screen.getByTestId('btn-submit-feedback');
    fireEvent.click(submitBtn);

    // Verify loading state immediately after click
    assert.ok(screen.getByText('Submitting...'));
    assert.strictEqual((submitBtn as HTMLButtonElement).disabled, true);

    // Wait for resolution
    await waitFor(() => {
        assert.ok(screen.getByTestId('feedback-success-banner'));
    }, { timeout: 2000 });
});
