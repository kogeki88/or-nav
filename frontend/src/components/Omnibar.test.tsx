import 'jsdom-global/register';
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
