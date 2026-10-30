import 'jsdom-global/register';
import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { LiveKitAudioVisualizer } from "./livekitClient";
import type { LocalAudioTrack } from "livekit-client";

// Mock LiveKit track
class MockAudioTrack {
  private listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  on(event: string, callback: (...args: unknown[]) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  off(event: string, callback: (...args: unknown[]) => void) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
  }

  getListeners(event: string) {
    return this.listeners[event] || [];
  }
}

describe("LiveKitAudioVisualizer Client Cleanup", () => {
  let originalRequestAnimationFrame: typeof global.requestAnimationFrame;
  let originalCancelAnimationFrame: typeof global.cancelAnimationFrame;
  let requestAnimationFrameSpy: ReturnType<typeof mock.fn>;
  let cancelAnimationFrameSpy: ReturnType<typeof mock.fn>;

  beforeEach(() => {
    originalRequestAnimationFrame = global.requestAnimationFrame;
    originalCancelAnimationFrame = global.cancelAnimationFrame;

    // Setup requestAnimationFrame / cancelAnimationFrame globals
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    requestAnimationFrameSpy = mock.fn((cb: FrameRequestCallback) => {
      return 123; // mock timer id
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    cancelAnimationFrameSpy = mock.fn((id: number) => { return; });

    global.requestAnimationFrame = requestAnimationFrameSpy as unknown as typeof global.requestAnimationFrame;
    global.cancelAnimationFrame = cancelAnimationFrameSpy as unknown as typeof global.cancelAnimationFrame;
  });

  afterEach(() => {
    mock.restoreAll();
    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("should ensure WebRTC audio track disconnect cleans up requestAnimationFrame properly", () => {
    const canvas = document.createElement('canvas');
    canvas.getContext = () => ({} as unknown as CanvasRenderingContext2D);
    const visualizer = new LiveKitAudioVisualizer(canvas);
    const mockTrack = new MockAudioTrack();

    visualizer.start(mockTrack as unknown as LocalAudioTrack);

    // Verify it started requesting frames
    assert.strictEqual(requestAnimationFrameSpy.mock.calls.length, 1);
    assert.strictEqual(mockTrack.getListeners('muted').length, 1);

    // Act: Dispose/disconnect the visualizer on unmount
    visualizer.disconnect();

    // Verify cleanup
    assert.strictEqual(cancelAnimationFrameSpy.mock.calls.length, 1);
    assert.strictEqual(cancelAnimationFrameSpy.mock.calls[0].arguments[0], 123);
    assert.strictEqual(mockTrack.getListeners('muted').length, 0);
  });

  it("should ensure zero lingering intervals or event listeners on dispose", () => {
    const canvas = document.createElement('canvas');
    canvas.getContext = () => ({} as unknown as CanvasRenderingContext2D);
    const visualizer = new LiveKitAudioVisualizer(canvas);
    const mockTrack = new MockAudioTrack();

    visualizer.start(mockTrack as unknown as LocalAudioTrack);
    visualizer.dispose();

    // Context should be nulled out to avoid memory leaks
    assert.strictEqual((visualizer as unknown as { canvasCtx: CanvasRenderingContext2D | null }).canvasCtx, null);
    assert.strictEqual((visualizer as unknown as { animationFrameId: number | null }).animationFrameId, null);
    assert.strictEqual(mockTrack.getListeners('muted').length, 0);
  });
});
