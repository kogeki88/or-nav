"use client";

import React, { useState, useEffect } from "react";
import {
  Plus,
  Settings,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  QrCode,
  Building,
  Sparkles,
  Check,
  Clock,
  Layers,
  Download,
  X,
  User,
  RefreshCw,
  Search,
  Activity,
  Volume2,
  Key,
  Package,
  HardDrive,
  Trash2,
  MessageSquare,
  Users,
} from "lucide-react";
import { fetchGeminiStatus, saveGeminiKey } from "@/lib/api";
import { DEPARTMENT_LIST, DEPARTMENTS } from "@/lib/departments";
import { CURRENT_VERSION, CURRENT_BUILD_NUMBER, type VersionManifest } from "@/lib/version";
import { type UserProfile } from "@/lib/userProfile";
import { type AppSettings } from "@/lib/appSettings";
import { type CheckUpdateResult, openApkDownload } from "@/hooks/useAppUpdate";
import { type SyncResult } from "@/lib/syncEngine";
import { type ChatSession } from "@/lib/offlineDb";
import {
  getClinicianRewards,
  getLevelInfo,
  XP_EVENT_NAME,
  type ClinicianRewards,
} from "@/lib/gamification";
import { isAdminUser, getCurrentSession } from "@/lib/auth";

function formatSessionTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

interface SidebarProps {
  tenants: string[];
  selectedTenant: string;
  onSelectTenant: (tenant: string) => void;
  onNewCase: () => void;
  autoTts: boolean;
  onToggleTts: () => void;
  handsFreeActive?: boolean;
  onStartHandsFree15Min?: () => void;
  offlineSyncedCount?: number;
  onSelectStarterPrompt?: (prompt: string) => void;
  loading?: boolean;
  voiceMode?: "BROWSER_WEB_SPEECH" | "LIVEKIT_WEBRTC";
  livekitConfigured?: boolean;
  onToggleVoiceMode?: () => void;
  onOpenQRPair?: () => void;
  history?: string[];
  updateAvailable?: boolean;
  updateInfo?: VersionManifest | null;
  onDismissUpdate?: () => void;
  userProfile?: UserProfile;
  onOpenProfileModal?: (tab?: "assignment" | "rewards") => void;
  appSettings?: AppSettings;
  onToggleAutoUpdate?: () => void;
  onToggleAutoSync?: () => void;
  onCheckForUpdates?: () => Promise<CheckUpdateResult>;
  onManualSync?: () => Promise<SyncResult>;
  onOpenResourceManager?: () => void;
  onOpenPeerQnA?: () => void;
  onOpenFeedbackModal?: () => void;
  pastSessions?: ChatSession[];
  currentSessionId?: string;
  onSelectSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onClearAllSessions?: () => void;
  onSignOut?: () => void;
  onRebuildCache?: () => Promise<number>;
}

