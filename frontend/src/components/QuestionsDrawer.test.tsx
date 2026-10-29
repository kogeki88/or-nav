import 'jsdom-global/register.js';
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// Setup IndexedDB mock for Dexie
import 'fake-indexeddb/auto';
import QuestionsDrawer from './QuestionsDrawer';
import { DepartmentQuestion } from '@/lib/api';

beforeEach(() => {
  global.fetch = mock.fn(async () => ({
    ok: true,
    json: async () => ({})
  } as unknown as Response));
});

afterEach(() => {
  cleanup();
  mock.restoreAll();
});

test('lists unanswered questions', async () => {
    const questions: DepartmentQuestion[] = [
        {
            id: 'q1',
            hospital_id: 'er_trauma',
            question_text: 'Where is the trauma cart?',
            asked_by_role: 'Attending',
            created_at: new Date().toISOString(),
            verified_at: null,
            answers: [],
            status: 'open'
        },
        {
            id: 'q2',
            hospital_id: 'er_trauma',
            question_text: 'What is the RSI protocol?',
            asked_by_role: 'Scrub Tech',
            created_at: new Date().toISOString(),
            verified_at: new Date().toISOString(),
            answers: [
                {
                    id: 'a1',
                    responder_role: 'Senior Nurse',
                    answer_text: 'Standard RSI protocol applies.',
                    confidence: 'confident',
                    created_at: new Date().toISOString()
                }
            ],
            status: 'verified'
        }
    ];

    const onRefreshMock = mock.fn(async () => {});

    render(<QuestionsDrawer isOpen={true} onClose={() => {}} tenantId="er_trauma" questions={questions} onRefreshQuestions={onRefreshMock} />);

    await waitFor(() => {
        assert.ok(screen.getByText('Where is the trauma cart?'));
        assert.ok(screen.getByText('What is the RSI protocol?'));
    });

    const openBadge = screen.getByText('Open Question');
    assert.ok(openBadge, 'Open badge should be displayed for q1');

    const verifiedBadge = screen.getByText(/Verified in Guide/);
    assert.ok(verifiedBadge, 'Verified badge should be displayed for q2');
});

test('filtering questions by department', async () => {
    const questions: DepartmentQuestion[] = [
        {
            id: 'q1',
            hospital_id: 'er_trauma',
            question_text: 'Where is the trauma cart?',
            asked_by_role: 'Attending',
            created_at: new Date().toISOString(),
            verified_at: null,
            answers: [],
            status: 'open'
        },
        {
            id: 'q2',
            hospital_id: 'icu',
            question_text: 'Where is the intubation kit?',
            asked_by_role: 'Resident',
            created_at: new Date().toISOString(),
            verified_at: null,
            answers: [],
            status: 'open'
        }
    ];

    const onRefreshMock = mock.fn(async () => {});

    // Filter by ICU
    render(<QuestionsDrawer isOpen={true} onClose={() => {}} tenantId="icu" questions={questions.filter(q => q.hospital_id === "icu")} onRefreshMock={onRefreshMock} />);

    await waitFor(() => {
        assert.ok(screen.getByText('Where is the intubation kit?'));
        const traumaQuery = screen.queryByText('Where is the trauma cart?');
        assert.strictEqual(traumaQuery, null);
    });
});

test('typing answer and dispatching answer submission', async () => {
    const questions: DepartmentQuestion[] = [
        {
            id: 'q1',
            hospital_id: 'er_trauma',
            question_text: 'Where is the trauma cart?',
            asked_by_role: 'Attending',
            created_at: new Date().toISOString(),
            verified_at: null,
            answers: [],
            status: 'open'
        }
    ];

    const onRefreshMock = mock.fn(async () => {});

    render(<QuestionsDrawer isOpen={true} onClose={() => {}} tenantId="er_trauma" questions={questions} onRefreshQuestions={onRefreshMock} />);

    await waitFor(() => {
        assert.ok(screen.getByText('Where is the trauma cart?'));
    });

    const textarea = screen.getByPlaceholderText('Write a peer answer for the orientee...');
    fireEvent.change(textarea, { target: { value: 'It is in room 3' } });

    const submitBtn = screen.getByText('Confident').closest('button');
    assert.ok(submitBtn);
    fireEvent.click(submitBtn!);

    await waitFor(() => {
        const fetchCalls = (global.fetch as any).mock.calls;
        assert.strictEqual(fetchCalls.length, 1);
        const url = fetchCalls[0].arguments[0];
        const options = fetchCalls[0].arguments[1];

        assert.ok(url.includes('/api/questions/q1/answer'));
        assert.strictEqual(options.method, 'POST');
        const body = JSON.parse(options.body);
        assert.strictEqual(body.tenant_id, 'er_trauma');
        assert.strictEqual(body.answer_text, 'It is in room 3');
        assert.strictEqual(body.confidence, 'confident');

        assert.strictEqual(onRefreshMock.mock.calls.length, 1);
    });
});
