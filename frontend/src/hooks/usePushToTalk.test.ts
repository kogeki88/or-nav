import 'jsdom-global/register.js';
import { test, describe, beforeEach, mock } from 'node:test';
import * as assert from 'node:assert';
import { renderHook, waitFor, act } from '@testing-library/react';

// Use proxyquire to mock livekit-client and api
import proxyquire from 'proxyquire';

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
});
