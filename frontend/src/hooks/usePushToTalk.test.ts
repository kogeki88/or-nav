import 'jsdom-global/register.js';
import { test, describe, beforeEach, mock } from 'node:test';
import * as assert from 'node:assert';
import { renderHook, waitFor, act } from '@testing-library/react';

// Use proxyquire to mock livekit-client and api
const proxyquire = require('proxyquire');

const mockMicrophoneEnabled = mock.fn(async () => {});
let mockRoomConnect = mock.fn(async () => {});
const mockRoomDisconnect = mock.fn();
const mockRoomOn = mock.fn();

class MockRoom {
  localParticipant = {
    setMicrophoneEnabled: mockMicrophoneEnabled,
  };
  on = mockRoomOn;
  connect = mockRoomConnect;
  disconnect = mockRoomDisconnect;
}

const mockRoomConstructor = mock.fn(function() { return new MockRoom(); });

let mockFetchVoiceStatus = mock.fn(async () => ({
  livekit_configured: true,
  mode: 'LIVEKIT_WEBRTC',
  livekit_url: 'wss://test.livekit'
}));

let mockFetchVoiceToken = mock.fn(async () => ({
  token: 'test-token',
  livekit_url: 'wss://test.livekit',
  room_name: 'test-room',
  tenant_id: 'test'
}));


const { usePushToTalk } = proxyquire('./usePushToTalk', {
  'livekit-client': {
    Room: class {
        localParticipant = {
            setMicrophoneEnabled: mockMicrophoneEnabled,
        };
        on = mockRoomOn;
        connect = mockRoomConnect;
        disconnect = mockRoomDisconnect;
        constructor() {
            mockRoomConstructor();
        }
    },
    RoomEvent: {
      DataReceived: 'dataReceived',
      Disconnected: 'disconnected',
    },
  },
  '@/lib/api': {
    fetchVoiceStatus: (...args: any) => mockFetchVoiceStatus(...args),
    fetchVoiceToken: (...args: any) => mockFetchVoiceToken(...args),
  }
});

