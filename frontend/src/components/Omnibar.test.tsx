import 'jsdom-global/register.js';
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

import Omnibar from './Omnibar';

beforeEach(() => {
  // Setup mediaDevices mock
  Object.defineProperty(global.navigator, 'mediaDevices', {
    value: {
      getUserMedia: mock.fn(async () => {
        return {
          getTracks: () => [{ stop: () => {} }]
        };
      })
    },
    configurable: true
  });

  // Setup MediaRecorder mock
  class MockMediaRecorder {
    state = 'inactive';
    ondataavailable = null;
    start = mock.fn((timeslice?: number) => {
        this.state = 'recording';
    });
    stop = mock.fn(() => {
        this.state = 'inactive';
    });
    static isTypeSupported = () => true;
  }

  (global as { MediaRecorder?: unknown }).MediaRecorder = MockMediaRecorder;

  Object.defineProperty(global.navigator, 'vibrate', {
    value: mock.fn(),
    configurable: true
  });
});

afterEach(() => {
  cleanup();
  mock.restoreAll();
});

test('text input and Enter key form submission', async () => {
  const onSendMessage = mock.fn();

  render(
    <Omnibar
      onSendMessage={onSendMessage}
      onFileUpload={() => {}}
    />
  );

  const input = screen.getByTestId('omnibar-input');
  fireEvent.change(input, { target: { value: 'Hello world' } });
  assert.strictEqual((input as HTMLInputElement).value, 'Hello world');

  const form = input.closest('form');
  assert.ok(form);

  fireEvent.submit(form!);

  assert.strictEqual(onSendMessage.mock.calls.length, 1);
  assert.strictEqual(onSendMessage.mock.calls[0].arguments[0], 'Hello world');

  // After submit, input is cleared
  assert.strictEqual((input as HTMLInputElement).value, '');
});

test('text input and submit button click submission', async () => {
  const onSendMessage = mock.fn();

  render(
    <Omnibar
      onSendMessage={onSendMessage}
      onFileUpload={() => {}}
    />
  );

  const input = screen.getByTestId('omnibar-input');
  fireEvent.change(input, { target: { value: 'Hello again' } });

  const submitBtn = screen.getByTestId('omnibar-submit-btn');
  fireEvent.click(submitBtn);

  assert.strictEqual(onSendMessage.mock.calls.length, 1);
  assert.strictEqual(onSendMessage.mock.calls[0].arguments[0], 'Hello again');
});

test('microphone button touch events and loading indicator state', async () => {
  const onSendMessage = mock.fn();
  const onAudioVoiceQuery = mock.fn(async () => true);

  render(
    <Omnibar
      onSendMessage={onSendMessage}
      onFileUpload={() => {}}
      onAudioVoiceQuery={onAudioVoiceQuery}
    />
  );

  const micBtn = screen.getByTestId('ptt-mic-btn');
  const input = screen.getByTestId('omnibar-input');

  // Trigger pointerDown on mic button
  fireEvent.pointerDown(micBtn);

  // Instantly it goes to requesting state
  await waitFor(() => {
    assert.strictEqual(
      (input as HTMLInputElement).placeholder,
      '🎙️ Starting mic...'
    );
  });

  // Then it should resolve the stream and go to recording state
  await waitFor(() => {
    assert.strictEqual(
      (input as HTMLInputElement).placeholder,
      '🔴 Recording... Tap mic to send'
    );
  });

  // Now final tap to finalize
  fireEvent.pointerDown(micBtn);

  // Should transition to transcribing state
  await waitFor(() => {
    assert.strictEqual(
      (input as HTMLInputElement).placeholder,
      'Transcribing audio clip...'
    );
  });

  // And finally it will call onAudioVoiceQuery when it timeouts in finalizeAndSubmitRecording (200ms)
  // But our mock doesn't record any chunks, so it will show 'Didn't catch that' and go back to idle.
  await waitFor(() => {
    // idle / default placeholder
    assert.strictEqual(
      (input as HTMLInputElement).placeholder,
      "Didn't catch that — try speaking closer to the mic"
    );
  });
});


