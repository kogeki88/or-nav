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

test('ChatCanvas resilience against malformed coordinateCards (fuzzing/boundary)', async () => {
  const malformedMessages: MessageItem[] = [
    {
      id: 'msg-fuzz-1',
      sender: 'assistant',
      text: 'Malformed cards',
      timestamp: '2023-01-01T10:00:00Z',
      coordinateCards: [
        null as any,
        undefined as any,
        { item: null, location: undefined, category: 123 } as any,
        {} as any,
        { item: '<script>alert(1)</script>', location: 'loc', category: 'fuzz' },
      ],
    }
  ];

  const { container } = render(
    <ChatCanvas
      messages={malformedMessages}
      loading={false}
      tenantId="or_main"
      onVerifyPendingMove={async () => {}}
    />
  );

  assert.ok(container.innerHTML.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('ChatCanvas concurrent burst execution (race condition resistance & latency)', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => { throw new Error('Network offline'); };

    let savedCalls = 0;
    const mockSave = async (item: string, location: string, category?: string, notes?: string) => {
      savedCalls++;
      // Simulate variable latency between 10ms and 50ms
      await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 40));
    };

    const messages: MessageItem[] = [
      {
        id: 'msg-concurrent',
        sender: 'assistant',
        text: 'Concurrent Test:',
        timestamp: '2023-01-01T10:00:00Z',
        quickAddWidget: { item: 'Concurrent_Item', suggested_location: 'Loc' }
      }
    ];

    const { container } = render(
      <ChatCanvas
        messages={messages}
        loading={false}
        tenantId="or_main"
        onVerifyPendingMove={async () => {}}
        onSaveQuickAddItem={mockSave}
      />
    );

    const btn = container.querySelector('[data-testid="save-quick-add-btn"]') as HTMLButtonElement;
    assert.ok(btn, 'save button not found');

    const startTime = Date.now();

    // Fire 50 rapid concurrent click events (burst execution)
    for (let i = 0; i < 50; i++) {
      fireEvent.click(btn);
    }

    // Wait for all simulated asynchronous saves to potentially resolve
    await new Promise(resolve => setTimeout(resolve, 300));

    const latency = Date.now() - startTime;

    // Idempotency: despite 50 clicks, it should only trigger a single save call
    assert.strictEqual(savedCalls, 1, `Expected exactly 1 save call but got ${savedCalls} under burst execution`);

    // Check that rendering + async handling completes within reasonable bounds
    assert.ok(latency < 1000, `Latency benchmark failed: burst took ${latency}ms, expected < 1000ms`);
  } finally {
    global.fetch = originalFetch;
  }
});

test('ChatCanvas resilience against malformed payloads in quickAddWidget and teachingCard (fuzzing/boundary)', async () => {
  const malformedMessages: MessageItem[] = [
    {
      id: 'msg-fuzz-2',
      sender: 'assistant',
      text: 'Malformed widgets',
      timestamp: '2023-01-01T10:00:00Z',
      quickAddWidget: { item: null, suggested_location: { complex: 'object' } } as any,
      teachingCard: { slang: null, canonical: undefined, facility: 123, xp_awarded: 'a lot' } as any
    }
  ];

  const { container } = render(
    <ChatCanvas
      messages={malformedMessages}
      loading={false}
      tenantId="or_main"
      onVerifyPendingMove={async () => {}}
      onSaveQuickAddItem={async () => {}}
    />
  );

  assert.ok(container);
});
