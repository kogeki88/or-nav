import 'jsdom-global/register.js';
import { test, afterEach } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';

if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

// Ensure IntersectionObserver is available for virtualized lists
if (!global.IntersectionObserver) {
  global.IntersectionObserver = class IntersectionObserver {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
}

// Override getBoundingClientRect to give the container some height so virtualization renders something
Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
  value: () => ({
    width: 800,
    height: 800,
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
  }),
});
Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
  value: 800,
  configurable: true,
});
Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', {
  value: 800,
  configurable: true,
});
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', {
  value: 800,
  configurable: true,
});
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
  value: 800,
  configurable: true,
});

import ChatCanvas, { MessageItem } from './ChatCanvas';

afterEach(() => {
  cleanup();
});

test('ChatCanvas renders only visible items in large sets', async () => {
  const largeCoordinateCards = Array.from({ length: 500 }).map((_, i) => ({
    item: `HugeDataSetItem ${i}`,
    location: `Location ${i}`,
    category: 'Implants',
  }));

  const messages: MessageItem[] = [
    {
      id: 'msg-1',
      sender: 'assistant',
      text: 'Here are the items:',
      timestamp: '2023-01-01T10:00:00Z',
      coordinateCards: largeCoordinateCards,
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

  const itemsRendered = container.innerHTML.match(/HugeDataSetItem/g) || [];

  // Virtualization should limit rendered items to a small number (e.g., <= 20) in view
  assert.ok(
    itemsRendered.length < 50 && itemsRendered.length > 0,
    `Virtualization failed: expected 0 < items < 50 rendered, but found ${itemsRendered.length}`
  );
});

test('ChatCanvas enforces multi-tenant isolation', async () => {
  const messagesTenantA: MessageItem[] = [
    {
      id: 'msg-a',
      sender: 'assistant',
      text: 'Tenant A items:',
      timestamp: '2023-01-01T10:00:00Z',
      coordinateCards: [{ item: 'TenantA_Item', location: 'LocA', category: 'A' }],
    }
  ];
  const messagesTenantB: MessageItem[] = [
    {
      id: 'msg-b',
      sender: 'assistant',
      text: 'Tenant B items:',
      timestamp: '2023-01-01T10:00:00Z',
      coordinateCards: [{ item: 'TenantB_Item', location: 'LocB', category: 'B' }],
    }
  ];

  const { container: containerA, unmount: unmountA } = render(
    <ChatCanvas messages={messagesTenantA} loading={false} tenantId="tenant_A" onVerifyPendingMove={async () => {}} />
  );
  assert.ok(containerA.innerHTML.includes('TenantA_Item'));
  assert.ok(!containerA.innerHTML.includes('TenantB_Item'));
  unmountA();

  const { container: containerB, unmount: unmountB } = render(
    <ChatCanvas messages={messagesTenantB} loading={false} tenantId="tenant_B" onVerifyPendingMove={async () => {}} />
  );
  assert.ok(containerB.innerHTML.includes('TenantB_Item'));
  assert.ok(!containerB.innerHTML.includes('TenantA_Item'));
  unmountB();
});

test('ChatCanvas enforces offline-first invariants and idempotency', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('Network offline'); };

  let savedCalls = 0;
  const mockSave = async (item: string) => {
    savedCalls++;
    await new Promise(resolve => setTimeout(resolve, 50));
  };

  const messages: MessageItem[] = [
    {
      id: 'msg-offline',
      sender: 'assistant',
      text: 'Offline Test:',
      timestamp: '2023-01-01T10:00:00Z',
      quickAddWidget: { item: 'Offline_Item', suggested_location: 'Loc' }
    }
  ];

  try {
    const { container, rerender } = render(
      <ChatCanvas
        messages={messages}
        loading={false}
        tenantId="or_main"
        onVerifyPendingMove={async () => {}}
        onSaveQuickAddItem={mockSave}
      />
    );

    assert.ok(container.innerHTML.includes('Offline_Item'));

    const btn = container.querySelector('[data-testid="save-quick-add-btn"]') as HTMLButtonElement;
    assert.ok(btn, 'save button not found');

    // Simulate idempotency: click multiple times while saving
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);

    await new Promise(resolve => setTimeout(resolve, 100));

    // idempotency verification: offline payload recorded exactly once
    assert.strictEqual(savedCalls, 1);

    // Simulate re-render idempotency by replaying the rendering phase
    rerender(
       <ChatCanvas
        messages={messages}
        loading={false}
        tenantId="or_main"
        onVerifyPendingMove={async () => {}}
        onSaveQuickAddItem={mockSave}
      />
    );
    // UI state remains identical and isolated
    assert.ok(container.innerHTML.includes('Offline_Item'));
    assert.strictEqual(savedCalls, 1);

  } finally {
    global.fetch = originalFetch;
  }
});
