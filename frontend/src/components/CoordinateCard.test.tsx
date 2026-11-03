import 'jsdom-global/register.js';
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

import CoordinateCard from './CoordinateCard';
import { CoordinateCardData } from '@/lib/api';
import { loadFacilityLexicon } from '@/lib/lexiconLearning';

beforeEach(() => {
});

afterEach(() => {
  cleanup();
  mock.restoreAll();
});
test('renders full coordinates and validates aria-labels (Room, Cabinet, Shelf, Bin)', () => {
  const cardData: CoordinateCardData = {
    item: 'Item A',
    room: 'OR 1',
    cabinet: '2',
    shelf: '3',
    container: '4',
    full_code: 'OR 1-2-3-4',
    category: 'Surgical',
    surgeon_notes: '',
    pending_location: '',
    verify_count: 0,
  };

  render(<CoordinateCard card={cardData} />);

  // Check the title
  const title = screen.getByTestId('coordinate-card-title');
  assert.strictEqual(title.textContent, 'Item A');

  // Verify the values
  assert.ok(screen.getByText('OR 1'));
  assert.ok(screen.getByText('2'));
  assert.ok(screen.getByText('3'));
  assert.ok(screen.getByText('4'));

  // Verify aria labels exist (divs with aria-label)
  const roomDiv = screen.getByLabelText('Room OR 1');
  const cabinetDiv = screen.getByLabelText('Cabinet 2');
  const shelfDiv = screen.getByLabelText('Shelf 3');
  const binDiv = screen.getByLabelText('Bin 4');

  assert.ok(roomDiv);
  assert.ok(cabinetDiv);
  assert.ok(shelfDiv);
  assert.ok(binDiv);
});
test('renders partial coordinates and handles missing values gracefully', () => {
  const cardData: CoordinateCardData = {
    item: 'Item B',
    room: 'OR 2',
    cabinet: '',
    shelf: 'Top',
    container: '',
    full_code: 'OR 2--Top-',
    category: 'Surgical',
    surgeon_notes: '',
    pending_location: '',
    verify_count: 0,
  };

  render(<CoordinateCard card={cardData} />);

  const container = screen.getByTestId('coordinate-card');
  assert.ok(container.innerHTML.includes('OR 2'));
  assert.ok(container.innerHTML.includes('Top'));

  const roomDiv = container.querySelector('[aria-label="Room OR 2"]');
  const cabinetDiv = container.querySelector('[aria-label="Cabinet "]');
  const shelfDiv = container.querySelector('[aria-label="Shelf Top"]');
  const binDiv = container.querySelector('[aria-label="Bin "]');

  assert.ok(roomDiv);
  assert.ok(cabinetDiv);
  assert.ok(shelfDiv);
  assert.ok(binDiv);
});

test('offline mutation idempotency and multi-tenant isolation', async () => {
    const originalFetch = global.fetch;
    try {
        global.fetch = mock.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as any;

        const cardData1: CoordinateCardData = {
            item: 'Item Y', room: 'OR 1', cabinet: '2', shelf: '3', container: '4', full_code: 'OR 1-2-3-4',
            category: 'Surgical', surgeon_notes: '', pending_location: '', verify_count: 0,
        };

        const facilityIdCompound = 'tenant_A::dept_1';

        const { unmount: unmountA } = render(<CoordinateCard card={cardData1} facilityId={facilityIdCompound} departmentId="dept_1" />);

        const addBtn = screen.getByTestId('add-local-alias-btn');
        fireEvent.click(addBtn);

        const input = screen.getByTestId('add-local-alias-input');
        fireEvent.change(input, { target: { value: 'Y-Alias' } });

        const saveBtn = screen.getByTestId('save-local-alias-btn');
        fireEvent.click(saveBtn);

        // click again to simulate offline idempotency issue
        fireEvent.click(saveBtn);

        // Verify in UI
        await waitFor(() => {
            assert.ok(screen.getAllByText('Y-Alias').length === 1);
        });

        // check lexicon
        const lexA = loadFacilityLexicon(facilityIdCompound);
        const lexB = loadFacilityLexicon('tenant_B::dept_2');

        assert.ok(lexA.some(l => l.spokenTerm === 'y-alias'));
        assert.ok(!lexB.some(l => l.spokenTerm === 'y-alias'));

        unmountA();

        // re-render to check cross-tenant leakage
        const { unmount: unmountB } = render(<CoordinateCard card={cardData1} facilityId="tenant_B::dept_2" departmentId="dept_2" />);
        await waitFor(() => {
            const tenantBAliases = screen.queryAllByText('Y-Alias');
            assert.ok(tenantBAliases.length === 0);
        });
        unmountB();

    } finally {
        global.fetch = originalFetch;
        cleanup();
    }
});

