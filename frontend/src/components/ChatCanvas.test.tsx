import 'jsdom-global/register.js';
import { test, afterEach } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

import ChatCanvas from './ChatCanvas';
import { MessageItem } from './ChatCanvas';

afterEach(() => {
  cleanup();
});

test('renders empty state', () => {
  const { container } = render(
    <ChatCanvas
      messages={[]}
      loading={false}
      tenantId="or_main"
      onVerifyPendingMove={async () => {}}
    />
  );
  assert.ok(container.innerHTML.includes('Where is 3-0 Silk?'));
});

test('renders user message', () => {
  const messages: MessageItem[] = [
    {
      id: '1',
      sender: 'user',
      text: 'Hello, where is the silk?',
      timestamp: new Date().toISOString(),
    }
  ];

  render(
    <ChatCanvas
      messages={messages}
      loading={false}
      tenantId="or_main"
      onVerifyPendingMove={async () => {}}
    />
  );
  assert.ok(screen.getByText('Hello, where is the silk?'));
});

test('renders agent clinical response', () => {
  const messages: MessageItem[] = [
    {
      id: '2',
      sender: 'assistant',
      text: '### 📋 Clinical Guidance\nThe silk is located in OR 1.',
      timestamp: new Date().toISOString(),
      coordinateCard: {
        item: '3-0 Silk',
        room: 'OR 1',
        cabinet: 'A',
        shelf: '2',
        container: '1',
        full_code: 'OR1-A-2-1',
      }
    }
  ];

  render(
    <ChatCanvas
      messages={messages}
      loading={false}
      tenantId="or_main"
      onVerifyPendingMove={async () => {}}
    />
  );
  assert.ok(screen.getByTestId('hybrid-clinical-guidance'));
  assert.ok(screen.getByText('Clinical Guidance'));
  assert.ok(screen.getByText(/The silk is located in OR 1/));
});

test('renders structured card list rendering', () => {
  const messages: MessageItem[] = [
    {
      id: '3',
      sender: 'assistant',
      text: 'Found it.',
      timestamp: new Date().toISOString(),
      coordinateCard: {
        item: '3-0 Silk',
        room: 'OR 1',
        cabinet: 'A',
        shelf: '2',
        container: '1',
        full_code: 'OR1-A-2-1',
      }
    }
  ];

  const { container } = render(
    <ChatCanvas
      messages={messages}
      loading={false}
      tenantId="or_main"
      onVerifyPendingMove={async () => {}}
    />
  );
  assert.ok(screen.getByText('3-0 Silk'));
  assert.ok(screen.getByText('OR 1'));
  assert.ok(screen.getByText('A'));
  assert.ok(screen.getByText('2'));
});

test('renders multiple cards in carousel', () => {
    const messages: MessageItem[] = [
      {
        id: '4',
        sender: 'assistant',
        text: 'Found multiple items.',
        timestamp: new Date().toISOString(),
        coordinateCards: [
          {
            item: '3-0 Silk Variant A',
            room: 'OR 1',
            cabinet: 'A',
            shelf: '1',
            container: '1',
            full_code: 'OR1-A-1-1',
          },
          {
            item: '3-0 Silk Variant B',
            room: 'OR 2',
            cabinet: 'B',
            shelf: '2',
            container: '2',
            full_code: 'OR2-B-2-2',
          }
        ]
      }
    ];

    render(
      <ChatCanvas
        messages={messages}
        loading={false}
        tenantId="or_main"
        onVerifyPendingMove={async () => {}}
      />
    );
    assert.ok(screen.getByText('3-0 Silk Variant A'));
    assert.ok(screen.getByText('OR 1'));
    assert.ok(screen.getByText('3-0 Silk Variant B'));
    assert.ok(screen.getByText('OR 2'));
    assert.ok(screen.getByText('Found 2 items:'));
  });

test('renders action buttons like disambiguation chips', () => {
  const messages: MessageItem[] = [
    {
      id: '5',
      sender: 'assistant',
      text: 'Which one?',
      timestamp: new Date().toISOString(),
      disambiguationChips: ['1-0', '2-0', '3-0']
    }
  ];

  render(
    <ChatCanvas
      messages={messages}
      loading={false}
      tenantId="or_main"
      onVerifyPendingMove={async () => {}}
    />
  );
  assert.ok(screen.getByTestId('disambiguation-chips'));
  assert.ok(screen.getByText('1-0'));
  assert.ok(screen.getByText('2-0'));
  assert.ok(screen.getByText('3-0'));
});