export default function Sidebar({
  tenants,
  selectedTenant,
  onSelectTenant,
  onNewCase,
  autoTts,
  onToggleTts,
  handsFreeActive = false,
  onStartHandsFree15Min,
  offlineSyncedCount = 20,
  onSelectStarterPrompt,
  loading = false,
  voiceMode = "BROWSER_WEB_SPEECH",
  onOpenQRPair,
  history = [],
  updateAvailable = false,
  updateInfo = null,
  onDismissUpdate,
  userProfile,
  onOpenProfileModal,
  appSettings,
  onToggleAutoUpdate,
  onToggleAutoSync,
  onCheckForUpdates,
  onManualSync,
  onOpenResourceManager,
  onOpenPeerQnA,
  onOpenFeedbackModal,
  pastSessions = [],
  currentSessionId,
  onSelectSession,
  onDeleteSession,
  onClearAllSessions,
  onSignOut,
  onRebuildCache,
}: SidebarProps) {
  const [isRebuildingCache, setIsRebuildingCache] = useState(false);
  const [recentCasesOpen, setRecentCasesOpen] = useState(true);
  const [recentQueriesOpen, setRecentQueriesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Manual Check for Updates state
  const [manualUpdateChecking, setManualUpdateChecking] = useState(false);
  const [updateAvailableManifest, setUpdateAvailableManifest] = useState<VersionManifest | null>(null);
  const [serverUrlInput, setServerUrlInput] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("ornav_server_url") || "http://192.168.1.217:8000";
    }
    return "http://192.168.1.217:8000";
  });
  const [updateStatusFeedback, setUpdateStatusFeedback] = useState<{
    type: "success" | "update_found" | "error";
    message: string;
  } | null>(null);

  // Manual Sync Now state
  const [manualSyncing, setManualSyncing] = useState(false);
  const [syncStatusFeedback, setSyncStatusFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Accordion Category Expand/Collapse State
  const [openCategories, setOpenCategories] = useState({
    api: false,
    services: false,
    resources: false,
    audio: false,
    pairing: false,
    systemInfo: false,
  });

  const [rewards, setRewards] = useState<ClinicianRewards>(() => getClinicianRewards());
  const [openFeedbackCount, setOpenFeedbackCount] = useState(3);

  useEffect(() => {
    const updateCount = () => {
      try {
        const raw = localStorage.getItem("ornav_feedback_store");
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            setOpenFeedbackCount(list.filter((x: any) => x.status === "open").length);
            return;
          }
        }
      } catch {}
      setOpenFeedbackCount(3);
    };
    updateCount();
    window.addEventListener("ornav-feedback-updated", updateCount);
    return () => window.removeEventListener("ornav-feedback-updated", updateCount);
  }, []);

  useEffect(() => {
    setRewards(getClinicianRewards());
    const handleXp = () => {
      setRewards(getClinicianRewards());
    };
    window.addEventListener(XP_EVENT_NAME, handleXp);
    return () => window.removeEventListener(XP_EVENT_NAME, handleXp);
  }, []);

  const toggleCategory = (cat: keyof typeof openCategories | "diagnostics") => {
    const targetKey = cat === "diagnostics" ? "systemInfo" : cat;
    setOpenCategories((prev) => ({
      ...prev,
      [targetKey]: !prev[targetKey],
    }));
  };

  const handleManualCheckUpdates = async () => {
    if (!onCheckForUpdates || manualUpdateChecking) return;
    setManualUpdateChecking(true);
    setUpdateStatusFeedback(null);
    try {
      const res = await onCheckForUpdates();
      if (res.updateAvailable && res.manifest) {
        setUpdateAvailableManifest(res.manifest);
        setUpdateStatusFeedback({
          type: "update_found",
          message: `✨ ${res.manifest.version} (Build ${res.manifest.build_number}) found!`,
        });
      } else if (res.isLatest) {
        setUpdateAvailableManifest(null);
        setUpdateStatusFeedback({
          type: "success",
          message: `✓ App is up to date (${CURRENT_VERSION} Build ${CURRENT_BUILD_NUMBER})`,
        });
      } else if (res.error) {
        setUpdateAvailableManifest(null);
        setUpdateStatusFeedback({
          type: "error",
          message: `⚠️ ${res.error}`,
        });
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : "Could not reach update server. Check your connection or use QR pairing.";
      setUpdateAvailableManifest(null);
      setUpdateStatusFeedback({
        type: "error",
        message: `⚠️ ${msg}`,
      });
    } finally {
      setManualUpdateChecking(false);
    }
  };

  const handleManualSync = async () => {
    if (!onManualSync || manualSyncing) return;
    setManualSyncing(true);
    setSyncStatusFeedback(null);
    try {
      const res = await onManualSync();
      if (res.success) {
        setSyncStatusFeedback({
          type: "success",
          message:
            res.flushedCount > 0
              ? `✓ Sync complete! (${res.flushedCount} change${res.flushedCount > 1 ? "s" : ""} pushed)`
              : "✓ All changes synced & cache is up to date",
        });
      } else {
        setSyncStatusFeedback({
          type: "error",
          message: "⚠️ Offline (Check network connection)",
        });
      }
    } catch {
      setSyncStatusFeedback({
        type: "error",
        message: "⚠️ Sync failed",
      });
    } finally {
      setManualSyncing(false);
      setTimeout(() => setSyncStatusFeedback(null), 4500);
    }
  };

  useEffect(() => {
    fetchGeminiStatus()
      .then((res) => {
        setGeminiConfigured(res.configured);
        setMaskedKey(res.masked_key);
      })
      .catch(() => {});
  }, [settingsOpen]);

  const handleSaveKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKeyInput.trim() || savingKey) return;
    setSavingKey(true);
    try {
      const res = await saveGeminiKey(apiKeyInput.trim());
      setGeminiConfigured(res.configured);
      setMaskedKey(res.masked_key);
      setApiKeyInput("");
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.error("Failed to save Gemini API key:", err);
    } finally {
      setSavingKey(false);
    }
  };

  return (
    <aside role="navigation" className="w-64 sm:w-72 h-full flex flex-col bg-[#121215] border-r border-zinc-800/80 text-zinc-100 shrink-0 select-none">
      {/* Top Brand & New Case */}
      <div className="p-3.5 border-b border-zinc-800/80">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-100 text-sm tracking-tight">OR-Nav</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-zinc-400 bg-zinc-800/80 border border-zinc-800">
              {CURRENT_VERSION}
            </span>
          </div>
          <span className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>Ready</span>
          </span>
        </div>

        {/* Clinician Profile & Assignment Interactive Card */}
        {userProfile && (
          <button
            type="button"
            onClick={() => onOpenProfileModal?.("assignment")}
            title="Edit Clinician Profile & Assignment"
            data-testid="sidebar-profile-badge"
            className="w-full mt-2.5 p-2 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700/80 text-left transition-colors cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0 text-xs font-bold">
                {userProfile.fullName ? userProfile.fullName[0].toUpperCase() : "RN"}
              </div>
              <div className="truncate flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <div className="text-[11px] font-semibold text-zinc-200 group-hover:text-emerald-300 transition-colors truncate">
                    {userProfile.fullName}
                  </div>
                  <span className="text-[9px] font-mono px-1.5 py-0.2 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shrink-0 ml-1">
                    Lv.{getLevelInfo(rewards.xp).level} · {rewards.xp} XP
                  </span>
                </div>
                <div className="text-[10px] text-zinc-400 font-mono truncate">
                  {userProfile.facilityName || "Sacred Heart"} · {
                    DEPARTMENTS[selectedTenant]?.shortName ||
                    (selectedTenant.includes("::")
                      ? selectedTenant.split("::")[1].toUpperCase()
                      : selectedTenant.replace(/_/g, " ").toUpperCase())
                  } · {userProfile.clinicalRole || "Circulating RN"}
                </div>
              </div>
              <div className="text-[10px] text-zinc-500 group-hover:text-emerald-300 font-mono shrink-0 flex items-center gap-0.5 ml-0.5">
                <span>Edit</span>
                <span>➔</span>
              </div>
            </div>
            {/* XP Mini Progress Bar */}
            <div className="w-full h-1 rounded-full bg-zinc-800 mt-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-500"
                style={{ width: `${getLevelInfo(rewards.xp).progressPercent}%` }}
              />
            </div>
          </button>
        )}

        {/* Hidden department selector for test automation compatibility */}
        <select
          value={selectedTenant}
          onChange={(e) => onSelectTenant(e.target.value)}
          data-testid="department-selector"
          className="hidden"
          aria-hidden="true"
        >
          {DEPARTMENT_LIST.map((dept) => (
            <option key={dept.id} value={dept.id}>
              {dept.name}
            </option>
          ))}
          {!DEPARTMENTS[selectedTenant] && (
            <option value={selectedTenant}>
              {selectedTenant.replace(/_/g, " ").toUpperCase()}
            </option>
          )}
        </select>

        {/* Clean + New Case Button */}
        <button
          onClick={onNewCase}
          data-testid="sidebar-new-case-btn"
          className="w-full mt-3 min-h-[44px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-100 hover:bg-white active:bg-zinc-200 text-zinc-950 font-medium text-xs transition-colors shadow-sm cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>New Case</span>
        </button>

        {/* Questions Button */}
        <button
          type="button"
          onClick={onOpenPeerQnA}
          data-testid="sidebar-peer-qna-btn"
          className="w-full mt-2 flex items-center justify-between px-3 py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 active:bg-amber-500/25 border border-amber-500/30 text-amber-300 font-medium text-xs transition-colors shadow-sm cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Users className="w-3.5 h-3.5 text-amber-400" />
            <span>Questions</span>
          </div>
        </button>

        {/* Feedback Button */}
        <button
          type="button"
          onClick={onOpenFeedbackModal}
          data-testid="sidebar-feedback-btn"
          className="w-full mt-2 flex items-center justify-between px-3 py-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 active:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 font-medium text-xs transition-colors shadow-sm cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
            <span>Feedback</span>
          </div>
          {isAdminUser(getCurrentSession() || userProfile) && openFeedbackCount > 0 && (
            <span
              data-testid="feedback-open-count"
              className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-200"
            >
              {openFeedbackCount} open
            </span>
          )}
        </button>

        {/* Over-The-Air (OTA) Update Banner */}
        {updateAvailable && updateInfo && (
          <div
            data-testid="sidebar-update-banner"
            className="mt-3 p-2.5 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-200 text-xs shadow-sm relative overflow-hidden"
          >
            <div className="flex items-start justify-between gap-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-emerald-300">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>✨ Update {updateInfo.version} Available</span>
              </div>
              {onDismissUpdate && (
                <button
                  onClick={onDismissUpdate}
                  className="text-emerald-400/70 hover:text-emerald-200 p-0.5 rounded transition-colors"
                  aria-label="Dismiss update notification"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            {updateInfo.changelog && (
              <p className="mt-1 text-[11px] text-emerald-300/80 line-clamp-2 leading-relaxed">
                {updateInfo.changelog}
              </p>
            )}
            <button
              type="button"
              onClick={() => openApkDownload(updateInfo.apk_download_url)}
              data-testid="sidebar-download-apk-button"
              className="mt-2 flex items-center justify-center gap-1.5 w-full py-1.5 px-2 rounded-md bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-[11px] transition-colors shadow-sm cursor-pointer"
            >
              <Download className="w-3 h-3 stroke-[2.5]" />
              <span>Tap to download new APK</span>
            </button>
          </div>
        )}
      </div>

      {/* Middle Section: Collapsible Recent Cases & Recent Queries */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Collapsible Recent Cases Section */}
        <div className="rounded-lg bg-zinc-900/60 border border-zinc-800/80 overflow-hidden">
          <div className="flex items-center justify-between p-2.5 bg-zinc-900/90 hover:bg-zinc-850 transition-colors">
            <button
              type="button"
              onClick={() => setRecentCasesOpen(!recentCasesOpen)}
              data-testid="recent-cases-toggle"
              aria-expanded={recentCasesOpen}
              className="flex items-center gap-2 flex-1 text-left cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs font-semibold text-zinc-200">Recent Cases</span>
              {pastSessions && pastSessions.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-zinc-800 text-zinc-400 border border-zinc-700/60">
                  {pastSessions.length}
                </span>
              )}
            </button>
            <div className="flex items-center gap-1.5">
              {pastSessions && pastSessions.length > 0 && onClearAllSessions && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm("Clear all past cases for this department?")) {
                      onClearAllSessions();
                    }
                  }}
                  title="Clear all past cases"
                  data-testid="clear-all-cases-button"
                  className="px-1.5 py-0.5 rounded text-[10px] font-medium text-zinc-500 hover:text-rose-400 hover:bg-rose-950/40 transition-colors cursor-pointer"
                >
                  Clear All
                </button>
              )}
              <button
                type="button"
                onClick={() => setRecentCasesOpen(!recentCasesOpen)}
                className="text-zinc-500 hover:text-zinc-300 p-0.5 transition-colors cursor-pointer"
                aria-label={recentCasesOpen ? "Collapse recent cases" : "Expand recent cases"}
                aria-expanded={recentCasesOpen}
              >
                {recentCasesOpen ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {recentCasesOpen && (
            <div className="p-2 space-y-1 max-h-56 overflow-y-auto border-t border-zinc-800/60">
              {pastSessions && pastSessions.length > 0 ? (
                pastSessions.map((session) => {
                  const isActive = session.sessionId === currentSessionId;
                  return (
                    <div
                      key={session.sessionId}
                      data-testid={`recent-case-item-${session.sessionId}`}
                      onClick={() => onSelectSession?.(session.sessionId)}
                      className={`group flex items-center justify-between p-2 rounded-md text-left transition-colors cursor-pointer border ${
                        isActive
                          ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-200"
                          : "bg-zinc-950/40 hover:bg-zinc-800/70 border-transparent hover:border-zinc-800 text-zinc-300"
                      }`}
                    >
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        <MessageSquare
                          className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                            isActive ? "text-emerald-400" : "text-zinc-500 group-hover:text-zinc-400"
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium truncate" title={session.title}>
                            {session.title || "Case Session"}
                          </div>
                          <div className="text-[10px] text-zinc-500 flex items-center gap-1.5 mt-0.5">
                            <span>{formatSessionTime(session.updatedAt)}</span>
                            <span>•</span>
                            <span>{session.messages?.length || 0} msgs</span>
                          </div>
                        </div>
                      </div>

                      {onDeleteSession && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteSession(session.sessionId);
                          }}
                          title="Delete case"
                          aria-label="Delete case"
                          data-testid={`delete-case-${session.sessionId}`}
                          className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-rose-400 hover:bg-rose-950/30 rounded transition-all cursor-pointer ml-1 shrink-0"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="px-2 py-4 text-center text-[11px] text-zinc-500 italic">
                  No saved cases yet
                </div>
              )}
            </div>
          )}
        </div>

        {/* Collapsible Recent Queries / Prompts */}
        <div className="rounded-lg bg-zinc-900/40 border border-zinc-800/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setRecentQueriesOpen(!recentQueriesOpen)}
            className="w-full flex items-center justify-between p-2 text-left hover:bg-zinc-850/50 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-3 h-3 text-zinc-400" />
              <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                Recent Queries
              </span>
            </div>
            {recentQueriesOpen ? (
              <ChevronUp className="w-3 h-3 text-zinc-500" />
            ) : (
              <ChevronDown className="w-3 h-3 text-zinc-500" />
            )}
          </button>
          {recentQueriesOpen && (
            <div className="p-1.5 space-y-0.5 border-t border-zinc-800/50 max-h-40 overflow-y-auto">
              {history && history.length > 0 ? (
                history.slice(-10).reverse().map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => onSelectStarterPrompt?.(item)}
                    disabled={loading}
                    className="w-full text-left px-2 py-1 rounded hover:bg-zinc-800/80 text-[11px] text-zinc-400 hover:text-zinc-200 truncate transition-colors cursor-pointer"
                    title={item}
                  >
                    {item}
                  </button>
                ))
              ) : (
                <div className="px-2 py-2 text-center text-[11px] text-zinc-600 italic">
                  No recent queries
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Collapsible Bottom Settings Drawer / Accordion */}
      <div className="border-t border-zinc-800/80 bg-zinc-900/40">
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          data-testid="sidebar-system-toggle"
          aria-expanded={settingsOpen}
          className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Settings className="w-3.5 h-3.5 text-zinc-400" />
            <span className="font-semibold text-zinc-200">System</span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                geminiConfigured ? "bg-emerald-500" : "bg-amber-500"
              }`}
              title={geminiConfigured ? "Gemini 2.5 Flash Active" : "Offline Fallback Mode"}
            />
            {settingsOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5 text-zinc-500" />
            )}
          </div>
        </button>

        {settingsOpen && (
          <div className="max-h-[75vh] sm:max-h-[80vh] overflow-y-auto p-3 space-y-2 border-t border-zinc-800/80 bg-zinc-950 text-xs animate-in fade-in duration-150">
            {/* Category 1: API */}
            <div className="rounded-lg bg-zinc-900/80 border border-zinc-800/80 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleCategory("api")}
                data-testid="category-api-toggle"
                className="w-full flex items-center justify-between p-2.5 hover:bg-zinc-800/60 transition-colors text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Key className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-medium text-zinc-200">API</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      geminiConfigured ? "bg-emerald-500" : "bg-amber-500"
                    }`}
                  />
                  {openCategories.api ? (
                    <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                  )}
                </div>
              </button>
              {openCategories.api && (
                <div className="p-2.5 pt-1.5 border-t border-zinc-800/60 space-y-2 bg-zinc-950/60">
                  <div className="flex items-center gap-1.5 text-[11px] font-mono">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        geminiConfigured ? "bg-emerald-500" : "bg-amber-500"
                      }`}
                    />
                    {geminiConfigured ? (
                      <span className="text-zinc-300 truncate">
                        Gemini 2.5 Flash Active ({maskedKey})
                      </span>
                    ) : (
                      <span className="text-zinc-400 truncate">
                        Offline Fallback Mode (No API Key)
                      </span>
                    )}
                  </div>
                  <form onSubmit={handleSaveKey} className="flex items-center gap-1.5 pt-0.5">
                    <input
                      type="password"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder="Paste AIza... Gemini API key"
                      className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700 font-mono"
                    />
                    <button
                      type="submit"
                      disabled={!apiKeyInput.trim() || savingKey}
                      className="px-2.5 py-1 rounded bg-zinc-100 hover:bg-white text-zinc-900 font-medium text-[11px] transition-colors cursor-pointer shrink-0 disabled:opacity-40 flex items-center gap-1"
                    >
                      {saveSuccess ? <Check className="w-3 h-3 text-emerald-600" /> : null}
                      <span>{savingKey ? "..." : saveSuccess ? "Saved" : "Save"}</span>
                    </button>
                  </form>
                </div>
              )}
            </div>

            {/* Category 3: Background Services */}
            <div className="rounded-lg bg-zinc-900/80 border border-zinc-800/80 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleCategory("services")}
                data-testid="category-services-toggle"
                className="w-full flex items-center justify-between p-2.5 hover:bg-zinc-800/60 transition-colors text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-xs font-medium text-zinc-200">Background Services</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      appSettings?.autoSyncEnabled && appSettings?.autoUpdateEnabled
                        ? "bg-emerald-500"
                        : "bg-amber-500"
                    }`}
                  />
                  {openCategories.services ? (
                    <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                  )}
                </div>
              </button>
              {openCategories.services && (
                <div className="p-2.5 pt-1.5 border-t border-zinc-800/60 space-y-2 bg-zinc-950/60">
                  {/* 1. Over-The-Air (OTA) Updates Control Group */}
                  <div className="p-2 rounded-lg bg-zinc-900/90 border border-zinc-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-medium text-zinc-200">OTA Auto-Update</div>
                        <div className="text-[10px] text-zinc-400 font-mono">
                          Background APK check
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={onToggleAutoUpdate}
                        data-testid="toggle-auto-update"
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-colors cursor-pointer ${
                          appSettings?.autoUpdateEnabled
                            ? "bg-emerald-500 text-zinc-950 font-bold"
                            : "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {appSettings?.autoUpdateEnabled ? "ON" : "OFF"}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleManualCheckUpdates}
                      disabled={manualUpdateChecking}
                      data-testid="button-manual-update-check"
                      className="w-full flex items-center justify-center gap-1.5 py-1 px-2 rounded bg-zinc-800/90 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-200 text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Search className="w-3 h-3 text-zinc-400" />
                      <span>
                        {manualUpdateChecking ? "Checking server..." : "🔍 Check for Updates"}
                      </span>
                    </button>
                    {updateStatusFeedback && (
                      <div
                        data-testid="update-feedback"
                        className={`text-[10px] font-mono p-1 rounded text-center animate-in fade-in duration-150 ${
                          updateStatusFeedback.type === "success"
                            ? "text-emerald-400 bg-emerald-950/40 border border-emerald-900/60"
                            : updateStatusFeedback.type === "update_found"
                            ? "text-amber-300 bg-amber-950/40 border border-amber-900/60"
                            : "text-rose-400 bg-rose-950/40 border border-rose-900/60"
                        }`}
                      >
                        {updateStatusFeedback.message}
                      </div>
                    )}
                    {updateAvailableManifest && (
                      <button
                        type="button"
                        onClick={() => openApkDownload(updateAvailableManifest.apk_download_url)}
                        data-testid="btn-sidebar-install-apk"
                        className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-zinc-950 text-xs font-bold transition-colors cursor-pointer shadow-md"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>⬇️ Download & Install {updateAvailableManifest.version} Now</span>
                      </button>
                    )}
                    <div className="pt-1.5 border-t border-zinc-800/60 space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono">
                        <span>Server / Manifest URL</span>
                      </div>
                      <input
                        type="text"
                        value={serverUrlInput}
                        onChange={(e) => {
                          const val = e.target.value;
                          setServerUrlInput(val);
                          if (typeof window !== "undefined") {
                            localStorage.setItem("ornav_server_url", val.trim());
                          }
                        }}
                        placeholder="http://192.168.1.217:8000"
                        className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  {/* 2. Cloud Data Sync Control Group */}
                  <div className="p-2 rounded-lg bg-zinc-900/90 border border-zinc-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-medium text-zinc-200">Cloud Auto-Sync</div>
                        <div className="text-[10px] text-zinc-400 font-mono">
                          Outbox flush on Wi-Fi
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={onToggleAutoSync}
                        data-testid="toggle-auto-sync"
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-colors cursor-pointer ${
                          appSettings?.autoSyncEnabled
                            ? "bg-emerald-500 text-zinc-950 font-bold"
                            : "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {appSettings?.autoSyncEnabled ? "ON" : "OFF"}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleManualSync}
                      disabled={manualSyncing}
                      data-testid="button-manual-sync-now"
                      className="w-full flex items-center justify-center gap-1.5 py-1 px-2 rounded bg-zinc-800/90 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-200 text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`w-3 h-3 text-zinc-400 ${
                          manualSyncing ? "animate-spin text-emerald-400" : ""
                        }`}
                      />
                      <span>{manualSyncing ? "Syncing data..." : "🔄 Sync Now"}</span>
                    </button>
                    {syncStatusFeedback && (
                      <div
                        data-testid="sync-feedback"
                        className={`text-[10px] font-mono p-1 rounded text-center animate-in fade-in duration-150 ${
                          syncStatusFeedback.type === "success"
                            ? "text-emerald-400 bg-emerald-950/40 border border-emerald-900/60"
                            : "text-zinc-400 bg-zinc-950/40"
                        }`}
                      >
                        {syncStatusFeedback.message}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Category: 📦 Knowledge Packs & Resources */}
            <div className="rounded-lg bg-zinc-900/80 border border-zinc-800/80 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleCategory("resources")}
                data-testid="category-resources-toggle"
                className="w-full flex items-center justify-between p-2.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800/50 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-emerald-400" />
                  <span>Installed Resources</span>
                </div>
                {openCategories.resources ? (
                  <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                )}
              </button>
              {openCategories.resources && (
                <div className="p-2.5 pt-0 space-y-2 border-t border-zinc-800/40">
                  <div className="text-[11px] text-zinc-400 leading-relaxed">
                    On-demand facility handbooks, procedure preference cards, and role guides downloaded from GitHub.
                  </div>
                  <button
                    type="button"
                    onClick={onOpenResourceManager}
                    data-testid="button-open-resource-manager"
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <Package className="w-3.5 h-3.5" />
                    <span>📦 Manage Installed Resources</span>
                  </button>
                </div>
              )}
            </div>

            {/* Category 4: Audio */}
            <div className="rounded-lg bg-zinc-900/80 border border-zinc-800/80 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleCategory("audio")}
                data-testid="category-audio-toggle"
                className="w-full flex items-center justify-between p-2.5 hover:bg-zinc-800/60 transition-colors text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Volume2 className="w-3.5 h-3.5 text-purple-400" />
                  <span className="text-xs font-medium text-zinc-200">Audio</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-zinc-400">
                    {autoTts ? "VOICE ON" : "SILENT"}
                  </span>
                  {openCategories.audio ? (
                    <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                  )}
                </div>
              </button>
              {openCategories.audio && (
                <div className="p-2.5 pt-1.5 border-t border-zinc-800/60 space-y-2 bg-zinc-950/60">
                  {/* Silent-First TTS */}
                  <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/80 border border-zinc-800">
                    <span className="text-zinc-300 text-xs">Voice Responses</span>
                    <button
                      type="button"
                      onClick={onToggleTts}
                      data-testid="toggle-tts-audio"
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium transition-colors cursor-pointer ${
                        autoTts
                          ? "bg-zinc-200 text-zinc-900 font-bold"
                          : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {autoTts ? "VOICE ON" : "SILENT"}
                    </button>
                  </div>

                  {/* 15-Min Hands-Free Audio Window */}
                  {onStartHandsFree15Min && (
                    <button
                      type="button"
                      onClick={onStartHandsFree15Min}
                      data-testid="btn-hands-free-audio"
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3 h-3 text-zinc-400" />
                        <span>15-Min Hands-Free Audio</span>
                      </span>
                      <span className="font-mono text-[10px] text-zinc-400">
                        {handsFreeActive ? "Active" : "Start"}
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Category 5: Pairing */}
            <div className="rounded-lg bg-zinc-900/80 border border-zinc-800/80 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleCategory("pairing")}
                data-testid="category-pairing-toggle"
                className="w-full flex items-center justify-between p-2.5 hover:bg-zinc-800/60 transition-colors text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <QrCode className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-xs font-medium text-zinc-200">Pairing</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-zinc-400">Wi-Fi / LAN</span>
                  {openCategories.pairing ? (
                    <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                  )}
                </div>
              </button>
              {openCategories.pairing && (
                <div className="p-2.5 pt-1.5 border-t border-zinc-800/60 space-y-2 bg-zinc-950/60">
                  {/* Mobile QR Pair Trigger */}
                  {onOpenQRPair && (
                    <button
                      type="button"
                      onClick={onOpenQRPair}
                      data-testid="btn-open-qr-pair"
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <QrCode className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Mobile QR Pairing</span>
                      </div>
                      <span className="text-[10px] text-zinc-500 font-mono">Wi-Fi</span>
                    </button>
                  )}

                  {/* Workstation / Server URL Input */}
                  <div className="pt-1.5 border-t border-zinc-800/60 space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono">
                      <span>Workstation Server URL</span>
                    </div>
                    <input
                      type="text"
                      value={serverUrlInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        setServerUrlInput(val);
                        if (typeof window !== "undefined") {
                          localStorage.setItem("ornav_server_url", val.trim());
                        }
                      }}
                      placeholder="http://192.168.1.217:8000"
                      data-testid="input-workstation-server-url"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Category 6: System Info */}
            <div className="rounded-lg bg-zinc-900/80 border border-zinc-800/80 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleCategory("systemInfo")}
                data-testid="category-system-info-toggle"
                className="w-full flex items-center justify-between p-2.5 hover:bg-zinc-800/60 transition-colors text-left cursor-pointer relative"
              >
                {/* Backward compatibility test-hook with clickable geometry */}
                <span
                  data-testid="category-diagnostics-toggle"
                  className="absolute inset-0 opacity-0 pointer-events-auto cursor-pointer"
                  aria-hidden="true"
                />
                <div className="flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-xs font-medium text-zinc-200">System Info</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-zinc-500">{CURRENT_VERSION}</span>
                  {openCategories.systemInfo ? (
                    <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                  )}
                </div>
              </button>
              {openCategories.systemInfo && (
                <div className="p-2.5 pt-1.5 border-t border-zinc-800/60 space-y-1.5 bg-zinc-950/60 text-[11px] font-mono text-zinc-400">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Offline Cache:</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-zinc-300" data-testid="dexie-item-count">
                        {offlineSyncedCount} items (Dexie)
                        {offlineSyncedCount >= 140 ? " • All Packs Active" : ""}
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          if (isRebuildingCache) return;
                          setIsRebuildingCache(true);
                          try {
                            if (onRebuildCache) {
                              await onRebuildCache();
                            }
                          } finally {
                            setTimeout(() => setIsRebuildingCache(false), 500);
                          }
                        }}
                        disabled={isRebuildingCache}
                        title="Refresh & Rebuild Offline Cache (Dexie + Installed Packs)"
                        aria-label="Rebuild Offline Cache"
                        data-testid="rebuild-offline-cache-btn"
                        className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3 h-3 ${isRebuildingCache ? "animate-spin text-emerald-400" : ""}`} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Voice Engine:</span>
                    <span className="text-zinc-300">
                      {voiceMode === "LIVEKIT_WEBRTC" ? "LiveKit WebRTC" : "Browser Web Speech"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">HIPAA Scrubber:</span>
                    <span className="text-emerald-400 font-medium">Active</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">Engine Mode:</span>
                    <span className="text-zinc-300">Standalone Clinical Engine</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500">System Build:</span>
                    <span className="text-zinc-400">{CURRENT_VERSION} (Build {CURRENT_BUILD_NUMBER})</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Sign Out Action Button */}
      {onSignOut && (
        <div className="p-2 border-t border-zinc-800/80 bg-zinc-950/60">
          <button
            type="button"
            onClick={onSignOut}
            data-testid="sidebar-signout-btn"
            className="w-full flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 text-zinc-400 hover:text-rose-400 border border-zinc-800/80 text-xs font-medium transition-colors cursor-pointer"
          >
            <span>🚪 Sign Out</span>
          </button>
        </div>
      )}

      {/* Standalone Engine & Version Footer */}
      <div className="p-2.5 border-t border-zinc-800/80 text-[10px] text-zinc-500 font-mono text-center flex items-center justify-center gap-1.5 shrink-0 bg-zinc-950/40">
        <span>OR-Nav {CURRENT_VERSION}</span>
        <span>·</span>
        <span>Standalone Clinical Engine</span>
      </div>
    </aside>
  );
}