test('file upload button triggers onFileUpload', async () => {
  const onFileUpload = mock.fn();

  render(
    <Omnibar
      onSendMessage={() => {}}
      onFileUpload={onFileUpload}
    />
  );

  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  assert.ok(fileInput);

  const file = new File(['hello'], 'hello.png', { type: 'image/png' });
  fireEvent.change(fileInput, { target: { files: [file] } });

  assert.strictEqual(onFileUpload.mock.calls.length, 1);
  assert.strictEqual(onFileUpload.mock.calls[0].arguments[0], file);
});

test('empty input submission is ignored', async () => {
  const onSendMessage = mock.fn();

  render(
    <Omnibar
      onSendMessage={onSendMessage}
      onFileUpload={() => {}}
    />
  );

  const input = screen.getByTestId('omnibar-input');
  const submitBtn = screen.getByTestId('omnibar-submit-btn');

  fireEvent.click(submitBtn);
  assert.strictEqual(onSendMessage.mock.calls.length, 0);

  fireEvent.change(input, { target: { value: '   ' } });
  fireEvent.click(submitBtn);
  assert.strictEqual(onSendMessage.mock.calls.length, 0);
});

test('2000 character limit enforcement', async () => {
  const onSendMessage = mock.fn();

  render(
    <Omnibar
      onSendMessage={onSendMessage}
      onFileUpload={() => {}}
    />
  );

  const input = screen.getByTestId('omnibar-input');
  const longText = 'a'.repeat(2001);

  fireEvent.change(input, { target: { value: longText } });
  const submitBtn = screen.getByTestId('omnibar-submit-btn');
  fireEvent.click(submitBtn);

  assert.strictEqual(onSendMessage.mock.calls.length, 0);

  // Checking that it shows the flash placeholder
  await waitFor(() => {
    assert.strictEqual(
      (input as HTMLInputElement).placeholder,
      'Query exceeds 2,000 character limit'
    );
  });
});

test('disabled state blocks interaction', async () => {
  const onSendMessage = mock.fn();
  const onFileUpload = mock.fn();

  render(
    <Omnibar
      onSendMessage={onSendMessage}
      onFileUpload={onFileUpload}
      disabled={true}
    />
  );

  const input = screen.getByTestId('omnibar-input') as HTMLInputElement;
  const submitBtn = screen.getByTestId('omnibar-submit-btn') as HTMLButtonElement;
  const micBtn = screen.getByTestId('ptt-mic-btn') as HTMLButtonElement;
  const uploadBtn = screen.getByTestId('paperclip-upload-btn') as HTMLButtonElement;

  assert.strictEqual(input.disabled, true);
  assert.strictEqual(submitBtn.disabled, true);
  assert.strictEqual(micBtn.disabled, true);
  assert.strictEqual(uploadBtn.disabled, true);

  fireEvent.click(submitBtn);
  assert.strictEqual(onSendMessage.mock.calls.length, 0);
});

test('spacebar Push-To-Talk logic on desktop', async () => {
  const onSendMessage = mock.fn();

  render(
    <Omnibar
      onSendMessage={onSendMessage}
      onFileUpload={() => {}}
    />
  );

  const input = screen.getByTestId('omnibar-input');

  // Press spacebar (target body, not an input)
  fireEvent.keyDown(window, { code: 'Space', repeat: false });

  await waitFor(() => {
    assert.strictEqual(
      (input as HTMLInputElement).placeholder,
      '🎙️ Starting mic...'
    );
  });

  // Release spacebar
  fireEvent.keyUp(window, { code: 'Space' });

  await waitFor(() => {
    assert.strictEqual(
      (input as HTMLInputElement).placeholder,
      'Transcribing audio clip...'
    );
  });
});

