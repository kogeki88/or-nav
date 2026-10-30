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

  beforeEach(() => {
    originalWindow = global.window;

    // Mock window and localStorage
    const mockLocalStorage = new LocalStorageMock();
    (global as { window?: unknown }).window = {
      dispatchEvent: () => {},
    };
    (global as { localStorage?: unknown }).localStorage = mockLocalStorage;
  });

  afterEach(() => {
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
});
