/**
 * App Settings & Background Services Model
 * Controls background OTA updates, background sync, and user preferences.
 */

export interface AppSettings {
  autoUpdateEnabled: boolean; // default: true
  autoSyncEnabled: boolean;   // default: true
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoUpdateEnabled: true,
  autoSyncEnabled: true,
};

export const APP_SETTINGS_STORAGE_KEY = "ornav_app_settings";
export const APP_SETTINGS_EVENT = "ornav_app_settings_updated";

export function getAppSettings(): AppSettings {
  if (typeof window === "undefined") return { ...DEFAULT_APP_SETTINGS };
  try {
    const raw = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        autoUpdateEnabled:
          typeof parsed.autoUpdateEnabled === "boolean"
            ? parsed.autoUpdateEnabled
            : DEFAULT_APP_SETTINGS.autoUpdateEnabled,
        autoSyncEnabled:
          typeof parsed.autoSyncEnabled === "boolean"
            ? parsed.autoSyncEnabled
            : DEFAULT_APP_SETTINGS.autoSyncEnabled,
      };
    }
  } catch (e) {
    console.warn("Could not parse app settings from localStorage:", e);
  }
  return { ...DEFAULT_APP_SETTINGS };
}

export function saveAppSettings(settings: Partial<AppSettings>): AppSettings {
  if (typeof window === "undefined") return { ...DEFAULT_APP_SETTINGS, ...settings };
  try {
    const current = getAppSettings();
    const updated: AppSettings = {
      autoUpdateEnabled:
        typeof settings.autoUpdateEnabled === "boolean"
          ? settings.autoUpdateEnabled
          : current.autoUpdateEnabled,
      autoSyncEnabled:
        typeof settings.autoSyncEnabled === "boolean"
          ? settings.autoSyncEnabled
          : current.autoSyncEnabled,
    };
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent(APP_SETTINGS_EVENT, { detail: updated }));
    return updated;
  } catch (e) {
    console.error("Failed to save app settings:", e);
    return { ...DEFAULT_APP_SETTINGS, ...settings };
  }
}
