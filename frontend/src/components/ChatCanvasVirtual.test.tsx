import 'jsdom-global/register.js';
import { test, afterEach } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render, cleanup } from '@testing-library/react';

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
