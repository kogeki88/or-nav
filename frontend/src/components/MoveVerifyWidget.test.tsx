import 'jsdom-global/register.js';
import test, { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import MoveVerifyWidget from './MoveVerifyWidget';
import { MoveWidgetData } from '@/lib/api';

describe('MoveVerifyWidget', () => {
  const mockWidget: MoveWidgetData = {
    item: 'Defibrillator',
    new_location: 'ICU Storage',
    verify_count: 1,
    committed: false,
  };

  let originalFetch: typeof global.fetch;
  let fetchMock: any;

  beforeEach(() => {
    mock.restoreAll();

    originalFetch = global.fetch;
    fetchMock = mock.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          verify_count: 2,
          committed: false,
        })
      };
    });
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('renders the widget correctly', () => {
    render(<MoveVerifyWidget widget={mockWidget} tenantId="test-tenant" />);
    assert.ok(screen.getByText('Defibrillator'));
    assert.ok(screen.getByText('ICU Storage'));
    assert.ok(screen.getByText('Confirm (1/3)'));
  });

  it('verifies ARIA attributes on draggable item', () => {
    render(<MoveVerifyWidget widget={mockWidget} tenantId="test-tenant" />);
    const draggableItem = screen.getByText('Defibrillator');
    assert.strictEqual(draggableItem.getAttribute('draggable'), 'true');
    assert.strictEqual(draggableItem.getAttribute('role'), 'button');
    assert.strictEqual(draggableItem.getAttribute('aria-grabbed'), 'false');
  });

  it('handles drag start and end events correctly', () => {
    render(<MoveVerifyWidget widget={mockWidget} tenantId="test-tenant" />);
    const draggableItem = screen.getByText('Defibrillator');

    const setDataMock = mock.fn();
    const dataTransfer = {
      setData: setDataMock,
      effectAllowed: '',
    };

    fireEvent.dragStart(draggableItem, { dataTransfer });

    assert.strictEqual(draggableItem.getAttribute('aria-grabbed'), 'true');
    assert.strictEqual(setDataMock.mock.calls.length, 1);
    assert.deepStrictEqual(setDataMock.mock.calls[0].arguments, ['text/plain', 'Defibrillator']);
    assert.strictEqual(dataTransfer.effectAllowed, 'move');

    fireEvent.dragEnd(draggableItem);
    assert.strictEqual(draggableItem.getAttribute('aria-grabbed'), 'false');
  });

  it('handles drag over valid target shelf', () => {
    render(<MoveVerifyWidget widget={mockWidget} tenantId="test-tenant" />);
    const targetShelf = screen.getByText('ICU Storage');

    const dataTransfer = {
      dropEffect: '',
    };

    fireEvent.dragOver(targetShelf, { dataTransfer });

    assert.strictEqual(dataTransfer.dropEffect, 'move');
    // Verify visual validation of drop zone
    assert.ok(targetShelf.className.includes('border-emerald-500'));
  });

  it('handles drop event and triggers confirmation', async () => {
    const onCommittedMock = mock.fn();

    render(<MoveVerifyWidget widget={mockWidget} tenantId="test-tenant" onCommitted={onCommittedMock} />);

    const targetShelf = screen.getByText('ICU Storage');

    const dataTransfer = {
      getData: mock.fn(() => 'Defibrillator'),
    };

    fireEvent.drop(targetShelf, { dataTransfer });

    await waitFor(() => {
      assert.strictEqual(fetchMock.mock.calls.length, 1);
      const call = fetchMock.mock.calls[0];
      assert.ok(call.arguments[0].includes('/api/inventory/verify-move'));
      const body = JSON.parse(call.arguments[1].body);
      assert.strictEqual(body.tenant_id, 'test-tenant');
      assert.strictEqual(body.item, 'Defibrillator');
      assert.strictEqual(body.expected_location, 'ICU Storage');
    });

    assert.ok(screen.getByText('Confirm (2/3)'));
  });

  it('handles cancel/no-op action on drop with non-matching data', async () => {
    render(<MoveVerifyWidget widget={mockWidget} tenantId="test-tenant" />);

    const targetShelf = screen.getByText('ICU Storage');

    const dataTransfer = {
      getData: mock.fn(() => 'Other Item'),
    };

    fireEvent.drop(targetShelf, { dataTransfer });

    assert.strictEqual(fetchMock.mock.calls.length, 0);
  });
});
