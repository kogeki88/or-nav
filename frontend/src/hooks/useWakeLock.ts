import { useEffect, useRef } from "react";

/**
 * Screen Wake Lock hook: Keeps mobile screen awake during 15-Min Hands-Free
 * audio mode or active recording to prevent phone sleep and audio stutter.
 */
export function useWakeLock(enabled: boolean) {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    let active = true;

    async function acquireLock() {
      if (typeof window === "undefined" || !("wakeLock" in navigator)) return;
      try {
        if (!wakeLockRef.current || wakeLockRef.current.released) {
          wakeLockRef.current = await navigator.wakeLock.request("screen");
          wakeLockRef.current.addEventListener("release", () => {
            wakeLockRef.current = null;
          });
        }
      } catch (err) {
        console.debug("Screen wake lock request failed or unsupported:", err);
      }
    }

    async function releaseLock() {
      if (wakeLockRef.current && !wakeLockRef.current.released) {
        try {
          await wakeLockRef.current.release();
        } catch {}
        wakeLockRef.current = null;
      }
    }

    if (enabled) {
      acquireLock();
    } else {
      releaseLock();
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && enabled) {
        acquireLock();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      releaseLock();
    };
  }, [enabled]);
}