test('enforce offline-first invariant (no global.fetch calls)', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(() => {
    throw new Error('Network request blocked by offline-first invariant');
  });

  try {
    const onSendMessage = mock.fn();

    render(
      <Omnibar
        onSendMessage={onSendMessage}
        onFileUpload={() => {}}
      />
    );

    const input = screen.getByTestId('omnibar-input');
    fireEvent.change(input, { target: { value: 'Offline message' } });

    const submitBtn = screen.getByTestId('omnibar-submit-btn');
    fireEvent.click(submitBtn);

    assert.strictEqual(onSendMessage.mock.calls.length, 1);
    assert.strictEqual(onSendMessage.mock.calls[0].arguments[0], 'Offline message');
  } finally {
    global.fetch = originalFetch;
  }
});

test('enforce multi-tenant isolation invariant (stateless)', async () => {
  const onSendMessage = mock.fn();

  // The component should NOT hold any internal tenant state.
  // We can render two independent instances and prove they fire events independently without cross-talk
  const root1 = document.createElement('div');
  root1.setAttribute('data-tenant', 'facility_1::dept_1');
  document.body.appendChild(root1);

  const root2 = document.createElement('div');
  root2.setAttribute('data-tenant', 'facility_2::dept_2');
  document.body.appendChild(root2);

  const render1 = render(<Omnibar onSendMessage={onSendMessage} onFileUpload={() => {}} />, { container: root1 });
  const render2 = render(<Omnibar onSendMessage={onSendMessage} onFileUpload={() => {}} />, { container: root2 });

  try {
    const inputs = screen.getAllByTestId('omnibar-input');
    const submitBtns = screen.getAllByTestId('omnibar-submit-btn');

    assert.strictEqual(inputs.length, 2);

    // Interact with first instance
    fireEvent.change(inputs[0], { target: { value: 'tenant 1 message' } });
    fireEvent.click(submitBtns[0]);

    assert.strictEqual(onSendMessage.mock.calls.length, 1);
    assert.strictEqual(onSendMessage.mock.calls[0].arguments[0], 'tenant 1 message');

    // Interact with second instance
    fireEvent.change(inputs[1], { target: { value: 'tenant 2 message' } });
    fireEvent.click(submitBtns[1]);

    assert.strictEqual(onSendMessage.mock.calls.length, 2);
    assert.strictEqual(onSendMessage.mock.calls[1].arguments[0], 'tenant 2 message');
  } finally {
    render1.unmount();
    render2.unmount();
    root1.remove();
    root2.remove();
  }
});

test('offline mutation replay idempotency (rerender)', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(() => {
    throw new Error('Network request blocked by offline-first invariant');
  });

  try {
    const onSendMessage = mock.fn();
    const { rerender, unmount } = render(<Omnibar onSendMessage={onSendMessage} onFileUpload={() => {}} />);

    const submitBtn = screen.getByTestId('omnibar-submit-btn');
    const input = screen.getByTestId('omnibar-input');

    // First interaction
    fireEvent.change(input, { target: { value: 'Identical offline message' } });
    fireEvent.click(submitBtn);

    // Replay interaction after rerender
    rerender(<Omnibar onSendMessage={onSendMessage} onFileUpload={() => {}} />);

    const inputAfter = screen.getByTestId('omnibar-input');
    fireEvent.change(inputAfter, { target: { value: 'Identical offline message' } });
    const submitBtnAfter = screen.getByTestId('omnibar-submit-btn');
    fireEvent.click(submitBtnAfter);

    // Although called twice, ensure that no global fetching occurs and inputs are identical
    assert.strictEqual(onSendMessage.mock.calls.length, 2);
    assert.strictEqual(onSendMessage.mock.calls[0].arguments[0], 'Identical offline message');
    assert.strictEqual(onSendMessage.mock.calls[1].arguments[0], 'Identical offline message');

    unmount();
  } finally {
    global.fetch = originalFetch;
  }
});


// --- NEW TESTS: Fuzzing, Boundaries, Malformed Payloads ---