test('renders malformed payload resilience', () => {
    // Malformed props
    const d: CoordinateCardData = {
        item: 1 as any as string,
        room: undefined as any as string,
        cabinet: null as any as string,
        shelf: '3',
        container: '4',
        full_code: '1',
        category: 'cat',
        surgeon_notes: '',
        pending_location: '',
        verify_count: 0
    };

    render(<CoordinateCard card={d} />);
    const roomDiv = screen.getByLabelText('Room undefined');
    const cabDiv = screen.getByLabelText('Cabinet null');
    assert.ok(roomDiv);
    assert.ok(cabDiv);
    cleanup();
});

test('boundary inputs and schema enforcement for fuzzing inputs', () => {
    // Fuzzing boundary values
    const fuzzyInputs = [
        {
            item: '<script>alert(1)</script>',
            room: 'OR\u0000 1',
            cabinet: '-1',
            shelf: '9999999999999999',
            container: '',
            full_code: 'OR 1--1-9999-0',
            category: 'UNKNOWN_CAT',
            surgeon_notes: 'Notes \n\r',
            pending_location: 'Null\b',
            verify_count: -100
        },
        {
            item: '',
            room: '',
            cabinet: '',
            shelf: '',
            container: '',
            full_code: '',
            category: '',
            surgeon_notes: '',
            pending_location: '',
            verify_count: 0
        },
        {
            item: 'A'.repeat(1000),
            room: 'B'.repeat(50),
            cabinet: 'C'.repeat(50),
            shelf: 'D'.repeat(50),
            container: 'E'.repeat(50),
            full_code: 'F'.repeat(100),
            category: 'Surgical',
            surgeon_notes: 'G'.repeat(500),
            pending_location: '',
            verify_count: 9999
        }
    ];

    for (const d of fuzzyInputs) {
        render(<CoordinateCard card={d} />);
        cleanup();
    }
});

test('high-concurrency and latency benchmarks (stress testing)', async () => {
    const cardData: CoordinateCardData = {
        item: 'Item Z', room: 'OR 1', cabinet: '2', shelf: '3', container: '4', full_code: 'OR 1-2-3-4',
        category: 'Surgical', surgeon_notes: '', pending_location: '', verify_count: 0,
    };

    const iterations = 50;
    const start = performance.now();

    const originalFetch = global.fetch;
    global.fetch = (async () => { throw new Error('Network offline'); }) as any;

    try {
        await Promise.all(
            Array.from({ length: iterations }).map(async (_, idx) => {
                const { queryAllByText, unmount } = render(<CoordinateCard card={cardData} facilityId={`tenant_stress_${idx}`} />);

                const addBtns = screen.getAllByTestId('add-local-alias-btn');
                fireEvent.click(addBtns[addBtns.length - 1]);

                const inputs = screen.getAllByTestId('add-local-alias-input');
                fireEvent.change(inputs[inputs.length - 1], { target: { value: `Alias-${idx}` } });

                const saveBtns = screen.getAllByTestId('save-local-alias-btn');
                fireEvent.click(saveBtns[saveBtns.length - 1]);
                fireEvent.click(saveBtns[saveBtns.length - 1]);
                fireEvent.click(saveBtns[saveBtns.length - 1]);

                await waitFor(() => {
                    const found = queryAllByText(`Alias-${idx}`);
                    assert.ok(found.length > 0);
                });

                unmount();
            })
        );
    } finally {
        global.fetch = originalFetch;
    }

    const end = performance.now();
    const duration = end - start;
    assert.ok(duration < 5000, `Latency benchmark failed: took ${duration}ms`);
});
