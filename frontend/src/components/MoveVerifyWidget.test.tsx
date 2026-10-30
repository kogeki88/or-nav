import 'jsdom-global/register.js';
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import MoveVerifyWidget from './MoveVerifyWidget';
import { MoveWidgetData } from '@/lib/api';

beforeEach(() => {
  global.fetch = mock.fn(async () => ({
    ok: true,
    json: async () => ({ verify_count: 2, committed: true })
  } as unknown as Response));
});

afterEach(() => {
  cleanup();
  mock.reset();
});

const mockWidget: MoveWidgetData = {
  item: "10 Blade",
  new_location: "Shelf B",
  verify_count: 1,
  committed: false,
  routing_tier: "MOVE_REPORTED",
  move_widget: null
};

test('drag start sets attributes correctly', async () => {
  render(<MoveVerifyWidget widget={mockWidget} tenantId="test_tenant" />);

  const draggableItem = screen.getByText("10 Blade");
  assert.strictEqual(draggableItem.getAttribute('aria-grabbed'), 'false');
  assert.strictEqual(draggableItem.getAttribute('draggable'), 'true');

  // Create a mock data transfer object
  const dataTransfer = {
    setData: mock.fn(),
    getData: mock.fn(),
    effectAllowed: ''
  };

  fireEvent.dragStart(draggableItem, { dataTransfer });

  assert.strictEqual(draggableItem.getAttribute('aria-grabbed'), 'true');
  assert.strictEqual(dataTransfer.setData.mock.calls.length, 1);
  assert.strictEqual(dataTransfer.setData.mock.calls[0].arguments[0], 'text/plain');
  assert.strictEqual(dataTransfer.setData.mock.calls[0].arguments[1], '10 Blade');
  assert.strictEqual(dataTransfer.effectAllowed, 'move');
});

test('hover over valid target shelf indicates drop zone', async () => {
  render(<MoveVerifyWidget widget={mockWidget} tenantId="test_tenant" />);

  const targetShelf = screen.getByText("Shelf B");
  assert.strictEqual(targetShelf.getAttribute('aria-dropeffect'), 'move');

  const dataTransfer = {
    dropEffect: ''
  };

  fireEvent.dragOver(targetShelf, { dataTransfer });

  // The class should change to indicate hover, checking for specific string in className
  assert.ok(targetShelf.className.includes('border-emerald-500'));
  assert.strictEqual(dataTransfer.dropEffect, 'move');

  fireEvent.dragLeave(targetShelf);
  assert.ok(!targetShelf.className.includes('border-emerald-500'));
});

test('drop event triggers move confirmation', async () => {
  const onCommittedMock = mock.fn();

  render(<MoveVerifyWidget widget={mockWidget} tenantId="test_tenant" onCommitted={onCommittedMock} />);

  const targetShelf = screen.getByText("Shelf B");

  const dataTransfer = {
    getData: mock.fn((format) => {
      if (format === 'text/plain') return '10 Blade';
      return '';
    })
  };

  fireEvent.drop(targetShelf, { dataTransfer });

  await waitFor(() => {
    assert.strictEqual(global.fetch.mock.calls.length, 1);

    // UI should show committed state
    assert.ok(screen.getByText('Committed'));
    assert.ok(screen.getByText('3/3 confirmed'));

    assert.strictEqual(onCommittedMock.mock.calls.length, 1);
    assert.strictEqual(onCommittedMock.mock.calls[0].arguments[0], '10 Blade');
  });
});

test('cancel action does not trigger confirmation', async () => {
  render(<MoveVerifyWidget widget={mockWidget} tenantId="test_tenant" />);

  const draggableItem = screen.getByText("10 Blade");
  const startDataTransfer = {
    setData: mock.fn(),
    effectAllowed: ''
  };
  fireEvent.dragStart(draggableItem, { dataTransfer: startDataTransfer });
  assert.strictEqual(draggableItem.getAttribute('aria-grabbed'), 'true');

  // Cancel drag by ending it without drop
  fireEvent.dragEnd(draggableItem);

  assert.strictEqual(draggableItem.getAttribute('aria-grabbed'), 'false');
  assert.strictEqual(global.fetch.mock.calls.length, 0); // No API call should happen
});