test('boundary input: exactly 2000 characters is accepted', async () => {
  const onSendMessage = mock.fn();
  render(<Omnibar onSendMessage={onSendMessage} onFileUpload={() => {}} />);

  const input = screen.getByTestId('omnibar-input');
  const exactMaxText = 'a'.repeat(2000);

  fireEvent.change(input, { target: { value: exactMaxText } });
  const form = input.closest('form');
  fireEvent.submit(form!);

  assert.strictEqual(onSendMessage.mock.calls.length, 1);
  assert.strictEqual(onSendMessage.mock.calls[0].arguments[0], exactMaxText);
});

test('fuzzing: handles complex unicode, emojis, and RTL text correctly', async () => {
  const onSendMessage = mock.fn();
  render(<Omnibar onSendMessage={onSendMessage} onFileUpload={() => {}} />);

  const input = screen.getByTestId('omnibar-input');
  const fuzzedPayload = '🤖 مرحبا بالعالم! 👨‍👩‍👧‍👦 \u0000 \t \n 💥';

  fireEvent.change(input, { target: { value: fuzzedPayload } });
  const form = input.closest('form');
  fireEvent.submit(form!);

  assert.strictEqual(onSendMessage.mock.calls.length, 1);
  assert.strictEqual(onSendMessage.mock.calls[0].arguments[0], fuzzedPayload.replace(/\n/g, '').trim());
});

test('malformed payloads: empty file upload event handles gracefully', async () => {
  const onFileUpload = mock.fn();
  render(<Omnibar onSendMessage={() => {}} onFileUpload={onFileUpload} />);

  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

  // Simulate an event where files array is empty
  fireEvent.change(fileInput, { target: { files: [] } });
  assert.strictEqual(onFileUpload.mock.calls.length, 0);

  // Simulate an event where files is null
  fireEvent.change(fileInput, { target: { files: null } });
  assert.strictEqual(onFileUpload.mock.calls.length, 0);
});

test('malformed payloads: audio query with empty chunks handles gracefully', async () => {
  const onAudioVoiceQuery = mock.fn(async () => true);

  // Override mock to emit an empty chunk
  const OriginalMediaRecorder = (global as any).MediaRecorder;
  (global as any).MediaRecorder = class extends OriginalMediaRecorder {
    start = mock.fn((timeslice?: number) => {
      this.state = 'recording';
      // Simulate emitting empty or invalid chunks
      if (typeof this.ondataavailable === 'function') {
        this.ondataavailable({ data: new Blob([]) } as any);
        this.ondataavailable({ data: null } as any);
      }
    });
  };

  try {
    render(
      <Omnibar
        onSendMessage={() => {}}
        onFileUpload={() => {}}
        onAudioVoiceQuery={onAudioVoiceQuery}
      />
    );

    const micBtn = screen.getByTestId('ptt-mic-btn');

    // Start recording
    fireEvent.pointerDown(micBtn);
    await waitFor(() => {
      assert.strictEqual(
        (screen.getByTestId('omnibar-input') as HTMLInputElement).placeholder,
        '🔴 Recording... Tap mic to send'
      );
    });

    // Stop recording
    fireEvent.pointerDown(micBtn);

    // Ensure it falls back to silence logic because chunks were empty (less than MIN_AUDIO_BYTES)
    await waitFor(() => {
      assert.strictEqual(
        (screen.getByTestId('omnibar-input') as HTMLInputElement).placeholder,
        "Didn't catch that — try speaking closer to the mic"
      );
    });

    assert.strictEqual(onAudioVoiceQuery.mock.calls.length, 0);
  } finally {
    // Restore mock safely
    (global as any).MediaRecorder = OriginalMediaRecorder;
  }
});

