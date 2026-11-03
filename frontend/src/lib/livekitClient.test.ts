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

  it("should enforce multi-tenant isolation by ensuring one visualizer's state does not leak into another", () => {
    const canvas1 = document.createElement('canvas');
    const canvas2 = document.createElement('canvas');
    canvas1.getContext = () => ({} as unknown as CanvasRenderingContext2D);
    canvas2.getContext = () => ({} as unknown as CanvasRenderingContext2D);

    const visualizer1 = new LiveKitAudioVisualizer(canvas1);
    const visualizer2 = new LiveKitAudioVisualizer(canvas2);

    const mockTrack1 = new MockAudioTrack();
    const mockTrack2 = new MockAudioTrack();

    visualizer1.start(mockTrack1 as unknown as LocalAudioTrack);

    // Verify visualizer1 has animation frame, visualizer2 does not
    assert.notStrictEqual((visualizer1 as unknown as { animationFrameId: number | null }).animationFrameId, null);
    assert.strictEqual((visualizer2 as unknown as { animationFrameId: number | null }).animationFrameId, null);

    visualizer2.start(mockTrack2 as unknown as LocalAudioTrack);
    assert.notStrictEqual((visualizer2 as unknown as { animationFrameId: number | null }).animationFrameId, null);

    visualizer1.dispose();

    // visualizer1 should be stopped (animationFrameId = null)
    assert.strictEqual((visualizer1 as unknown as { animationFrameId: number | null }).animationFrameId, null);

    // visualizer2 should still be running
    assert.notStrictEqual((visualizer2 as unknown as { animationFrameId: number | null }).animationFrameId, null);

    visualizer2.dispose();
  });

  it("should enforce offline-first invariants by operating correctly even if global.fetch fails (simulating network disconnect)", async () => {
    const originalFetch = global.fetch;
    try {
      global.fetch = (async () => {
        throw new Error('Network offline');
      }) as any;

      const canvas = document.createElement('canvas');
      canvas.getContext = () => ({} as unknown as CanvasRenderingContext2D);
      const visualizer = new LiveKitAudioVisualizer(canvas);
      const mockTrack = new MockAudioTrack();

      // Start should work and not crash
      visualizer.start(mockTrack as unknown as LocalAudioTrack);
      assert.notStrictEqual((visualizer as unknown as { animationFrameId: number | null }).animationFrameId, null);
      assert.strictEqual(mockTrack.getListeners('muted').length, 1);

      visualizer.dispose();
      assert.strictEqual((visualizer as unknown as { animationFrameId: number | null }).animationFrameId, null);

    } finally {
      global.fetch = originalFetch;
    }
  });
  it("should handle boundary inputs and fuzzing gracefully (null/undefined inputs)", () => {
    // 1. null canvas
    try {
      new LiveKitAudioVisualizer(null as any);
      assert.fail("Should have thrown error on null canvas");
    } catch (e: any) {
      assert.match(e.message, /Invalid canvas element provided/);
    }

    // 2. undefined canvas
    try {
      new LiveKitAudioVisualizer(undefined as any);
      assert.fail("Should have thrown error on undefined canvas");
    } catch (e: any) {
      assert.match(e.message, /Invalid canvas element provided/);
    }

    // 3. invalid canvas object missing getContext
    try {
      new LiveKitAudioVisualizer({} as HTMLCanvasElement);
      assert.fail("Should have thrown error on invalid canvas");
    } catch (e: any) {
      assert.match(e.message, /Invalid canvas element provided/);
    }

    const canvas = document.createElement('canvas');
    canvas.getContext = () => ({} as unknown as CanvasRenderingContext2D);
    const visualizer = new LiveKitAudioVisualizer(canvas);

    // 4. null track passed to start
    try {
      visualizer.start(null as any);
      assert.fail("Should have thrown error on null track");
    } catch (e: any) {
      assert.match(e.message, /Invalid audio track provided/);
    }
  });
});

