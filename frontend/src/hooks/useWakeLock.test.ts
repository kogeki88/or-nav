import 'jsdom-global/register';
import { renderHook } from "@testing-library/react";
import { useWakeLock } from "./useWakeLock";
import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

describe("useWakeLock", () => {
  let mockRequest: any;
  let mockRelease: any;
  let mockAddEventListener: any;

  beforeEach(() => {
    mockRelease = mock.fn(async () => undefined);
    mockAddEventListener = mock.fn();
    mockRequest = mock.fn(async () => ({
      addEventListener: mockAddEventListener,
      release: mockRelease,
      released: false,
    }));

    Object.defineProperty(global.navigator, "wakeLock", {
      value: {
        request: mockRequest,
      },
      writable: true,
      configurable: true,
    });

    mock.method(console, 'debug', () => {});
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("should acquire wake lock when enabled", async () => {
    renderHook(() => useWakeLock(true));

    await Promise.resolve();

    assert.strictEqual(mockRequest.mock.calls.length, 1);
    assert.strictEqual(mockRequest.mock.calls[0].arguments[0], "screen");
  });

  it("should release wake lock when disabled", async () => {
    const { rerender } = renderHook((props) => useWakeLock(props.enabled), {
      initialProps: { enabled: true }
    });

    await Promise.resolve();

    rerender({ enabled: false });

    await Promise.resolve();

    assert.ok(mockRelease.mock.calls.length >= 1);
  });

  it("should re-acquire wake lock on visibility change if visible and enabled and lock was released", async () => {
    renderHook(() => useWakeLock(true));
    await Promise.resolve();

    assert.strictEqual(mockRequest.mock.calls.length, 1);

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true
    });

    const releaseCallback = mockAddEventListener.mock.calls.find(
      (call: any) => call.arguments[0] === 'release'
    )?.arguments[1];

    if (releaseCallback) {
      releaseCallback();
    }

    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    assert.strictEqual(mockRequest.mock.calls.length, 2);
  });

  it("should not re-acquire wake lock on visibility change if visible but disabled", async () => {
    renderHook(() => useWakeLock(false));
    await Promise.resolve();

    assert.strictEqual(mockRequest.mock.calls.length, 0);

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true
    });

    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    assert.strictEqual(mockRequest.mock.calls.length, 0);
  });

  it("should clean up event listeners on unmount", async () => {
    const removeEventListenerSpy = mock.method(document, 'removeEventListener');

    const { unmount } = renderHook(() => useWakeLock(true));
    await Promise.resolve();

    unmount();

    assert.ok(removeEventListenerSpy.mock.calls.some((c: any) => c.arguments[0] === 'visibilitychange'));
    assert.ok(mockRelease.mock.calls.length >= 1);
  });

  it("should gracefully handle request failures", async () => {
    const error = new Error("NotAllowedError");
    mockRequest = mock.fn(async () => {
      throw error;
    });
    Object.defineProperty(global.navigator, "wakeLock", {
      value: { request: mockRequest },
      writable: true,
      configurable: true,
    });

    renderHook(() => useWakeLock(true));
    await Promise.resolve();

    assert.strictEqual(mockRequest.mock.calls.length, 1);
  });
});