describe('usePushToTalk', () => {
  beforeEach(() => {
    mock.restoreAll();
    mockMicrophoneEnabled.mock.resetCalls();
    mockRoomConnect = mock.fn(async () => {});
    mockRoomDisconnect.mock.resetCalls();
    mockRoomOn.mock.resetCalls();
    mockRoomConstructor.mock.resetCalls();

    mockFetchVoiceStatus = mock.fn(async () => ({
      livekit_configured: true,
      mode: 'LIVEKIT_WEBRTC',
      livekit_url: 'wss://test.livekit'
    }));

    mockFetchVoiceToken = mock.fn(async () => ({
      token: 'test-token',
      livekit_url: 'wss://test.livekit',
      room_name: 'test-room',
      tenant_id: 'test'
    }));
  });

  test('initial state with BROWSER_WEB_SPEECH mode', async () => {
    mockFetchVoiceStatus = mock.fn(async () => ({
      livekit_configured: false,
      mode: 'BROWSER_WEB_SPEECH',
      livekit_url: null
    }));

    const { result } = renderHook(() => usePushToTalk({ tenantId: 'test' }));

    assert.strictEqual(result.current.voiceMode, 'BROWSER_WEB_SPEECH');

    await waitFor(() => {
      assert.strictEqual(result.current.livekitConfigured, false);
    });

    assert.strictEqual(result.current.isConnected, false);
    assert.strictEqual(result.current.isHoldingPTT, false);
  });

  test('connects to LiveKit when LIVEKIT_WEBRTC mode is configured', async () => {
    const { result } = renderHook(() => usePushToTalk({ tenantId: 'test' }));

    await waitFor(() => {
      assert.strictEqual(result.current.livekitConfigured, true);
    });

    await waitFor(() => {
      assert.strictEqual(result.current.voiceMode, 'LIVEKIT_WEBRTC');
    });

    await waitFor(() => {
      assert.strictEqual(result.current.isConnected, true);
    });

    assert.strictEqual(mockRoomConstructor.mock.calls.length, 1);

    assert.strictEqual(mockRoomConnect.mock.calls.length, 1);
    assert.deepStrictEqual(mockRoomConnect.mock.calls[0].arguments, ['wss://test.livekit', 'test-token']);

    assert.strictEqual(mockMicrophoneEnabled.mock.calls.length, 1);
    assert.strictEqual(mockMicrophoneEnabled.mock.calls[0].arguments[0], false);
  });

  test('starts and stops PTT', async () => {
    const { result } = renderHook(() => usePushToTalk({ tenantId: 'test' }));

    await waitFor(() => {
      assert.strictEqual(result.current.isConnected, true);
    });

    await act(async () => {
      await result.current.startPTT();
    });

    assert.strictEqual(result.current.isHoldingPTT, true);
    assert.strictEqual(mockMicrophoneEnabled.mock.calls[1].arguments[0], true);

    await act(async () => {
      await result.current.stopPTT();
    });

    assert.strictEqual(result.current.isHoldingPTT, false);
    assert.strictEqual(mockMicrophoneEnabled.mock.calls[2].arguments[0], false);
  });

  test('toggles voice mode', async () => {
    const { result } = renderHook(() => usePushToTalk({ tenantId: 'test' }));

    await waitFor(() => {
      assert.strictEqual(result.current.voiceMode, 'LIVEKIT_WEBRTC');
    });

    act(() => {
      result.current.toggleVoiceMode();
    });

    assert.strictEqual(result.current.voiceMode, 'BROWSER_WEB_SPEECH');

    act(() => {
      result.current.toggleVoiceMode();
    });

    assert.strictEqual(result.current.voiceMode, 'LIVEKIT_WEBRTC');
  });

  test('disconnects and cleans up on unmount', async () => {
    const { unmount } = renderHook(() => usePushToTalk({ tenantId: 'test' }));

    await waitFor(() => {
      assert.strictEqual(mockRoomConnect.mock.calls.length, 1);
    });

    unmount();

    assert.strictEqual(mockRoomDisconnect.mock.calls.length, 1);
  });

  test('handles room error', async () => {
    mockRoomConnect = mock.fn(async () => {
      throw new Error('Connection failed');
    });

    const { result } = renderHook(() => usePushToTalk({ tenantId: 'test' }));

    await waitFor(() => {
      assert.strictEqual(result.current.roomError, 'Connection failed');
    });

    assert.strictEqual(result.current.voiceMode, 'BROWSER_WEB_SPEECH');
  });

  test('handles onDataChannelSync correctly', async () => {
    const onDataChannelSync = mock.fn();
    const { result } = renderHook(() => usePushToTalk({ tenantId: 'test', onDataChannelSync }));

    await waitFor(() => {
      assert.strictEqual(result.current.isConnected, true);
    });

    const dataReceivedCall = mockRoomOn.mock.calls.find(call => call.arguments[0] === 'dataReceived');
    const dataReceivedCallback = dataReceivedCall?.arguments[1] as Function;

    const payloadData = { test: 'data' };
    const payloadText = JSON.stringify(payloadData);
    const payload = new TextEncoder().encode(payloadText);

    act(() => {
      dataReceivedCallback(payload, null, null, 'or_nav_ui_sync');
    });

    assert.strictEqual(onDataChannelSync.mock.calls.length, 1);
    assert.deepStrictEqual(onDataChannelSync.mock.calls[0].arguments[0], payloadData);
  });

  test('offline-first invariant: falls back to BROWSER_WEB_SPEECH when fetchVoiceStatus fails', async () => {
    mockFetchVoiceStatus = mock.fn(async () => {
      throw new Error('Network offline');
    });

    const { result } = renderHook(() => usePushToTalk({ tenantId: 'test' }));

    assert.strictEqual(result.current.voiceMode, 'BROWSER_WEB_SPEECH');

    await waitFor(() => {
      assert.strictEqual(result.current.voiceMode, 'BROWSER_WEB_SPEECH');
      assert.strictEqual(result.current.livekitConfigured, false);
    });
  });

  test('offline-first invariant: falls back to BROWSER_WEB_SPEECH when fetchVoiceToken fails', async () => {
    mockFetchVoiceToken = mock.fn(async () => {
      throw new Error('Network offline');
    });

    const { result } = renderHook(() => usePushToTalk({ tenantId: 'test' }));

    await waitFor(() => {
      assert.strictEqual(result.current.livekitConfigured, true);
    });

    await waitFor(() => {
      assert.strictEqual(result.current.roomError, 'Network offline');
    });

    assert.strictEqual(result.current.voiceMode, 'BROWSER_WEB_SPEECH');
  });

  test('multi-tenant isolation: changing tenantId disconnects old room and reconnects to new room', async () => {
    const { result, rerender } = renderHook((props: { tenantId: string }) => usePushToTalk(props), {
      initialProps: { tenantId: 'tenant-a' },
    });

    await waitFor(() => {
      assert.strictEqual(result.current.isConnected, true);
    });

    assert.strictEqual(mockRoomConnect.mock.calls.length, 1);
    assert.deepStrictEqual(mockFetchVoiceToken.mock.calls[0].arguments, ['tenant-a']);

    // Change tenant
    rerender({ tenantId: 'tenant-b' });

    await waitFor(() => {
      // It should disconnect and reconnect, fetch token should be called with tenant-b
      assert.strictEqual(mockRoomDisconnect.mock.calls.length, 1);
      assert.strictEqual(mockFetchVoiceToken.mock.calls.length, 2);
      assert.deepStrictEqual(mockFetchVoiceToken.mock.calls[1].arguments, ['tenant-b']);
      assert.strictEqual(mockRoomConnect.mock.calls.length, 2);
    });
  });

  test('ignores malformed JSON payload on DataChannel without crashing', async () => {
    const onDataChannelSync = mock.fn();
    const { result } = renderHook(() => usePushToTalk({ tenantId: 'test', onDataChannelSync }));

    await waitFor(() => {
      assert.strictEqual(result.current.isConnected, true);
    });

    const dataReceivedCall = mockRoomOn.mock.calls.find(call => call.arguments[0] === 'dataReceived');
    const dataReceivedCallback = dataReceivedCall?.arguments[1];

    const malformedPayload = new TextEncoder().encode('{ invalid json ');

    act(() => {
      dataReceivedCallback(malformedPayload, null, null, 'or_nav_ui_sync');
    });

    assert.strictEqual(onDataChannelSync.mock.calls.length, 0);
  });

  test('ignores DataChannel payloads with wrong topic', async () => {
    const onDataChannelSync = mock.fn();
    const { result } = renderHook(() => usePushToTalk({ tenantId: 'test', onDataChannelSync }));

    await waitFor(() => {
      assert.strictEqual(result.current.isConnected, true);
    });

    const dataReceivedCall = mockRoomOn.mock.calls.find(call => call.arguments[0] === 'dataReceived');
    const dataReceivedCallback = dataReceivedCall?.arguments[1];

    const payload = new TextEncoder().encode('{"test": "data"}');

    act(() => {
      dataReceivedCallback(payload, null, null, 'wrong_topic');
    });

    assert.strictEqual(onDataChannelSync.mock.calls.length, 0);
  });

  test('boundary inputs: handles empty tenantId', async () => {
    const { result } = renderHook(() => usePushToTalk({ tenantId: '' }));

    await waitFor(() => {
      assert.strictEqual(result.current.isConnected, true);
    });

    assert.strictEqual(mockFetchVoiceToken.mock.calls.length, 1);
    assert.deepStrictEqual(mockFetchVoiceToken.mock.calls[0].arguments, ['']);
  });

  test('boundary inputs: handles extremely long tenantId', async () => {
    const longId = 'a'.repeat(10000);
    const { result } = renderHook(() => usePushToTalk({ tenantId: longId }));

    await waitFor(() => {
      assert.strictEqual(result.current.isConnected, true);
    });

    assert.strictEqual(mockFetchVoiceToken.mock.calls.length, 1);
    assert.deepStrictEqual(mockFetchVoiceToken.mock.calls[0].arguments, [longId]);
  });

  test('handles non-Error string thrown during LiveKit connection', async () => {
    mockRoomConnect = mock.fn(async () => {
      throw 'String connection error';
    });

    const { result } = renderHook(() => usePushToTalk({ tenantId: 'test' }));

    await waitFor(() => {
      assert.strictEqual(result.current.roomError, 'Failed to connect to LiveKit Room');
    });

    assert.strictEqual(result.current.voiceMode, 'BROWSER_WEB_SPEECH');
  });

  test('handles malformed fetchVoiceStatus response gracefully', async () => {
    mockFetchVoiceStatus = mock.fn(async () => ({
      livekit_configured: null,
      mode: null,
      livekit_url: undefined
    }));

    const { result } = renderHook(() => usePushToTalk({ tenantId: 'test' }));

    await waitFor(() => {
      assert.strictEqual(result.current.voiceMode, 'BROWSER_WEB_SPEECH');
      assert.strictEqual(result.current.livekitConfigured, null);
    });

    assert.strictEqual(result.current.isConnected, false);
  });

  test("high-concurrency and race condition resistance for startPTT", async () => {
    const hooks: any[] = [];

    // Mount all inside act and let initial fetchVoiceStatus resolve
    await act(async () => {
      for (let i = 0; i < 10; i++) {
        hooks.push(renderHook(() => usePushToTalk({ tenantId: "test" })));
      }
      await new Promise(r => setTimeout(r, 50));
    });

    for (const hook of hooks) {
      await waitFor(() => {
        assert.strictEqual(hook.result.current.isConnected, true);
      });
    }

    const startCount = mockMicrophoneEnabled.mock.calls.length;

    await act(async () => {
      await Promise.all(hooks.map(async (hook) => {
        await new Promise(r => setTimeout(r, Math.random() * 10));
        await hook.result.current.startPTT();
      }));
    });

    for (const hook of hooks) {
      assert.strictEqual(hook.result.current.isHoldingPTT, true);
    }

    const newCalls = mockMicrophoneEnabled.mock.calls.slice(startCount);
    assert.strictEqual(newCalls.length, 10);
    for (const call of newCalls) {
      assert.strictEqual(call.arguments[0], true);
    }
  });

  test("multi-tenant isolation and offline-first invariants under concurrent load", async () => {
    const originalMockFetchVoiceToken = mockFetchVoiceToken;
    try {
      mockFetchVoiceToken = mock.fn(async (tenantId?: string) => {
        if (tenantId && tenantId.includes("offline-tenant")) {
          throw new Error("Network error for offline tenant");
        }
        return {
          token: "test-token",
          livekit_url: "wss://test.livekit",
          room_name: "test-room",
          tenant_id: tenantId || "test"
        };
      });

      const hooks: any[] = [];

      // Mount all inside act and let initial fetchVoiceStatus and fetchVoiceToken resolve/reject
      await act(async () => {
        for (let i = 0; i < 4; i++) {
          const tenantId = i % 2 === 0 ? "offline-tenant-" + i : "online-tenant-" + i;
          hooks.push(renderHook(() => usePushToTalk({ tenantId })));
        }
        // Yield enough time for fetchVoiceToken rejection to process the catch block
        await new Promise(r => setTimeout(r, 100));
      });

      for (let i = 0; i < hooks.length; i++) {
        const hook = hooks[i];
        const tenantId = i % 2 === 0 ? "offline-tenant-" + i : "online-tenant-" + i;

        if (tenantId.startsWith("offline-tenant")) {
          await waitFor(() => {
            assert.strictEqual(hook.result.current.roomError, "Network error for offline tenant");
            assert.strictEqual(hook.result.current.voiceMode, "BROWSER_WEB_SPEECH");
          });
        } else {
          await waitFor(() => {
            assert.strictEqual(hook.result.current.voiceMode, "LIVEKIT_WEBRTC");
          });
        }
      }
    } finally {
      mockFetchVoiceToken = originalMockFetchVoiceToken;
    }
  });

  test("offline mutation replay idempotency and multi-tenant boundary isolation for startPTT", async () => {
    const originalMockFetchVoiceToken = mockFetchVoiceToken;
    const originalFetch = global.fetch;

    // To test multi-tenant boundary enforcement and ensure complete isolation
    // in React hook testing, render the hooks into separate, isolated DOM nodes
    // configured with data-tenant attributes to mimic boundary enforcement,
    // ensuring cleanup in a finally block.
    const root1 = document.createElement("div");
    root1.setAttribute("data-tenant", "facility_1::dept_A");
    document.body.appendChild(root1);

    const root2 = document.createElement("div");
    root2.setAttribute("data-tenant", "facility_2::dept_B");
    document.body.appendChild(root2);

    try {
      global.fetch = (() => { throw new Error("Offline fetch"); }) as any;
      mockFetchVoiceToken = mock.fn(async () => {
        throw new Error("Network offline");
      });

      const { result: result1 } = renderHook(() => usePushToTalk({ tenantId: "facility_1::dept_A" }), { container: root1 });
      const { result: result2 } = renderHook(() => usePushToTalk({ tenantId: "facility_2::dept_B" }), { container: root2 });

      await waitFor(() => {
        assert.strictEqual(result1.current.voiceMode, "BROWSER_WEB_SPEECH");
        assert.strictEqual(result2.current.voiceMode, "BROWSER_WEB_SPEECH");
      });

      // Sequential invocation to assert offline mutation replay idempotency
      // for startPTT. Assert that the output state remains strictly equal
      // to the state after the first execution.

      // First execution
      await act(async () => {
        await result1.current.startPTT();
      });
      const state1 = { ...result1.current };
      assert.strictEqual(state1.isHoldingPTT, true);

      // Replays
      for (let i = 0; i < 3; i++) {
        await act(async () => {
          await result1.current.startPTT();
        });

        // Assert output state remains strictly equal to the state after first execution
        // We omit functions since they might be recreated or irrelevant to pure state checks,
        // but since we spread, we check values.
        assert.strictEqual(result1.current.isHoldingPTT, state1.isHoldingPTT);
        assert.strictEqual(result1.current.voiceMode, state1.voiceMode);
        assert.strictEqual(result1.current.isConnected, state1.isConnected);
        assert.strictEqual(result1.current.roomError, state1.roomError);
      }

      // Stop PTT
      await act(async () => {
        await result1.current.stopPTT();
      });
      const stateStopped = { ...result1.current };
      assert.strictEqual(stateStopped.isHoldingPTT, false);

      for (let i = 0; i < 3; i++) {
        await act(async () => {
          await result1.current.stopPTT();
        });
        assert.strictEqual(result1.current.isHoldingPTT, stateStopped.isHoldingPTT);
      }

      // Ensure result2 was completely unimpacted by result1's actions
      assert.strictEqual(result2.current.isHoldingPTT, false);
      assert.strictEqual(result2.current.voiceMode, "BROWSER_WEB_SPEECH");

    } finally {
      mockFetchVoiceToken = originalMockFetchVoiceToken;
      global.fetch = originalFetch;

      document.body.removeChild(root1);
      document.body.removeChild(root2);
    }
  });
});
