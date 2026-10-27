"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  flushOfflineOutbox,
  getPendingOutboxCount,
  syncTenantInventoryToOfflineDb,
} from "./offlineDb";
import { fetchQuestions } from "./api";

export type SyncStatus = "synced" | "syncing" | "offline";

export interface SyncResult {
  success: boolean;
  flushedCount: number;
}

export interface SyncEngineResult {
  status: SyncStatus;
  statusLabel: string;
  pendingCount: number;
  lastSyncedAt: Date | null;
  triggerSync: () => Promise<SyncResult>;
}

/**
 * Global Automatic Background Sync Engine
 * Coordinates online listeners, retry outbox flushing, and remote cache synchronization.
 * Respects `autoSyncEnabled` user preference.
 */
export function useSyncEngine(
  tenantId: string,
  autoSyncEnabled: boolean = true
): SyncEngineResult {
  const [status, setStatus] = useState<SyncStatus>(() => {
    if (typeof window !== "undefined") {
      return navigator.onLine ? "synced" : "offline";
    }
    return "synced";
  });
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const syncingRef = useRef(false);

  const updatePendingCount = useCallback(async () => {
    try {
      const count = await getPendingOutboxCount();
      setPendingCount(count);
    } catch {}
  }, []);

  const triggerSync = useCallback(async (): Promise<SyncResult> => {
    if (typeof window === "undefined") return { success: false, flushedCount: 0 };
    if (!navigator.onLine) {
      setStatus("offline");
      await updatePendingCount();
      return { success: false, flushedCount: 0 };
    }

    if (syncingRef.current) return { success: true, flushedCount: 0 };
    syncingRef.current = true;
    setStatus("syncing");

    let flushed = 0;
    try {
      // Step 1: Auto-flush offline mutations with exponential backoff
      flushed = await flushOfflineOutbox();
      await updatePendingCount();

      // Step 2: Auto-pull inventory delta and merge into IndexedDB
      await syncTenantInventoryToOfflineDb(tenantId);

      // Step 3: Auto-pull unanswered questions delta
      try {
        await fetchQuestions(tenantId);
      } catch {}

      setLastSyncedAt(new Date());
      setStatus("synced");
      return { success: true, flushedCount: flushed };
    } catch (err) {
      console.warn("Background auto-sync encountered non-fatal error:", err);
      setStatus(navigator.onLine ? "synced" : "offline");
      return { success: false, flushedCount: flushed };
    } finally {
      syncingRef.current = false;
      await updatePendingCount();
    }
  }, [tenantId, updatePendingCount]);

  useEffect(() => {
    // Always refresh pending count on mount
    updatePendingCount();

    // If auto-sync is disabled, do not register automatic triggers
    if (!autoSyncEnabled) {
      const handleNetworkOffline = () => {
        setStatus("offline");
        updatePendingCount();
      };
      const handleNetworkOnline = () => {
        setStatus("synced");
        updatePendingCount();
      };
      window.addEventListener("online", handleNetworkOnline);
      window.addEventListener("offline", handleNetworkOffline);
      return () => {
        window.removeEventListener("online", handleNetworkOnline);
        window.removeEventListener("offline", handleNetworkOffline);
      };
    }

    // Initial background sync when auto-sync is enabled
    triggerSync();

    const handleOnline = () => {
      setStatus("syncing");
      triggerSync();
    };

    const handleOffline = () => {
      setStatus("offline");
      updatePendingCount();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        triggerSync();
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Periodic background sync interval (every 60s when online)
    const interval = setInterval(() => {
      if (navigator.onLine && !syncingRef.current) {
        triggerSync();
      }
    }, 60000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(interval);
    };
  }, [autoSyncEnabled, triggerSync, updatePendingCount]);

  let statusLabel = "🟢 Synced";
  if (status === "syncing") {
    statusLabel =
      pendingCount > 0
        ? `🔄 Syncing ${pendingCount} change${pendingCount > 1 ? "s" : ""}...`
        : "🔄 Syncing...";
  } else if (status === "offline") {
    statusLabel =
      pendingCount > 0
        ? `📶 Offline (${pendingCount} queued)`
        : "📶 Offline (Local Cache)";
  }

  return {
    status,
    statusLabel,
    pendingCount,
    lastSyncedAt,
    triggerSync,
  };
}
