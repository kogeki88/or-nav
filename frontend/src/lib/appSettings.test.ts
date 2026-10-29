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
});
