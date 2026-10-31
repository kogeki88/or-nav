import { test, describe, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import {
  getAppSettings,
  saveAppSettings,
  DEFAULT_APP_SETTINGS,
  APP_SETTINGS_STORAGE_KEY,
} from './appSettings';

// A simple mock for localStorage
class LocalStorageMock {
  private store: Record<string, string> = {};

  getItem(key: string): string | null {
    return this.store[key] || null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = value.toString();
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  clear(): void {
    this.store = {};
  }
}

describe('appSettings', () => {
  let originalWindow: unknown;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalWindow = global.window;
    originalFetch = global.fetch;

    // Poison global.fetch to strictly enforce offline-first and pure local invariants
    global.fetch = () => {
      throw new Error("Network call detected! appSettings must remain offline-first and fully local.");
    };

    // Mock window and localStorage
    const mockLocalStorage = new LocalStorageMock();
    (global as { window?: unknown }).window = {
      dispatchEvent: () => {},
    };
    (global as { localStorage?: unknown }).localStorage = mockLocalStorage;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    (global as { window?: unknown }).window = originalWindow;
    if (originalWindow === undefined) {
      delete (global as { localStorage?: unknown }).localStorage;
    }
  });

  test('returns default settings when localStorage is empty', () => {
    localStorage.clear();
    const settings = getAppSettings();
    assert.deepStrictEqual(settings, DEFAULT_APP_SETTINGS);
  });

  test('saves and reads settings correctly', () => {
    localStorage.clear();

    // Save new values
    const newSettings = {
      darkMode: true,
      voiceSettings: 'high',
      fontScaling: 1.5,
    };

    saveAppSettings(newSettings);

    const settings = getAppSettings();

    // Assert updated values
    assert.strictEqual(settings.darkMode, true);
    assert.strictEqual(settings.voiceSettings, 'high');
    assert.strictEqual(settings.fontScaling, 1.5);

    // Assert other fields remain defaults
    assert.strictEqual(settings.autoUpdateEnabled, DEFAULT_APP_SETTINGS.autoUpdateEnabled);
    assert.strictEqual(settings.autoSyncEnabled, DEFAULT_APP_SETTINGS.autoSyncEnabled);
  });

  test('handles partial updates correctly', () => {
    localStorage.clear();

    // First save some baseline non-default values
    saveAppSettings({
      darkMode: true,
      voiceSettings: 'low',
    });

    // Now do a partial update
    saveAppSettings({
      autoSyncEnabled: false,
    });

    const settings = getAppSettings();

    // Check updated value
    assert.strictEqual(settings.autoSyncEnabled, false);

    // Check that previous values are preserved
    assert.strictEqual(settings.darkMode, true);
    assert.strictEqual(settings.voiceSettings, 'low');

    // Check that untouched fields are still default
    assert.strictEqual(settings.fontScaling, DEFAULT_APP_SETTINGS.fontScaling);
    assert.strictEqual(settings.autoUpdateEnabled, DEFAULT_APP_SETTINGS.autoUpdateEnabled);
  });

  test('handles invalid values in localStorage gracefully', () => {
    localStorage.clear();

    // Save corrupted data directly to mock localStorage
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({
      darkMode: "not-a-boolean",
      fontScaling: "large",
      voiceSettings: 123
    }));

    const settings = getAppSettings();

    // Should fall back to default values for invalid types
    assert.strictEqual(settings.darkMode, DEFAULT_APP_SETTINGS.darkMode);
    assert.strictEqual(settings.fontScaling, DEFAULT_APP_SETTINGS.fontScaling);
    assert.strictEqual(settings.voiceSettings, DEFAULT_APP_SETTINGS.voiceSettings);
  });

  test('resists malformed JSON payloads in localStorage', () => {
    localStorage.clear();

    const malformedPayloads = [
      '{',
      'undefined',
      'null',
      '""',
      '123',
      '{"darkMode": true',
      '[1, 2, 3]',
      '{"__proto__": {"malicious": "yes"}}'
    ];

    for (const payload of malformedPayloads) {
      localStorage.setItem(APP_SETTINGS_STORAGE_KEY, payload);
      const settings = getAppSettings();
      assert.deepStrictEqual(settings, DEFAULT_APP_SETTINGS, `Failed on payload: ${payload}`);
    }
  });

  test('fuzzing saveAppSettings with malicious or malformed inputs', () => {
    localStorage.clear();

    const maliciousInputs: any[] = [
      null,
      undefined,
      "string_instead_of_object",
      123,
      [],
      { __proto__: { evil: true } },
      { constructor: { prototype: { evil: true } } },
      { autoUpdateEnabled: null },
      { darkMode: undefined },
      { fontScaling: "1.0" },
      { voiceSettings: { complex: 'object' } },
      { autoSyncEnabled: [true] }
    ];

    for (const input of maliciousInputs) {
      try {
        saveAppSettings(input);
      } catch (e) {
        // Just verify it doesn't crash on any weird input
      }
      // Ensure we don't accidentally merge these bad types over defaults
      const current = getAppSettings();
      assert.strictEqual(typeof current.autoUpdateEnabled, 'boolean');
      assert.strictEqual(typeof current.autoSyncEnabled, 'boolean');
      assert.strictEqual(typeof current.darkMode, 'boolean');
      assert.strictEqual(typeof current.fontScaling, 'number');
      assert.strictEqual(typeof current.voiceSettings, 'string');
    }
  });

  test('handles boundary inputs for numeric and string values', () => {
    localStorage.clear();

    // Test numbers
    const boundaryNumbers = [
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
      NaN,
      Infinity,
      -Infinity,
      0.000000001
    ];

    for (const num of boundaryNumbers) {
      saveAppSettings({ fontScaling: num });
      const current = getAppSettings();
      // Implementation uses generic typeof number, so NaN/Infinity might be preserved if they are stored as numbers,
      // but JSON.stringify converts NaN and Infinity to null.
      if (Number.isNaN(num) || !Number.isFinite(num)) {
         assert.strictEqual(current.fontScaling, DEFAULT_APP_SETTINGS.fontScaling);
      } else {
         assert.strictEqual(current.fontScaling, num);
      }
    }

    // Test strings
    const boundaryStrings = [
      "",
      "a".repeat(10000), // Huge string
      "   ",
      "\0\0\0\0",
      "🤖👾", // Unicode emojis
      "<script>alert('xss')</script>" // XSS attempts
    ];

    for (const str of boundaryStrings) {
      saveAppSettings({ voiceSettings: str });
      const current = getAppSettings();
      assert.strictEqual(current.voiceSettings, str);
    }
  });

  test('getAppSettings returns default settings when window is undefined', () => {
    const originalWindow = (global as { window?: unknown }).window;
    (global as { window?: unknown }).window = undefined;
    const settings = getAppSettings();
    assert.deepStrictEqual(settings, DEFAULT_APP_SETTINGS);
    (global as { window?: unknown }).window = originalWindow;
  });

  test('saveAppSettings returns merged settings when window is undefined', () => {
    const originalWindow = (global as { window?: unknown }).window;
    (global as { window?: unknown }).window = undefined;
    const newSettings = { darkMode: true };
    const settings = saveAppSettings(newSettings);
    assert.strictEqual(settings.darkMode, true);
    assert.strictEqual(settings.fontScaling, DEFAULT_APP_SETTINGS.fontScaling);
    (global as { window?: unknown }).window = originalWindow;
  });

  test('saveAppSettings dispatches a CustomEvent on window', () => {
    localStorage.clear();
    let dispatchedEvent: CustomEvent | null = null;

    const originalWindow = (global as { window?: unknown }).window;

    // Mock the global CustomEvent
    const OriginalCustomEvent = global.CustomEvent;
    (global as { CustomEvent?: unknown }).CustomEvent = class MockCustomEvent {
      type: string;
      detail: unknown;
      constructor(type: string, options?: { detail: unknown }) {
        this.type = type;
        this.detail = options?.detail;
      }
    };

    (global as { window?: unknown }).window = {
      dispatchEvent: (event: CustomEvent) => {
        dispatchedEvent = event;
      },
    };

    saveAppSettings({ fontScaling: 2.0 });

    assert.ok(dispatchedEvent);
    assert.strictEqual((dispatchedEvent as CustomEvent).type, 'ornav_app_settings_updated');
    assert.strictEqual((dispatchedEvent as any).detail.fontScaling, 2.0);

    // Restore OriginalCustomEvent
    (global as { CustomEvent?: unknown }).CustomEvent = OriginalCustomEvent;
    // Restore window
    (global as { window?: unknown }).window = originalWindow;
  });

  test('getAppSettings returns default settings when localStorage.getItem throws', () => {
    const originalLocalStorage = (global as { localStorage?: unknown }).localStorage;
    // Override localStorage mock to throw
    (global as { localStorage?: unknown }).localStorage = {
      getItem: () => { throw new Error('Quota exceeded'); },
    };

    const settings = getAppSettings();
    assert.deepStrictEqual(settings, DEFAULT_APP_SETTINGS);
    (global as { localStorage?: unknown }).localStorage = originalLocalStorage;
  });

  test('saveAppSettings returns merged settings when localStorage.setItem throws', () => {
    const originalLocalStorage = (global as { localStorage?: unknown }).localStorage;
    // Override localStorage mock to throw
    (global as { localStorage?: unknown }).localStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('Quota exceeded'); },
    };

    const newSettings = { darkMode: true };
    const settings = saveAppSettings(newSettings);
    assert.strictEqual(settings.darkMode, true);
    assert.strictEqual(settings.fontScaling, DEFAULT_APP_SETTINGS.fontScaling);
    (global as { localStorage?: unknown }).localStorage = originalLocalStorage;
  });

  test('concurrent burst execution and race condition resistance', async () => {
    localStorage.clear();
    const iterations = 100;
    const promises = [];

    for (let i = 0; i < iterations; i++) {
      promises.push(
        new Promise<void>((resolve) => {
          setTimeout(() => {
            const current = getAppSettings();
            saveAppSettings({
              fontScaling: current.fontScaling + 0.01,
              darkMode: i % 2 === 0,
            });
            resolve();
          }, Math.random() * 10);
        })
      );
    }

    await Promise.all(promises);

    const finalSettings = getAppSettings();
    assert.strictEqual(typeof finalSettings.fontScaling, 'number');
    assert.ok(finalSettings.fontScaling > 1.0);
    assert.strictEqual(typeof finalSettings.darkMode, 'boolean');
    assert.strictEqual(finalSettings.autoUpdateEnabled, DEFAULT_APP_SETTINGS.autoUpdateEnabled);
  });

  test('latency benchmark for rapid consecutive reads and writes', () => {
    localStorage.clear();
    const iterations = 10000;

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      saveAppSettings({
        fontScaling: 1.0 + (i / iterations),
        voiceSettings: `voice-${i}`
      });
      getAppSettings();
    }
    const end = performance.now();

    const duration = end - start;
    assert.ok(duration < 1000, `Latency benchmark failed: took ${duration}ms, expected < 1000ms`);

    const finalSettings = getAppSettings();
    assert.strictEqual(finalSettings.voiceSettings, `voice-${iterations - 1}`);
  });
});
