import 'jsdom-global/register.js';
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// Setup IndexedDB mock for Dexie
/* eslint-disable @typescript-eslint/no-require-imports */
global.indexedDB = require('fake-indexeddb');
global.IDBKeyRange = require('fake-indexeddb/lib/FDBKeyRange');
const proxyquire = require('proxyquire');
/* eslint-enable @typescript-eslint/no-require-imports */

const dummyProfile = {
  id: 'u1',
  fullName: 'Test Nurse',
  clinicalRole: 'Circulating RN',
  specialty: 'Trauma',
  yearsExperience: 5
};

const PeerQnAPanelMod = proxyquire('./PeerQnAPanel', {
    '@/lib/gamification': {
        awardClinicalXP: mock.fn()
    },
    '@/lib/auth': {
        createTimeoutSignal: mock.fn(() => new AbortController().signal)
    }
});

const PeerQnAPanel = PeerQnAPanelMod.default;

beforeEach(() => {
  global.fetch = mock.fn(async () => ({
    ok: true,
    json: async () => ([])
  } as unknown as Response));
});

afterEach(() => {
  cleanup();
  mock.reset();
});

test('lists unanswered questions and respects department filtering', async () => {
    const questions = [
        {
            id: 'q1',
            tenantId: 'er_trauma',
            questionText: 'Where is the trauma cart?',
            askedBy: 'Dr. Smith',
            role: 'Attending',
            createdAt: new Date().toISOString(),
            answers: [],
            status: 'unverified',
            verificationsCount: 0
        },
        {
            id: 'q2',
            tenantId: 'er_trauma',
            questionText: 'What is the RSI protocol?',
            askedBy: 'Nurse Jones',
            role: 'Scrub Tech',
            createdAt: new Date().toISOString(),
            answers: [
                {
                    answerId: 'a1',
                    answeredBy: 'Senior Nurse',
                    answerText: 'Standard RSI protocol applies.',
                    verifiedBy: ['Dr. A', 'Dr. B'],
                    isVerifiedConsensus: true
                }
            ],
            status: 'verified',
            verificationsCount: 2
        }
    ];

    global.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => questions
    } as unknown as Response));

    render(<PeerQnAPanel isOpen={true} onClose={() => {}} tenantId="er_trauma" userProfile={dummyProfile} />);

    await waitFor(() => {
        const titleBadge = screen.getByText('ER');
        assert.ok(titleBadge, 'Department short name badge should be displayed');
    });

    await waitFor(() => {
        assert.ok(screen.getByText('Where is the trauma cart?'));
        assert.ok(screen.getByText('What is the RSI protocol?'));
    });

    const unverifiedBadge = screen.getByTestId('badge-unverified');
    assert.ok(unverifiedBadge, 'Unverified badge should be displayed for q1');
    assert.ok(unverifiedBadge.textContent?.includes('🟡 Unverified (0/2)'));

    const verifiedBadge = screen.getByTestId('badge-verified');
    assert.ok(verifiedBadge, 'Verified badge should be displayed for q2');
    assert.ok(verifiedBadge.textContent?.includes('🟢 Verified'));
});

test('submitting an answer with clinical role', async () => {
    const questions = [
        {
            id: 'q1',
            tenantId: 'er_trauma',
            questionText: 'Where is the trauma cart?',
            askedBy: 'Dr. Smith',
            role: 'Attending',
            createdAt: new Date().toISOString(),
            answers: [],
            status: 'unverified',
            verificationsCount: 0
        }
    ];

    global.fetch = mock.fn(async (url, options) => {
        if (options && options.method === 'POST') {
            return {
                ok: true,
                json: async () => ({
                    ...questions[0],
                    answers: [{
                        answerId: 'new-ans',
                        answeredBy: 'Test Nurse (Circulating RN)',
                        answerText: 'It is in room 3',
                        verifiedBy: [],
                        isVerifiedConsensus: false
                    }]
                })
            } as unknown as Response;
        }
        return {
            ok: true,
            json: async () => questions
        } as unknown as Response;
    });

    render(<PeerQnAPanel isOpen={true} onClose={() => {}} tenantId="er_trauma" userProfile={dummyProfile} />);

    await waitFor(() => {
        assert.ok(screen.getByText('Where is the trauma cart?'));
    });

    const addAnswerBtn = screen.getByText('+ Add Answer');
    fireEvent.click(addAnswerBtn);

    const textarea = screen.getByPlaceholderText('Enter clinical location or guidance...');
    fireEvent.change(textarea, { target: { value: 'It is in room 3' } });

    const submitBtn = screen.getByText('Submit Answer');
    fireEvent.click(submitBtn);

    await waitFor(() => {
        assert.ok(screen.getByText('Answered by:'));
        assert.ok(screen.getByText('Test Nurse (Circulating RN)'));
        assert.ok(screen.getByText('It is in room 3'));
    });
});

test('verify touch targets and accessibility', async () => {
    const questions = [
        {
            id: 'q1',
            tenantId: 'er_trauma',
            questionText: 'Where is the trauma cart?',
            askedBy: 'Dr. Smith',
            role: 'Attending',
            createdAt: new Date().toISOString(),
            answers: [],
            status: 'unverified',
            verificationsCount: 0
        }
    ];

    global.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => questions
    } as unknown as Response));

    render(<PeerQnAPanel isOpen={true} onClose={() => {}} tenantId="er_trauma" userProfile={dummyProfile} />);

    await waitFor(() => {
        assert.ok(screen.getByRole('dialog'));
    });

    const dialog = screen.getByRole('dialog');
    assert.strictEqual(dialog.getAttribute('aria-modal'), 'true');
    assert.strictEqual(dialog.getAttribute('aria-labelledby'), 'peer-qna-title');

    const closeBtn = screen.getByLabelText('Close');
    assert.ok(closeBtn);

    await waitFor(() => {
        const badge = screen.getByTestId('badge-unverified');
        assert.ok(badge.className.includes('px-2.5') && badge.className.includes('py-0.5'));
    });
});