describe("Fuzzing & Invariants", () => {
  it("should implement strict schema validation and fuzzing for tenant IDs via Zod and fast-check", async () => {
    const fc = (await import('fast-check')).default || await import('fast-check');
    const { ZodError } = await import('zod');

    const canvas = document.createElement('canvas');
    canvas.getContext = () => ({} as unknown as CanvasRenderingContext2D);
    const visualizer = new LiveKitAudioVisualizer(canvas);

    // Schema validation - valid UUID
    visualizer.setTenantId('facility_a::or_main');
    assert.strictEqual(visualizer.getTenantId(), 'facility_a::or_main');

    // Fuzzing with fast-check to ensure malformed inputs are caught by Zod
    fc.assert(
      fc.property(fc.string().filter(s => !/^[a-zA-Z0-9_]+::[a-zA-Z0-9_]+$/.test(s)), (invalidTenantId) => {
        try {
          visualizer.setTenantId(invalidTenantId);
          return false; // Should not reach here
        } catch (e) {
          return e instanceof ZodError;
        }
      })
    );
  });

  it("should enforce multi-tenant boundary (facility_id::dept_id) and offline mutation replay idempotency", async () => {
    const originalFetch = global.fetch;
    try {
      // @ts-ignore
      global.fetch = mock.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as any;
      const canvas = document.createElement('canvas');
      canvas.getContext = () => ({} as unknown as CanvasRenderingContext2D);
      const visualizer = new LiveKitAudioVisualizer(canvas);

      const tenantAId = "facility_a::dept_1";

      visualizer.setTenantId(tenantAId);
      assert.strictEqual(visualizer.getTenantId(), tenantAId);

      // Replaying the mutation multiple times (offline idempotency)
      visualizer.setTenantId(tenantAId);
      visualizer.setTenantId(tenantAId);
      assert.strictEqual(visualizer.getTenantId(), tenantAId);

      try {
        visualizer.setTenantId("invalid_format");
        assert.fail("Should throw on invalid format");
      } catch (e: any) {
        assert.match(e.message, /Invalid tenant ID format/);
      }

      // Ensure state didn't leak or reset improperly on failed mutations
      assert.strictEqual(visualizer.getTenantId(), tenantAId);

    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("Fault Injection, Network Partition & Self-Healing", () => {
  let originalRequestAnimationFrame: typeof global.requestAnimationFrame;
  let originalCancelAnimationFrame: typeof global.cancelAnimationFrame;
  let requestAnimationFrameSpy: ReturnType<typeof mock.fn>;
  let cancelAnimationFrameSpy: ReturnType<typeof mock.fn>;

  beforeEach(() => {
    originalRequestAnimationFrame = global.requestAnimationFrame;
    originalCancelAnimationFrame = global.cancelAnimationFrame;

    requestAnimationFrameSpy = mock.fn((cb: FrameRequestCallback) => 123);
    cancelAnimationFrameSpy = mock.fn((id: number) => { return; });

    global.requestAnimationFrame = requestAnimationFrameSpy as unknown as typeof global.requestAnimationFrame;
    global.cancelAnimationFrame = cancelAnimationFrameSpy as unknown as typeof global.cancelAnimationFrame;
  });

  afterEach(() => {
    mock.restoreAll();
    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("should handle intermittent network degradation and self-heal on reconnection", async () => {
    const canvas = document.createElement('canvas');
    canvas.getContext = () => ({} as unknown as CanvasRenderingContext2D);
    const visualizer = new LiveKitAudioVisualizer(canvas);
    const mockTrack = new MockAudioTrack();

    visualizer.start(mockTrack as unknown as LocalAudioTrack);
    assert.strictEqual(requestAnimationFrameSpy.mock.calls.length, 1);

    // Simulate network partition/degradation causing 'muted'
    const mutedListeners = mockTrack.getListeners('muted');
    assert.strictEqual(mutedListeners.length, 1);
    mutedListeners[0]();

    // verify stopped
    assert.strictEqual((visualizer as unknown as { animationFrameId: number | null }).animationFrameId, null);
    assert.strictEqual(cancelAnimationFrameSpy.mock.calls.length, 1);

    // Simulate self-healing on network recovery causing 'unmuted'
    const unmutedListeners = mockTrack.getListeners('unmuted');
    assert.strictEqual(unmutedListeners.length, 1);
    unmutedListeners[0]();

    // verify started again
    assert.strictEqual(requestAnimationFrameSpy.mock.calls.length, 2);
    assert.notStrictEqual((visualizer as unknown as { animationFrameId: number | null }).animationFrameId, null);

    visualizer.dispose();
  });

  it("should handle out-of-order or duplicate event sequences gracefully without crashing or leaking timers", async () => {
    const canvas = document.createElement('canvas');
    canvas.getContext = () => ({} as unknown as CanvasRenderingContext2D);
    const visualizer = new LiveKitAudioVisualizer(canvas);
    const mockTrack = new MockAudioTrack();

    visualizer.start(mockTrack as unknown as LocalAudioTrack);

    const mutedListeners = mockTrack.getListeners('muted');
    const unmutedListeners = mockTrack.getListeners('unmuted');

    // Multiple unmuted events while already running
    unmutedListeners[0]();
    unmutedListeners[0]();
    assert.strictEqual(requestAnimationFrameSpy.mock.calls.length, 1); // should not trigger new timer

    // Multiple muted events
    mutedListeners[0]();
    mutedListeners[0]();
    assert.strictEqual(cancelAnimationFrameSpy.mock.calls.length, 1); // Only gets called once because stop sets it to null
    assert.strictEqual((visualizer as unknown as { animationFrameId: number | null }).animationFrameId, null);

    // Recovery
    unmutedListeners[0]();
    assert.strictEqual(requestAnimationFrameSpy.mock.calls.length, 2);

    visualizer.dispose();
  });
});
