import 'jsdom-global/register.js';
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

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