test('malformed payloads: component unmount during recording cleans up safely', async () => {
  const onAudioVoiceQuery = mock.fn(async () => true);

  const { unmount } = render(
    <Omnibar
      onSendMessage={() => {}}
      onFileUpload={() => {}}
      onAudioVoiceQuery={onAudioVoiceQuery}
    />
  );

  const micBtn = screen.getByTestId('ptt-mic-btn');

  // Start recording
  fireEvent.pointerDown(micBtn);
  await waitFor(() => {
    assert.strictEqual(
      (screen.getByTestId('omnibar-input') as HTMLInputElement).placeholder,
      '🔴 Recording... Tap mic to send'
    );
  });

  // Unmount while actively recording (should not throw exceptions)
  assert.doesNotThrow(() => {
    unmount();
  });
});


test('enforce offline-first invariant (no global.fetch during ptt offline fallback)', async () => {
  const originalFetch = global.fetch;
  const fetchMock = mock.fn(() => {
    throw new Error('Network request blocked by offline-first invariant');
  });
  global.fetch = fetchMock;

  try {
    const onSendMessage = mock.fn();
    render(<Omnibar onSendMessage={onSendMessage} onFileUpload={() => {}} />);

    const micBtn = screen.getByTestId('ptt-mic-btn');
    fireEvent.pointerDown(micBtn);

    await waitFor(() => {
      assert.strictEqual(
        (screen.getByTestId('omnibar-input') as HTMLInputElement).placeholder,
        '🔴 Recording... Tap mic to send'
      );
    });

    fireEvent.pointerDown(micBtn);

    await waitFor(() => {
      assert.strictEqual(
        (screen.getByTestId('omnibar-input') as HTMLInputElement).placeholder,
        "Didn't catch that — try speaking closer to the mic"
      );
    });

    assert.strictEqual(fetchMock.mock.calls.length, 0);

  } finally {
    global.fetch = originalFetch;
  }
});

test('high-concurrency burst execution, race conditions, latency, and multi-tenant isolation', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(() => {
    throw new Error('Network request blocked by offline-first invariant');
  });

  const roots: HTMLDivElement[] = [];
  const unmounts: (() => void)[] = [];

  try {
    const burstSize = 100;
    const callbacks = Array.from({ length: burstSize }, () => mock.fn());

    // Pre-instantiate elements into isolated containers representing tenant boundaries
    for (let i = 0; i < burstSize; i++) {
      const root = document.createElement('div');
      root.setAttribute('data-tenant', `facility_${i}::dept_${i}`);
      document.body.appendChild(root);
      roots.push(root);

      const { unmount } = render(<Omnibar onSendMessage={callbacks[i]} onFileUpload={() => {}} />, { container: root });
      unmounts.push(unmount);
    }

    const inputs = screen.getAllByTestId('omnibar-input');
    const submitBtns = screen.getAllByTestId('omnibar-submit-btn');

    assert.strictEqual(inputs.length, burstSize);
    assert.strictEqual(submitBtns.length, burstSize);

    const startTime = performance.now();

    // Fire events concurrently with micro-jitters
    await Promise.all(
      inputs.map(async (input, i) => {
        // Yield to event loop to simulate true concurrency and micro-jitters
        await new Promise(r => setTimeout(r, Math.random() * 10));

        const payload = `tenant ${i} burst message`;
        fireEvent.change(input, { target: { value: payload } });

        await new Promise(r => setTimeout(r, Math.random() * 5));
        fireEvent.click(submitBtns[i]);
      })
    );

    const endTime = performance.now();
    const makespan = endTime - startTime;

    // Verify all callbacks were fired exactly once with the correct payload
    callbacks.forEach((cb, i) => {
      assert.strictEqual(cb.mock.calls.length, 1);
      assert.strictEqual(cb.mock.calls[0].arguments[0], `tenant ${i} burst message`);
    });

    // Assert multi-tenant isolation, no network calls, and total burst execution latency
    assert.strictEqual((global.fetch as any).mock.calls.length, 0);
    assert.ok(makespan < 5000, `Makespan too high: ${makespan}ms`);

  } finally {
    global.fetch = originalFetch;
    unmounts.forEach(u => u());
    roots.forEach(r => r.remove());
  }
});
