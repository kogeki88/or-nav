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

let mockOfflineQuestions: any[] = [];
let mockSaveOfflinePeerQuestionCalls: any[] = [];

const mockGetOfflinePeerQuestions = mock.fn(async (tenantId: string) => {
    return mockOfflineQuestions.filter(q => q.tenantId === tenantId);
});

const mockSaveOfflinePeerQuestion = mock.fn(async (q: any) => {
    mockSaveOfflinePeerQuestionCalls.push(q);
});

const mockSaveOfflinePeerQuestions = mock.fn(async () => {});

const PeerQnAPanelMod = proxyquire('./PeerQnAPanel', {
    '@/lib/gamification': {
        awardClinicalXP: mock.fn()
    },
    '@/lib/auth': {
        createTimeoutSignal: mock.fn(() => new AbortController().signal)
    },
    '@/lib/offlineDb': {
        getOfflinePeerQuestions: mockGetOfflinePeerQuestions,
        saveOfflinePeerQuestion: mockSaveOfflinePeerQuestion,
        saveOfflinePeerQuestions: mockSaveOfflinePeerQuestions
    }
});

const PeerQnAPanel = PeerQnAPanelMod.default;

beforeEach(() => {
  mockOfflineQuestions = [];
  mockSaveOfflinePeerQuestionCalls = [];
  mockGetOfflinePeerQuestions.mock.resetCalls();
  mockSaveOfflinePeerQuestion.mock.resetCalls();
  mockSaveOfflinePeerQuestions.mock.resetCalls();

  global.fetch = mock.fn(async () => ({
    ok: true,
    json: async () => ([])
  } as unknown as Response));
});

