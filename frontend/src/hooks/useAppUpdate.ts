"use client";

import { useState, useEffect, useCallback } from "react";
import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import {
  CURRENT_VERSION,
  CURRENT_BUILD_NUMBER,
  GITHUB_REPO_OWNER,
  GITHUB_REPO_NAME,
  CLOUD_MANIFEST_URL,
  CLOUD_RELEASES_API_URL,
  isNewerVersion,
  type VersionManifest,
} from "@/lib/version";

export interface ApkUpdaterPlugin {
  installApk(options: { url: string }): Promise<{
    success: boolean;
    path?: string;
    bytes?: number;
  }>;
}

export const ApkUpdater = registerPlugin<ApkUpdaterPlugin>("ApkUpdater");

export interface CheckUpdateResult {
  success: boolean;
  updateAvailable: boolean;
  isLatest: boolean;
  manifest: VersionManifest | null;
  checkedUrl?: string;
  diagnostic?: string;
  error?: string;
}

export interface AppUpdateState {
  updateAvailable: boolean;
  updateInfo: VersionManifest | null;
  checking: boolean;
  dismissed: boolean;
  dismissUpdate: () => void;
  checkForUpdate: () => Promise<CheckUpdateResult>;
  downloadUpdate: (url?: string) => Promise<void>;
  currentVersion: string;
  currentBuild: number;
}

export const DEFAULT_UPDATE_SERVER = "http://192.168.1.217:8000";

/**
 * Direct In-App APK Download & Package Installer Bridge
 * 1. On Native Android: Calls ApkUpdater native plugin -> downloads APK directly and fires
 *    native PackageInstaller intent (FileProvider + Intent.ACTION_VIEW) so Android shows
 *    "Do you want to install an update to this application?" directly over the app.
 * 2. On Web / Non-Android: Falls back cleanly to Browser.open or window.open.
 */
export async function openApkDownload(updateUrl?: string | null): Promise<void> {
  if (!updateUrl) return;

  let targetUrl = updateUrl.trim();

  // Resolve relative URLs if needed
  if (targetUrl.startsWith("/")) {
    if (
      typeof window !== "undefined" &&
      window.location.origin &&
      !window.location.origin.includes("localhost")
    ) {
      targetUrl = `${window.location.origin}${targetUrl}`;
    } else {
      const serverUrl =
        typeof window !== "undefined"
          ? localStorage.getItem("ornav_server_url") ||
            localStorage.getItem("ornav_paired_server")
          : null;
      if (serverUrl) {
        const cleanHost = serverUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
        targetUrl = `http://${cleanHost}:8000${targetUrl}`;
      } else {
        targetUrl = `http://192.168.1.217:8000${targetUrl}`;
      }
    }
  }

  // 1. Native Android App: Trigger native package installer via ApkUpdater plugin
  if (Capacitor.isNativePlatform()) {
    try {
      if (ApkUpdater && typeof ApkUpdater.installApk === "function") {
        console.log("Launching native ApkUpdater for:", targetUrl);
        const res = await ApkUpdater.installApk({ url: targetUrl });
        if (res && res.success) {
          console.log("Package installer intent triggered successfully:", res);
          return;
        }
      }
    } catch (nativeErr: unknown) {
      const errMsg = nativeErr instanceof Error ? nativeErr.message : String(nativeErr);
      console.warn("ApkUpdater native plugin error, falling back to Browser.open:", errMsg);
      if (errMsg.includes("Permission required") && typeof window !== "undefined") {
        alert(errMsg);
        return;
      }
    }

    // Fallback: Open system browser (Chrome)
    try {
      await Browser.open({ url: targetUrl, windowName: "_system" });
      return;
    } catch (browserErr) {
      console.warn("Browser.open failed:", browserErr);
    }
  }

  // 2. Web browser fallback
  if (typeof window !== "undefined") {
    try {
      const win = window.open(targetUrl, "_system") || window.open(targetUrl, "_blank");
      if (!win) {
        window.location.href = targetUrl;
      }
    } catch {
      window.location.href = targetUrl;
    }
  }
}

