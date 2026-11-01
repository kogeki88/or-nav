import 'jsdom-global/register.js';
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

import CoordinateCard from './CoordinateCard';
import { CoordinateCardData } from '@/lib/api';

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
