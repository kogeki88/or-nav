"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AppSettings,
  DEFAULT_APP_SETTINGS,
  getAppSettings,
  saveAppSettings as persistAppSettings,
  APP_SETTINGS_EVENT,
} from "@/lib/appSettings";

export function useAppSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  useEffect(() => {
    setSettingsState(getAppSettings());
    setIsLoaded(true);

    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<AppSettings>;
      if (customEvent.detail) {
        setSettingsState(customEvent.detail);
      } else {
        setSettingsState(getAppSettings());
      }
    };

    window.addEventListener(APP_SETTINGS_EVENT, handleUpdate);
    return () => {
      window.removeEventListener(APP_SETTINGS_EVENT, handleUpdate);
    };
  }, []);

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    const updated = persistAppSettings(partial);
    setSettingsState(updated);
  }, []);

  return {
    settings,
    updateSettings,
    isLoaded,
  };
}