export function parseVersionResponse(data: unknown): VersionManifest | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, any>;

  // 1. Direct VersionManifest schema (version.json or /api/version)
  if (
    typeof obj.version === "string" &&
    typeof obj.build_number === "number" &&
    typeof obj.apk_download_url === "string"
  ) {
    return {
      version: obj.version,
      build_number: obj.build_number,
      release_date: typeof obj.release_date === "string" ? obj.release_date : new Date().toISOString().slice(0, 10),
      apk_download_url: obj.apk_download_url,
      min_supported_version: typeof obj.min_supported_version === "string" ? obj.min_supported_version : "v0.1",
      changelog: typeof obj.changelog === "string" ? obj.changelog : "",
    };
  }

  // 2. GitHub Releases API schema (tag_name, name, body, assets)
  if (typeof obj.tag_name === "string" || typeof obj.name === "string") {
    const tagName = (obj.tag_name || obj.name || "").trim();
    const title = (obj.name || tagName || "").trim();
    const body = (obj.body || "").trim();

    // Parse monotonic build number from title e.g. "Build 6" or body
    let buildNum = 0;
    const buildMatch = title.match(/build\s*(\d+)/i) || body.match(/build\s*(\d+)/i);
    if (buildMatch) {
      buildNum = parseInt(buildMatch[1], 10);
    } else {
      const semParts = tagName.replace(/^v/i, "").split(".");
      buildNum = parseInt(semParts[1] || semParts[0] || "1", 10);
    }

    // Locate APK asset URL
    let apkUrl = "";
    if (Array.isArray(obj.assets)) {
      const apkAsset = obj.assets.find((a: any) => a && typeof a.name === "string" && a.name.endsWith(".apk"));
      if (apkAsset && typeof apkAsset.browser_download_url === "string") {
        apkUrl = apkAsset.browser_download_url;
      }
    }
    if (!apkUrl) {
      apkUrl = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest/download/or-nav.apk`;
    }

    return {
      version: tagName,
      build_number: buildNum,
      release_date: typeof obj.published_at === "string" ? obj.published_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
      apk_download_url: apkUrl,
      min_supported_version: "v0.1",
      changelog: body || title || `Release ${tagName}`,
    };
  }

  return null;
}

/**
 * Fetch manifest from a single URL with cache-busting headers.
 * Uses CapacitorHttp on native devices to bypass WebView Mixed-Content and CORS.
 */
async function fetchManifestFromUrl(
  url: string,
  timeoutMs: number = 3000
): Promise<{ manifest: VersionManifest | null; error?: string }> {
  const sep = url.includes("?") ? "&" : "?";
  const cacheBustedUrl = `${url}${sep}t=${Date.now()}`;

  // 1. Native platform: Use CapacitorHttp to bypass Mixed-Content (HTTPS -> HTTP) and CORS
  if (Capacitor.isNativePlatform()) {
    try {
      const res = await CapacitorHttp.get({
        url: cacheBustedUrl,
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Accept: "application/json, text/plain, */*",
        },
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      });

      if (res.status === 200) {
        let data = res.data;
        if (typeof data === "string") {
          try {
            data = JSON.parse(data);
          } catch {}
        }
        const parsed = parseVersionResponse(data);
        if (parsed) {
          return { manifest: parsed };
        }
        return { manifest: null, error: "Invalid JSON manifest schema" };
      }
      return { manifest: null, error: `HTTP ${res.status}` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { manifest: null, error: msg || "Native request timed out" };
    }
  }

  // 2. Web browser: Use standard fetch with timeout controller
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(cacheBustedUrl, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Accept: "application/json, text/plain, */*",
      },
    });
    if (!res.ok) {
      return { manifest: null, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const parsed = parseVersionResponse(data);
    if (parsed) {
      return { manifest: parsed };
    }
    return { manifest: null, error: "Invalid JSON manifest schema" };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { manifest: null, error: msg || "Fetch timeout" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Robust Remote Version Manifest Prober
 * Probes candidate endpoints with remote servers checked FIRST on native platforms.
 */
export async function fetchRemoteVersionManifest(): Promise<{
  manifest: VersionManifest;
  probedUrl: string;
  diagnostic: string;
}> {
  const isNative = Capacitor.isNativePlatform();
  const candidateUrls: string[] = [];

  // 1. Cloud Priority #1 (Works Anywhere / PC Off)
  candidateUrls.push(
    CLOUD_MANIFEST_URL,
    CLOUD_RELEASES_API_URL,
    `https://raw.githubusercontent.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/main/frontend/public/version.json`
  );

  // 2. Custom Configured / Overridden Server IP/URL from Settings
  if (typeof window !== "undefined") {
    try {
      const customManifest = localStorage.getItem("ornav_update_manifest_url");
      if (customManifest && customManifest.trim()) {
        candidateUrls.push(customManifest.trim());
      }

      const configured =
        localStorage.getItem("ornav_server_url") ||
        localStorage.getItem("ornav_paired_server") ||
        localStorage.getItem("ornav_lan_ip");
      if (configured && configured.trim()) {
        const clean = configured.trim().replace(/\/+$/, "");
        const hostWithoutPort = clean.replace(/^https?:\/\//, "").replace(/:.*$/, "");
        candidateUrls.push(`http://${hostWithoutPort}:8000/api/version`);
        candidateUrls.push(`http://${hostWithoutPort}:3000/version.json`);
        if (clean.startsWith("http://") || clean.startsWith("https://")) {
          candidateUrls.push(`${clean}/api/version`);
          candidateUrls.push(`${clean}/version.json`);
        }
      }
    } catch {}
  }
  if (process.env.NEXT_PUBLIC_UPDATE_MANIFEST_URL) {
    candidateUrls.push(process.env.NEXT_PUBLIC_UPDATE_MANIFEST_URL);
  }

  // 3. Local LAN Fallback (When at Home)
  candidateUrls.push(
    "http://192.168.1.217:8000/api/version",
    "http://192.168.1.217:3000/version.json"
  );

  // 4. Relative paths (ONLY for web browser, NEVER on native where it reads stale APK assets)
  if (!isNative && typeof window !== "undefined") {
    if (window.location.origin && !window.location.origin.includes("localhost")) {
      candidateUrls.push(`${window.location.origin}/api/version`);
      candidateUrls.push(`${window.location.origin}/version.json`);
    }
    candidateUrls.push("/api/version", "/version.json");
  }

  const uniqueUrls = Array.from(new Set(candidateUrls)).filter(Boolean);
  const failureLogs: string[] = [];

  for (const url of uniqueUrls) {
    const { manifest, error } = await fetchManifestFromUrl(url, 3000);
    if (manifest) {
      return {
        manifest,
        probedUrl: url,
        diagnostic: `Connected to ${url} (Found ${manifest.version} Build ${manifest.build_number})`,
      };
    }
    failureLogs.push(`${url}: ${error || "unreachable"}`);
  }

  const summary = failureLogs.slice(0, 2).join("; ");
  throw new Error(`Update server unreachable (${summary})`);
}

export function useAppUpdate(autoUpdateEnabled: boolean = true): AppUpdateState {
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(false);
  const [updateInfo, setUpdateInfo] = useState<VersionManifest | null>(null);
  const [checking, setChecking] = useState<boolean>(false);
  const [dismissed, setDismissed] = useState<boolean>(false);

  const checkForUpdate = useCallback(async (): Promise<CheckUpdateResult> => {
    if (typeof window === "undefined") {
      return { success: false, updateAvailable: false, isLatest: true, manifest: null };
    }
    if (!navigator.onLine) {
      return {
        success: false,
        updateAvailable: false,
        isLatest: false,
        manifest: null,
        error: "Offline (check Wi-Fi connection)",
      };
    }

    setChecking(true);
    setDismissed(false);

    try {
      const { manifest, probedUrl, diagnostic } = await fetchRemoteVersionManifest();
      const hasNewer = isNewerVersion(
        manifest.version,
        manifest.build_number,
        CURRENT_VERSION,
        CURRENT_BUILD_NUMBER
      );

      if (hasNewer) {
        setUpdateInfo(manifest);
        setUpdateAvailable(true);
        return {
          success: true,
          updateAvailable: true,
          isLatest: false,
          manifest,
          checkedUrl: probedUrl,
          diagnostic,
        };
      } else {
        setUpdateAvailable(false);
        return {
          success: true,
          updateAvailable: false,
          isLatest: true,
          manifest,
          checkedUrl: probedUrl,
          diagnostic: `Up to date (Local ${CURRENT_VERSION} Build ${CURRENT_BUILD_NUMBER} = Remote Build ${manifest.build_number})`,
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not reach update server";
      console.warn("OTA update check error:", msg);
      return {
        success: false,
        updateAvailable: false,
        isLatest: false,
        manifest: null,
        error: msg,
      };
    } finally {
      setChecking(false);
    }
  }, []);

  const downloadUpdate = useCallback(
    async (customUrl?: string) => {
      const url = customUrl || updateInfo?.apk_download_url;
      if (url) {
        await openApkDownload(url);
      }
    },
    [updateInfo]
  );

  const dismissUpdate = useCallback(() => {
    setDismissed(true);
  }, []);

  // Automatic background update listener
  useEffect(() => {
    if (!autoUpdateEnabled) return;

    // Fast check on app mount
    const timer = setTimeout(() => {
      checkForUpdate();
    }, 1500);

    const handleOnline = () => {
      checkForUpdate();
    };

    window.addEventListener("online", handleOnline);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", handleOnline);
    };
  }, [autoUpdateEnabled, checkForUpdate]);

  return {
    updateAvailable: updateAvailable && !dismissed,
    updateInfo,
    checking,
    dismissed,
    dismissUpdate,
    checkForUpdate,
    downloadUpdate,
    currentVersion: CURRENT_VERSION,
    currentBuild: CURRENT_BUILD_NUMBER,
  };
}