afterEach(() => {
  cleanup();
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

    global.fetch = mock.fn(async (url: any, options: any) => {
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

test('enforces multi-tenant isolation in network requests', async () => {
    let fetchUrl = '';
    global.fetch = mock.fn(async (url: any) => {
        fetchUrl = url;
        return { ok: true, json: async () => [] } as unknown as Response;
    });

    render(<PeerQnAPanel isOpen={true} onClose={() => {}} tenantId="sacred_heart::or" userProfile={dummyProfile} />);

    await waitFor(() => {
        assert.ok(fetchUrl.includes('tenant_id=sacred_heart%3A%3Aor'), 'Fetch URL should contain correctly encoded tenant_id');
    });
});

test('offline-first fallback when network fails', async () => {
    mockOfflineQuestions = [
        {
            id: 'offline-q1',
            tenantId: 'er_trauma',
            questionText: 'Offline Question?',
            askedBy: 'Dr. Offline',
            role: 'Attending',
            createdAt: new Date().toISOString(),
            answers: [],
            status: 'unverified',
            verificationsCount: 0
        }
    ];

    global.fetch = mock.fn(async () => {
        throw new Error('Network offline');
    });

    render(<PeerQnAPanel isOpen={true} onClose={() => {}} tenantId="er_trauma" userProfile={dummyProfile} />);

    await waitFor(() => {
        assert.ok(screen.getByText('Offline Question?'));
    });
});

test('offline submission fallback handles tenant isolation', async () => {
    global.fetch = mock.fn(async () => {
        throw new Error('Network error');
    });

    render(<PeerQnAPanel isOpen={true} onClose={() => {}} tenantId="isolated_tenant" userProfile={dummyProfile} />);

    const askTab = screen.getByText('Ask Department Peers');
    fireEvent.click(askTab);

    const textarea = screen.getByPlaceholderText(/e.g. Where is the emergency vascular shunt stored/);
    fireEvent.change(textarea, { target: { value: 'Where is the secret stash?' } });

    const submitBtn = screen.getByText('Broadcast Question');
    fireEvent.click(submitBtn);

    await waitFor(() => {
        assert.ok(screen.getByText('Where is the secret stash?'));
    });

    assert.strictEqual(mockSaveOfflinePeerQuestionCalls.length, 1);
    assert.strictEqual(mockSaveOfflinePeerQuestionCalls[0].tenantId, 'isolated_tenant');
    assert.strictEqual(mockSaveOfflinePeerQuestionCalls[0].questionText, 'Where is the secret stash?');
});

test('verify answer updates local and remote state', async () => {
    const questions = [
        {
            id: 'q1',
            tenantId: 'er_trauma',
            questionText: 'What is the standard procedure?',
            askedBy: 'Dr. Smith',
            role: 'Attending',
            createdAt: new Date().toISOString(),
            answers: [
                {
                    answerId: 'a1',
                    answeredBy: 'Nurse A',
                    answerText: 'Standard protocol.',
                    verifiedBy: [],
                    isVerifiedConsensus: false
                }
            ],
            status: 'unverified',
            verificationsCount: 0
        }
    ];

    global.fetch = mock.fn(async (url: any, options: any) => {
        if (options && options.method === 'POST' && url.includes('/verify')) {
            return {
                ok: true,
                json: async () => ({
                    ...questions[0],
                    answers: [{
                        ...questions[0].answers[0],
                        verifiedBy: ['Test Nurse (Circulating RN)'],
                        isVerifiedConsensus: false
                    }],
                    verificationsCount: 1
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
        assert.ok(screen.getByText('What is the standard procedure?'));
    });

    const verifyBtn = screen.getByText('[✓ Verify Answer]');
    fireEvent.click(verifyBtn);

    await waitFor(() => {
        assert.ok(screen.getByText('✓ Verified by You'));
    });
});

test('handles malformed question payloads from backend without crashing', async () => {
    const malformedQuestions = [
        null,
        undefined,
        "not an object",
        { id: 'missing-fields' }, // Missing required fields like answers array
        {
            id: 'q-malformed-answers',
            tenantId: 'er_trauma',
            questionText: 'Malformed answers test?',
            askedBy: 'Dr. Glitch',
            role: 'Attending',
            createdAt: new Date().toISOString(),
            answers: null, // Should be array
            status: 'unverified',
            verificationsCount: 0
        },
        {
            id: 'q-valid',
            tenantId: 'er_trauma',
            questionText: 'Valid question?',
            askedBy: 'Dr. Valid',
            role: 'Attending',
            createdAt: new Date().toISOString(),
            answers: [],
            status: 'unverified',
            verificationsCount: 0
        }
    ];

    global.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => malformedQuestions
    } as unknown as Response));

    // The component should render without crashing, potentially skipping or safely rendering the malformed questions.
    render(<PeerQnAPanel isOpen={true} onClose={() => {}} tenantId="er_trauma" userProfile={dummyProfile} />);

    await waitFor(() => {
        assert.ok(screen.getByText('Valid question?'));
    });
});

test('handles massive boundary strings and XSS attempts in inputs', async () => {
    global.fetch = mock.fn(async (url: any, options: any) => {
        if (options && options.method === 'POST') {
            const body = JSON.parse(options.body);
            return {
                ok: true,
                json: async () => ({
                    ...body,
                    id: 'q-fuzz-1',
                    answers: [],
                    status: 'unverified',
                    verificationsCount: 0
                })
            } as unknown as Response;
        }
        return { ok: true, json: async () => [] } as unknown as Response;
    });

    render(<PeerQnAPanel isOpen={true} onClose={() => {}} tenantId="er_trauma" userProfile={dummyProfile} />);

    const askTab = screen.getByText('Ask Department Peers');
    fireEvent.click(askTab);

    const maliciousString = '<script>alert(1)</script><img src=x onerror=alert(1)>' + 'A'.repeat(10000);
    const textarea = screen.getByPlaceholderText(/e.g. Where is the emergency vascular shunt stored/);
    fireEvent.change(textarea, { target: { value: maliciousString } });

    const submitBtn = screen.getByText('Broadcast Question');
    fireEvent.click(submitBtn);

    // Should successfully submit and display (React automatically sanitizes, testing for no crashes)
    await waitFor(() => {
        assert.ok(screen.getByText((content) => content.includes('<script>alert(1)</script>')));
    });
});

test('handles concurrent/rapid submissions correctly without duplication', async () => {
    let postCallCount = 0;
    global.fetch = mock.fn(async (url: any, options: any) => {
        if (options && options.method === 'POST') {
            postCallCount++;
            // Simulate network delay to test debouncing/submitting state
            await new Promise(resolve => setTimeout(resolve, 50));
            const body = JSON.parse(options.body);
            return {
                ok: true,
                json: async () => ({
                    ...body,
                    id: `q-rapid-${postCallCount}`,
                    answers: [],
                    status: 'unverified',
                    verificationsCount: 0
                })
            } as unknown as Response;
        }
        return { ok: true, json: async () => [] } as unknown as Response;
    });

    render(<PeerQnAPanel isOpen={true} onClose={() => {}} tenantId="er_trauma" userProfile={dummyProfile} />);

    const askTab = screen.getByText('Ask Department Peers');
    fireEvent.click(askTab);

    const textarea = screen.getByPlaceholderText(/e.g. Where is the emergency vascular shunt stored/);
    fireEvent.change(textarea, { target: { value: 'Rapid click test' } });

    const submitBtn = screen.getByText('Broadcast Question');

    // Fire click rapidly multiple times
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    await waitFor(() => {
        assert.ok(screen.getByText('Rapid click test'));
    });

    // The component disables the button while submitting, so only 1 POST should go through
    assert.strictEqual(postCallCount, 1, 'Should only send one POST request despite rapid clicks');
});

test('enforces strict multi-tenant isolation on offline boundary', async () => {
    mockOfflineQuestions = [
        {
            id: 'offline-q1',
            tenantId: 'other-tenant',
            questionText: 'Wrong Tenant Question',
            askedBy: 'Dr. Offline',
            role: 'Attending',
            createdAt: new Date().toISOString(),
            answers: [],
            status: 'unverified',
            verificationsCount: 0
        }
    ];

    global.fetch = mock.fn(async () => {
        throw new Error('Network offline');
    });

    render(<PeerQnAPanel isOpen={true} onClose={() => {}} tenantId="er_trauma" userProfile={dummyProfile} />);

    await waitFor(() => {
        const missing = screen.queryByText('Wrong Tenant Question');
        assert.ok(!missing, 'Should not render questions from another tenant');
    });
});


test('high-concurrency and race condition benchmark', async () => {
    const numPanels = 50;
    const start = performance.now();
    let fetchCalls = 0;
    let postCalls = 0;

    // Mix of tenants
    const tenants = ['tenant_alpha', 'tenant_beta', 'tenant_gamma'];

    global.fetch = mock.fn(async (url, options) => {
        fetchCalls++;
        if (options && options.method === 'POST') {
            postCalls++;

            // Introduce jitter for race conditions
            await new Promise(r => setTimeout(r, Math.random() * 20));

            const body = JSON.parse(options.body);

            return {
                ok: true,
                json: async () => ({
                    ...body,
                    id: `q-concurrent-${postCalls}`,
                    answers: [],
                    status: 'unverified',
                    verificationsCount: 0
                })
            };
        }

        return { ok: true, json: async () => [] };
    });

    const panels = Array.from({ length: numPanels }).map((_, i) => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        const tenantId = tenants[i % tenants.length];
        const comp = render(<PeerQnAPanel isOpen={true} onClose={() => {}} tenantId={tenantId} userProfile={dummyProfile} />, { container: root });
        return { comp, tenantId, id: i };
    });

    // Wait for event loop
    await new Promise(r => setTimeout(r, 50));

    await Promise.all(panels.map(async ({ comp, tenantId, id }) => {
        // Yield execution to simulate real concurrent burst!
        await new Promise(r => setTimeout(r, Math.random() * 10));

        const askTab = comp.getByText('Ask Department Peers');
        fireEvent.click(askTab);

        const textarea = comp.getByPlaceholderText(/e.g. Where is the emergency vascular shunt stored/);
        fireEvent.change(textarea, { target: { value: `Stress question ${id} for ${tenantId}` } });

        const submitBtn = comp.getByText('Broadcast Question');
        fireEvent.click(submitBtn);
    }));

    await waitFor(() => {
        assert.strictEqual(postCalls, numPanels, 'All panels must submit successfully under load');
    }, { timeout: 5000 });

    const end = performance.now();

    // Performance criteria
    const totalLatency = end - start;
    const avgLatency = totalLatency / numPanels;

    console.log(`Concurrency bench: ${numPanels} requests in ${totalLatency.toFixed(2)}ms (${avgLatency.toFixed(2)}ms/req)`);

    // Cleanup
    panels.forEach(({ comp }) => comp.unmount());
});

test('high-concurrency and race condition benchmark - offline first invariant', async () => {
    const numPanels = 50;

    // Mix of tenants
    const tenants = ['tenant_alpha', 'tenant_beta', 'tenant_gamma'];

    // Poison fetch
    global.fetch = mock.fn(async () => {
        throw new Error('Network offline');
    });

    const panels = Array.from({ length: numPanels }).map((_, i) => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        const tenantId = tenants[i % tenants.length];
        const comp = render(<PeerQnAPanel isOpen={true} onClose={() => {}} tenantId={tenantId} userProfile={dummyProfile} />, { container: root });
        return { comp, tenantId, id: i };
    });

    // Wait for event loop
    await new Promise(r => setTimeout(r, 50));

    const initialCount = mockSaveOfflinePeerQuestionCalls.length;

    await Promise.all(panels.map(async ({ comp, tenantId, id }) => {
        // Yield execution to simulate real concurrent burst!
        await new Promise(r => setTimeout(r, Math.random() * 10));

        const askTab = comp.getByText('Ask Department Peers');
        fireEvent.click(askTab);

        const textarea = comp.getByPlaceholderText(/e.g. Where is the emergency vascular shunt stored/);
        fireEvent.change(textarea, { target: { value: `Offline stress question ${id} for ${tenantId}` } });

        const submitBtn = comp.getByText('Broadcast Question');
        fireEvent.click(submitBtn);
    }));

    await waitFor(() => {
        const currentCount = mockSaveOfflinePeerQuestionCalls.length;
        assert.strictEqual(currentCount - initialCount, numPanels, 'All panels must fallback to offline storage successfully under load');
    }, { timeout: 5000 });

    // Validate offline storage tenant isolation
    const relevantCalls = mockSaveOfflinePeerQuestionCalls.slice(initialCount);
    relevantCalls.forEach(call => {
        assert.ok(tenants.includes(call.tenantId), 'Offline fallback must correctly store tenant ID');
    });

    // Cleanup
    panels.forEach(({ comp }) => comp.unmount());
});
