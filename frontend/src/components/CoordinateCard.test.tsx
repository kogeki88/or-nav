import 'jsdom-global/register';
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

// Using proxyquire to mock Next.js / API dependencies
// eslint-disable-next-line @typescript-eslint/no-require-imports
const proxyquire = require('proxyquire');

const CoordinateCardMod = proxyquire('./CoordinateCard', {
  '@/lib/lexiconLearning': {
    learnAliasClient: mock.fn(),
    getFacilityIdFromTenant: mock.fn(() => ({ facilityId: 'test_facility' })),
    titleCaseTerm: mock.fn((val: string) => val),
  },
});

const CoordinateCard = CoordinateCardMod.default;
import { CoordinateCardData } from '@/lib/api';

const mockCardData: CoordinateCardData = {
  item: 'Suture',
  room: 'OR 1',
  cabinet: 'A',
  shelf: '2',
  container: '1',
  full_code: 'OR1-A-2-1',
  category: 'Supplies',
  surgeon_notes: '',
  pending_location: '',
  verify_count: 0
};

const partialMockCardData: CoordinateCardData = {
  item: 'Bandage',
  room: 'Main Supply',
  cabinet: '',
  shelf: '',
  container: 'Cart B',
  full_code: 'Main-CartB',
  category: 'Supplies',
  surgeon_notes: '',
  pending_location: '',
  verify_count: 0
};

afterEach(() => {
  cleanup();
});

test('renders correctly with full coordinates and accessible aria-labels', () => {
  render(<CoordinateCard card={mockCardData} />);
  assert.ok(screen.getByTestId('coordinate-card'));
  assert.ok(screen.getByText('OR 1'));
  assert.ok(screen.getByText('A'));
  assert.ok(screen.getByText('2'));
  assert.ok(screen.getByText('1'));

  // Check aria-labels using document queries because these are div elements not form controls
  assert.ok(document.querySelector('[aria-label="Room OR 1"]'));
  assert.ok(document.querySelector('[aria-label="Cabinet A"]'));
  assert.ok(document.querySelector('[aria-label="Shelf 2"]'));
  assert.ok(document.querySelector('[aria-label="Bin 1"]'));
});

test('renders correctly with partial coordinates and accessible aria-labels', () => {
  render(<CoordinateCard card={partialMockCardData} />);
  assert.ok(screen.getByTestId('coordinate-card'));
  assert.ok(screen.getByText('Main Supply'));
  assert.ok(screen.getByText('Cart B')); // Assuming empty fields just render empty strings and Cart B for Bin

  // Check aria-labels using document queries because these are div elements not form controls
  assert.ok(document.querySelector('[aria-label="Room Main Supply"]'));
  assert.ok(document.querySelector('[aria-label="Cabinet "]'));
  assert.ok(document.querySelector('[aria-label="Shelf "]'));
  assert.ok(document.querySelector('[aria-label="Bin Cart B"]'));
});
