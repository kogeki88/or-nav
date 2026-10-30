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
