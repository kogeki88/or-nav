"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import ChatCanvas, { MessageItem } from "@/components/ChatCanvas";
import Omnibar from "@/components/Omnibar";
import { QRPairModal } from "@/components/QRPairModal";
import QuestionsDrawer from "@/components/QuestionsDrawer";
import UserProfileModal from "@/components/UserProfileModal";
import AutoUpdateModal from "@/components/AutoUpdateModal";
import ResourceManagerModal from "@/components/ResourceManagerModal";
import PeerQnAPanel from "@/components/PeerQnAPanel";
import { FeedbackModal } from "@/components/FeedbackModal";
import AuthScreen from "@/components/AuthScreen";
import {
  getCurrentSession,
  clearActiveSession,
  AUTH_EVENT,
  type AuthSession,
} from "@/lib/auth";
import {
  fetchTenants,
  sendChatMessage,
  sendVoiceAudioQuery,
  verifyMove,
  flagItemWrong,
  fetchQuestions,
  ingestFile,
  DepartmentQuestion,
  addInventoryItemApi,
} from "@/lib/api";
import {
  syncTenantInventoryToOfflineDb,
  queueOfflineMutation,
  saveChatSession,
  getChatSession,
  listChatSessions,
  deleteChatSession,
  clearChatSessions,
  type ChatSession,
} from "@/lib/offlineDb";
import { learnAliasClient, titleCaseTerm } from "@/lib/lexiconLearning";
import { hydrateFromSeedIfEmpty } from "@/lib/standaloneEngine";
import { scrubPhi } from "@/lib/scrubClient";
import { usePushToTalk } from "@/hooks/usePushToTalk";
import { useWakeLock } from "@/hooks/useWakeLock";
import {
  Menu,
  X,
  PanelLeft,
  QrCode,
  SquarePen,
  MessageSquare,
  ChevronDown,
} from "lucide-react";
import {
  getDepartment,
  getActiveDepartmentId,
  setActiveDepartmentId,
} from "@/lib/departments";
import { useAppUpdate, openApkDownload } from "@/hooks/useAppUpdate";
import { useSyncEngine } from "@/lib/syncEngine";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useAppSettings } from "@/hooks/useAppSettings";
import { CURRENT_VERSION } from "@/lib/version";
import { UserProfile } from "@/lib/userProfile";
import {
  awardClinicalXP,
  XP_EVENT_NAME,
  type XpGainedDetail,
} from "@/lib/gamification";
import { interceptChatComplaint } from "@/lib/feedbackEngine";

export default function Home() {
  const [tenants, setTenants] = useState<string[]>([
    "or_main",
    "icu_critical_care",
    "er_trauma",
    "pacu_periop",
  ]);
  const [selectedTenant, setSelectedTenant] = useState<string>(() => {
    return getActiveDepartmentId();
  });
  const [messages, setMessages] = useState<MessageItem[]>([]);
  // Phase 29.1: Multi-Session Persistence & Hydration Guard
  const isHydratedRef = useRef<boolean>(false);
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return (
        localStorage.getItem(`ornav_active_session_id_${getActiveDepartmentId()}`) ||
        `session_${Date.now()}`
      );
    }
    return `session_${Date.now()}`;
  });
  const [pastSessions, setPastSessions] = useState<ChatSession[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  // Silent-First OR Output by default
  const [autoTts, setAutoTts] = useState<boolean>(false);
  const [handsFreeUntil, setHandsFreeUntil] = useState<number | null>(null);
  const [offlineSyncedCount, setOfflineSyncedCount] = useState<number>(20);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [qrModalOpen, setQrModalOpen] = useState<boolean>(false);
  const [questionsDrawerOpen, setQuestionsDrawerOpen] = useState<boolean>(false);
  const [questions, setQuestions] = useState<DepartmentQuestion[]>([]);
  const [openQuestionsCount, setOpenQuestionsCount] = useState<number>(2);

  // User Profile & Clinical Assignment Modal
  const { profile, saveProfile } = useUserProfile();
  const [profileModalOpen, setProfileModalOpen] = useState<boolean>(false);
  const [profileModalTab, setProfileModalTab] = useState<"assignment" | "rewards">("assignment");
  const [resourceModalOpen, setResourceModalOpen] = useState<boolean>(false);
  const [peerQnAOpen, setPeerQnAOpen] = useState<boolean>(false);
  const [peerQnAPrefill, setPeerQnAPrefill] = useState<string>("");
  const [feedbackModalOpen, setFeedbackModalOpen] = useState<boolean>(false);
  const [xpToast, setXpToast] = useState<XpGainedDetail | null>(null);

  useEffect(() => {
    const handleXpGained = (e: any) => {
      if (e.detail) {
        setXpToast(e.detail);
        setTimeout(() => {
          setXpToast((cur) => (cur === e.detail ? null : cur));
        }, 3500);
      }
    };
    window.addEventListener(XP_EVENT_NAME, handleXpGained);
    return () => window.removeEventListener(XP_EVENT_NAME, handleXpGained);
  }, []);

  // Authentication & Session State (Phase 33)
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const [isOnboardingMode, setIsOnboardingMode] = useState<boolean>(false);

  useEffect(() => {
    const s = getCurrentSession();
    setAuthSession(s);
    setAuthChecked(true);

    const onAuthChanged = (e: any) => {
      setAuthSession(e.detail || null);
    };
    window.addEventListener(AUTH_EVENT, onAuthChanged);
    return () => window.removeEventListener(AUTH_EVENT, onAuthChanged);
  }, []);

  const handleAuthSuccess = useCallback(
    (session: AuthSession) => {
      setAuthSession(session);
      const name = session.profile?.fullName || session.fullName || profile.fullName;
      if (session.profile) {
        saveProfile({ ...session.profile, fullName: name });
        if (session.profile.departmentId && session.profile.departmentId !== selectedTenant) {
          const clean =
            session.profile.departmentId === "general_memorial_cvor" || session.profile.departmentId === "or_main"
              ? "sacred_heart::or"
              : session.profile.departmentId;
          setSelectedTenant(clean);
          setActiveDepartmentId(clean);
        }
      } else if (session.fullName) {
        saveProfile({ ...profile, fullName: session.fullName });
      }

      if (!session.onboardingCompleted) {
        console.log("First-time login: launching Profile Onboarding...");
        setIsOnboardingMode(true);
        setProfileModalOpen(true);
      } else {
        console.log("Returning user: onboarding already completed.");
        setIsOnboardingMode(false);
        setProfileModalOpen(false);
      }
    },
    [profile, saveProfile, selectedTenant]
  );

  const handleSignOut = useCallback(() => {
    clearActiveSession();
    setAuthSession(null);
    setIsOnboardingMode(false);
    setProfileModalOpen(false);
    setMobileSidebarOpen(false);
  }, []);

  // App Settings & Background Services Toggles (Phase 26)
  const { settings: appSettings, updateSettings } = useAppSettings();

  // Over-The-Air (OTA) Updates & Automatic Background Sync Engine
  const {
    updateAvailable,
    updateInfo,
    dismissed,
    dismissUpdate,
    checkForUpdate,
    currentVersion,
    currentBuild,
  } = useAppUpdate(appSettings.autoUpdateEnabled);

  // Auto-trigger native APK installer once when auto-update is enabled
  const autoInstalledRef = useRef<boolean>(false);
  useEffect(() => {
    if (updateAvailable && updateInfo && appSettings.autoUpdateEnabled && !autoInstalledRef.current) {
      autoInstalledRef.current = true;
      console.log("Auto-Update is ON: Automatically initiating APK download for", updateInfo.version);
      openApkDownload(updateInfo.apk_download_url);
    }
  }, [updateAvailable, updateInfo, appSettings.autoUpdateEnabled]);

  const {
    status: syncStatus,
    statusLabel,
    triggerSync,
  } = useSyncEngine(selectedTenant, appSettings.autoSyncEnabled);

  // Toggle callbacks for auto-update and auto-sync
  const handleToggleAutoUpdate = useCallback(() => {
    updateSettings({ autoUpdateEnabled: !appSettings.autoUpdateEnabled });
  }, [appSettings.autoUpdateEnabled, updateSettings]);

  const handleToggleAutoSync = useCallback(() => {
    updateSettings({ autoSyncEnabled: !appSettings.autoSyncEnabled });
  }, [appSettings.autoSyncEnabled, updateSettings]);

  // Vector 6: Session epoch & AbortController to discard in-flight responses on + New Case or tenant switch
  const sessionEpochRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Active department metadata
  const activeDept = getDepartment(selectedTenant);

  // Load available tenants from backend
  useEffect(() => {
    fetchTenants()
      .then((data) => {
        if (data.tenants && data.tenants.length > 0) {
          setTenants(data.tenants);
          const saved =
            typeof window !== "undefined"
              ? localStorage.getItem("ornav_active_department")
              : null;
          if (
            saved &&
            (data.tenants.includes(saved) || saved === "general_memorial_cvor")
          ) {
            setSelectedTenant(saved === "general_memorial_cvor" ? "or_main" : saved);
          } else if (data.default) {
            setSelectedTenant(data.default);
          }
        }
      })
      .catch((err) => {
        console.warn("Could not load tenants from backend:", err);
      });
  }, []);

  // Load unanswered department questions & sync Offline IndexedDB cache
  const refreshQuestions = useCallback(async () => {
    try {
      const data = await fetchQuestions(selectedTenant);
      setQuestions(data.questions || []);
      setOpenQuestionsCount(data.open_count ?? 0);
    } catch {
      // Keep existing state if offline
    }
  }, [selectedTenant]);

  useEffect(() => {
    refreshQuestions();
    syncTenantInventoryToOfflineDb(selectedTenant).then(async (count) => {
      if (count > 0) {
        setOfflineSyncedCount(count);
      } else {
        const seedCount = await hydrateFromSeedIfEmpty(selectedTenant);
        if (seedCount > 0) setOfflineSyncedCount(seedCount);
      }
    });
  }, [selectedTenant, refreshQuestions]);

  // Phase 29.1: Restore active case messages & session history on load / department switch
  useEffect(() => {
    if (typeof window === "undefined") return;
    isHydratedRef.current = false;
    let cancelled = false;

    const hydrateActiveSession = async () => {
      try {
        // Load past sessions for the active department
        const sessions = await listChatSessions(selectedTenant);
        if (!cancelled) {
          setPastSessions(sessions);
        }

        // Get saved active session id or generate a fresh one
        const savedSessionId = localStorage.getItem(`ornav_active_session_id_${selectedTenant}`);
        const activeId = savedSessionId || `session_${Date.now()}`;
        if (!cancelled) {
          setCurrentSessionId(activeId);
        }

        // Fast restore from localStorage active snapshot
        const rawLocal = localStorage.getItem(`ornav_active_case_${selectedTenant}`);
        if (rawLocal) {
          try {
            const parsed = JSON.parse(rawLocal);
            if (Array.isArray(parsed) && parsed.length > 0) {
              if (!cancelled) {
                setMessages(parsed);
                isHydratedRef.current = true;
              }
              return;
            }
          } catch {}
        }

        // Fallback restore: check IndexedDB for this saved session
        if (savedSessionId) {
          const idbSession = await getChatSession(savedSessionId);
          if (!cancelled && idbSession && idbSession.messages && idbSession.messages.length > 0) {
            setMessages(idbSession.messages);
            localStorage.setItem(
              `ornav_active_case_${selectedTenant}`,
              JSON.stringify(idbSession.messages)
            );
            isHydratedRef.current = true;
            return;
          }
        }

        // Clean slate if nothing saved
        if (!cancelled) {
          setMessages([]);
        }
      } catch (e) {
        console.warn("Could not restore case session from storage:", e);
      } finally {
        if (!cancelled) {
          isHydratedRef.current = true;
        }
      }
    };

    hydrateActiveSession();

    return () => {
      cancelled = true;
    };
  }, [selectedTenant]);

  // Phase 29.1: Persist active case messages into localStorage & IndexedDB
  useEffect(() => {
    // CRITICAL: Prevent initial mount render from wiping storage before hydration completes!
    if (!isHydratedRef.current) return;
    if (typeof window === "undefined") return;

    try {
      if (messages.length > 0) {
        localStorage.setItem(
          `ornav_active_case_${selectedTenant}`,
          JSON.stringify(messages)
        );
        localStorage.setItem(
          `ornav_active_session_id_${selectedTenant}`,
          currentSessionId
        );

        // Derive title from first user query
        const firstUser = messages.find((m) => m.sender === "user");
        const title = firstUser
          ? firstUser.text.slice(0, 42).replace(/[\r\n]+/g, " ") + (firstUser.text.length > 42 ? "…" : "")
          : "Case Session";

        const sessionPayload: ChatSession = {
          sessionId: currentSessionId,
          tenantId: selectedTenant,
          title,
          updatedAt: new Date().toISOString(),
          messages,
        };

        // Mirror to IndexedDB and update pastSessions
        saveChatSession(sessionPayload).then(() => {
          listChatSessions(selectedTenant).then((list) => setPastSessions(list));
        });
      } else {
        localStorage.removeItem(`ornav_active_case_${selectedTenant}`);
      }
    } catch (e) {
      console.warn("Could not persist case session to storage:", e);
    }
  }, [messages, selectedTenant, currentSessionId]);

  // 15-Minute Hands-Free Audio Window timer
  const startHandsFree15Min = useCallback(() => {
    const expiry = Date.now() + 15 * 60 * 1000;
    setHandsFreeUntil(expiry);
    setAutoTts(true);
  }, []);

  useEffect(() => {
    if (!handsFreeUntil) return;
    const remaining = handsFreeUntil - Date.now();
    if (remaining <= 0) {
      setHandsFreeUntil(null);
      setAutoTts(false);
      return;
    }
    const timer = setTimeout(() => {
      setHandsFreeUntil(null);
      setAutoTts(false);
    }, remaining);
    return () => clearTimeout(timer);
  }, [handsFreeUntil]);

  // Single-response on-demand TTS helper (works even when autoTts is false)
  const speakSingleMessage = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn("TTS error:", err);
    }
  }, []);

  // Automatic TTS helper (only speaks when autoTts or 15-min Hands-Free Window is active)
  const speakText = useCallback(
    (text: string) => {
      const handsFreeActive = handsFreeUntil !== null && Date.now() < handsFreeUntil;
      if (!autoTts && !handsFreeActive) return;
      speakSingleMessage(text);
    },
    [autoTts, handsFreeUntil, speakSingleMessage]
  );

  // Send message flow
  const handleSendMessage = useCallback(
    async (rawMessage: string) => {
      if (!rawMessage.trim() || loading) return;

      const trimmed = rawMessage.trim();
      setHistory((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));

      const requestEpoch = sessionEpochRef.current;
      abortControllerRef.current?.abort();
      const ac = new AbortController();
      abortControllerRef.current = ac;

      // Client-side scrub
      const { text: clientScrubbed, redactionCount } = scrubPhi(rawMessage);
      const clientPhiDetected = redactionCount > 0;

      // Passive Chat Complaint & Feature Wish Interceptor (Phase 36)
      let feedbackIntercepted = false;
      try {
        const item = await interceptChatComplaint(rawMessage, profile);
        if (item) {
          feedbackIntercepted = true;
          awardClinicalXP("feedback_logged", "Feedback Captured for Roadmap (+3 XP)");
        }
      } catch (e) {
        console.warn("Feedback interception error:", e);
      }

      const userMsgId = `user-${Date.now()}`;
      const userMessage: MessageItem = {
        id: userMsgId,
        sender: "user",
        text: clientScrubbed,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        clientPhiDetected,
        feedbackCaptured: feedbackIntercepted,
      };

      setMessages((prev) => [...prev, userMessage]);
      setLoading(true);

      try {
        const { response } = await sendChatMessage(
          rawMessage,
          selectedTenant,
          ac.signal,
          profile
        );

        // Vector 6: If + New Case or Tenant Switch occurred mid-flight, discard stale response!
        if (sessionEpochRef.current !== requestEpoch) {
          return;
        }

        const cards =
          response.coordinate_cards && response.coordinate_cards.length > 0
            ? response.coordinate_cards
            : response.coordinate_card
            ? [response.coordinate_card]
            : undefined;

        const botMessage: MessageItem = {
          id: `bot-${Date.now()}`,
          sender: "assistant",
          text: response.reply_text,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          coordinateCards: cards,
          routingTier: response.routing_tier,
          isEducationalBaseline: response.is_educational_baseline,
          moveWidget: response.move_widget,
          spokenTranscriptCorrection: response.spoken_transcript_correction,
          disambiguationChips: response.disambiguation_chips,
          quickAddWidget: response.quick_add_widget,
          implicitLearnPrompt: response.implicit_learn_prompt,
          teachingCard: response.teaching_card,
        };

        setMessages((prev) => [...prev, botMessage]);
        awardClinicalXP("lookup", "Clinical Lookup: " + trimmed.slice(0, 30));
        if (response.teaching_card) {
          awardClinicalXP("lookup", "Taught facility lingo: " + response.teaching_card.slang);
        }

        // Auto-TTS if enabled
        if (response.reply_text) {
          speakText(response.reply_text);
        }

        // Auto-refresh questions if peer question feed was updated
        if (response.routing_tier === "MOVE_REPORTED") {
          refreshQuestions();
        }
      } catch (err: unknown) {
        if (sessionEpochRef.current !== requestEpoch) {
          return;
        }
        const errorText =
          err instanceof Error
            ? err.name === "AbortError"
              ? ""
              : err.message
            : "Network error";
        if (errorText) {
          setMessages((prev) => [
            ...prev,
            {
              id: `err-${Date.now()}`,
              sender: "system",
              text: `⚠️ Request failed: ${errorText}. Operating in offline standalone mode.`,
              timestamp: new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
            },
          ]);
        }
      } finally {
        if (sessionEpochRef.current === requestEpoch) {
          setLoading(false);
        }
      }
    },
    [loading, selectedTenant, speakText, refreshQuestions]
  );

  // Direct Audio Voice Query handler
  const handleAudioVoiceQuery = useCallback(
    async (blob: Blob | File): Promise<boolean> => {
      if (loading) return false;
      setLoading(true);

      const requestEpoch = sessionEpochRef.current;
      abortControllerRef.current?.abort();
      const ac = new AbortController();
      abortControllerRef.current = ac;

      try {
        const res = await sendVoiceAudioQuery(blob, selectedTenant);
        if (sessionEpochRef.current !== requestEpoch) return false;

        if (res.silence) {
          return false;
        }

        if (res.safe_transcript) {
          // Voice feedback interception
          let voiceFeedbackCaptured = false;
          try {
            const vItem = await interceptChatComplaint(res.safe_transcript, profile);
            if (vItem) {
              voiceFeedbackCaptured = true;
              awardClinicalXP("feedback_logged", "Voice Feedback Captured (+3 XP)");
            }
          } catch {}

          setHistory((prev) =>
            prev.includes(res.safe_transcript)
              ? prev
              : [...prev, res.safe_transcript]
          );
          setMessages((prev) => [
            ...prev,
            {
              id: `user-${Date.now()}`,
              sender: "user",
              text: res.safe_transcript,
              timestamp: new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
              feedbackCaptured: voiceFeedbackCaptured,
            },
          ]);
        }

        const cards =
          res.coordinate_cards && res.coordinate_cards.length > 0
            ? res.coordinate_cards
            : res.coordinate_card
            ? [res.coordinate_card]
            : undefined;

        if (res.reply_text) {
          setMessages((prev) => [
            ...prev,
            {
              id: `bot-${Date.now()}`,
              sender: "assistant",
              text: res.reply_text!,
              timestamp: new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
              coordinateCards: cards,
              routingTier: res.routing_tier,
              isEducationalBaseline: res.is_educational_baseline,
              moveWidget: res.move_widget,
              implicitLearnPrompt: res.implicit_learn_prompt,
              teachingCard: res.teaching_card,
            },
          ]);

          speakText(res.reply_text);
          awardClinicalXP("lookup", "Voice Lookup: " + (res.safe_transcript || "Voice Query").slice(0, 30));
          if (res.teaching_card) {
            awardClinicalXP("lookup", "Taught facility lingo: " + res.teaching_card.slang);
          }
        }
        return true;
      } catch (err: unknown) {
        if (sessionEpochRef.current !== requestEpoch) return false;
        const errorText = err instanceof Error ? err.message : "Voice error";
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            sender: "system",
            text: `⚠️ Voice query failed: ${errorText}`,
            timestamp: new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
          },
        ]);
        return false;
      } finally {
        if (sessionEpochRef.current === requestEpoch) {
          setLoading(false);
        }
      }
    },
    [loading, selectedTenant, speakText]
  );

  // Push-to-Talk hooks
  const {
    isHoldingPTT,
    startPTT,
    stopPTT,
    voiceMode,
    livekitConfigured,
    toggleVoiceMode,
  } = usePushToTalk({
    tenantId: selectedTenant,
  });

  // Keep screen awake while app is open
  useWakeLock(true);

  // Move verification handler
  const handleVerifyPendingMove = async (item: string) => {
    try {
      const res = await verifyMove(selectedTenant, item);
      awardClinicalXP("inventory_fix", "Verified Move: " + item);
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-${Date.now()}`,
          sender: "system",
          text: res.reply_text,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      ]);
    } catch (err) {
      console.warn("Verify move offline, queueing to outbox:", err);
      await queueOfflineMutation({
        type: "verify_move",
        tenant_id: selectedTenant,
        item,
        timestamp: new Date().toISOString(),
      });
      awardClinicalXP("inventory_fix", "Verified Move (Offline): " + item);
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-offline-${Date.now()}`,
          sender: "system",
          text: `⚡ Offline: Verification for ${item} queued. Will sync when reconnected.`,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      ]);
    }
  };

  // Flag wrong location handler
  const handleFlagWrong = async (item: string) => {
    try {
      const res = await flagItemWrong(selectedTenant, item);
      awardClinicalXP("inventory_fix", "Location Flagged: " + item);
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-${Date.now()}`,
          sender: "system",
          text: `Flagged ${item} as incorrect location. Status: ${res.status || "needs_reverification"}. Peer review notified.`,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      ]);
    } catch (err) {
      console.warn("Flag wrong offline, queueing to outbox:", err);
      await queueOfflineMutation({
        type: "flag_wrong",
        tenant_id: selectedTenant,
        item,
        reason: "Location empty or item moved",
        timestamp: new Date().toISOString(),
      });
      awardClinicalXP("inventory_fix", "Location Flagged (Offline): " + item);
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-offline-${Date.now()}`,
          sender: "system",
          text: `⚡ Offline: Flag for ${item} queued. Will sync when reconnected.`,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      ]);
    }
  };

  // Implicit slang learning confirmation handler (Pathway B)
  const handleConfirmImplicitLearn = async (slangTerm: string, canonicalItem: string) => {
    try {
      const facId = selectedTenant.includes("::") ? selectedTenant.split("::")[0] : selectedTenant;
      learnAliasClient(facId, "or", slangTerm, canonicalItem, profile.email || "anonymous");
      await fetch("/api/lexicon/confirm-implicit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facility_id: facId,
          department_id: "or",
          slang_term: slangTerm,
          canonical_item: canonicalItem,
          user_id: profile.email || "anonymous",
        }),
      }).catch(() => {});

      awardClinicalXP("lookup", `Taught facility slang: ${slangTerm}`);
      const dispTerm = titleCaseTerm(slangTerm);
      const facDisplay = facId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-implicit-${Date.now()}`,
          sender: "assistant",
          text: `🧠 **Facility Lingo Learned (${facDisplay})**\n\nMapped **"${dispTerm}"** ↔ **${canonicalItem}**.\n\nEveryone in your facility can now search using either name, and we'll use your preferred term! (+5 XP)`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          teachingCard: {
            slang: dispTerm,
            canonical: canonicalItem,
            facility: facDisplay,
            xp_awarded: 5,
          },
        },
      ]);
    } catch (err) {
      console.error("Failed to confirm implicit learn:", err);
    }
  };

  // Paperclip & Drag-and-Drop file ingestion
  const handleFileUpload = async (file: File) => {
    try {
      setLoading(true);
      const res = await ingestFile(selectedTenant, file);
      const detail =
        res.rows_loaded !== undefined
          ? `${res.rows_loaded} rows hot-reloaded into memory`
          : `${res.characters_loaded ?? 0} chars hot-reloaded into RAG`;
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-${Date.now()}`,
          sender: "system",
          text: `✓ Ingested ${file.name} (${res.file_type}): ${detail}`,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      ]);
      syncTenantInventoryToOfflineDb(selectedTenant).then((count) => {
        if (count > 0) setOfflineSyncedCount(count);
      });
    } catch (err: unknown) {
      const errorText = err instanceof Error ? err.message : "Ingest failed";
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-${Date.now()}`,
          sender: "system",
          text: `⚠️ Ingestion failed: ${errorText}`,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  // + New Case: auto-archives current session, wipes canvas, and assigns fresh sessionId
  const handleNewCase = useCallback(async () => {
    sessionEpochRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    setLoading(false);

    // Auto-archive active session before wiping canvas
    if (messages.length > 0) {
      const firstUser = messages.find((m) => m.sender === "user");
      const title = firstUser
        ? firstUser.text.slice(0, 42).replace(/[\r\n]+/g, " ") + (firstUser.text.length > 42 ? "…" : "")
        : "Case Session";

      const sessionPayload: ChatSession = {
        sessionId: currentSessionId,
        tenantId: selectedTenant,
        title,
        updatedAt: new Date().toISOString(),
        messages,
      };
      await saveChatSession(sessionPayload);
      const updatedList = await listChatSessions(selectedTenant);
      setPastSessions(updatedList);
    }

    const nextSessionId = `session_${Date.now()}`;
    setCurrentSessionId(nextSessionId);

    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(`ornav_active_case_${selectedTenant}`);
        localStorage.setItem(`ornav_active_session_id_${selectedTenant}`, nextSessionId);
        if ("speechSynthesis" in window) {
          window.speechSynthesis.cancel();
        }
      } catch {}
    }
    setMessages([]);
  }, [selectedTenant, messages, currentSessionId]);

  // Phase 29.1: Multi-Session Case History switching & management
  const handleSelectPastSession = useCallback(
    async (sessionId: string) => {
      if (sessionId === currentSessionId) return;

      // 1. Auto-save current active session before switching
      if (messages.length > 0) {
        const firstUser = messages.find((m) => m.sender === "user");
        const title = firstUser
          ? firstUser.text.slice(0, 42).replace(/[\r\n]+/g, " ") + (firstUser.text.length > 42 ? "…" : "")
          : "Case Session";

        await saveChatSession({
          sessionId: currentSessionId,
          tenantId: selectedTenant,
          title,
          updatedAt: new Date().toISOString(),
          messages,
        });
      }

      // 2. Fetch the target past session
      const target = await getChatSession(sessionId);
      if (target) {
        isHydratedRef.current = false;
        setCurrentSessionId(target.sessionId);
        setMessages(target.messages || []);
        if (typeof window !== "undefined") {
          localStorage.setItem(
            `ornav_active_case_${selectedTenant}`,
            JSON.stringify(target.messages || [])
          );
          localStorage.setItem(
            `ornav_active_session_id_${selectedTenant}`,
            target.sessionId
          );
        }
        const updatedList = await listChatSessions(selectedTenant);
        setPastSessions(updatedList);
        setTimeout(() => {
          isHydratedRef.current = true;
        }, 50);
      }
    },
    [currentSessionId, messages, selectedTenant]
  );

  const handleDeletePastSession = useCallback(
    async (sessionId: string) => {
      await deleteChatSession(sessionId);
      if (sessionId === currentSessionId) {
        handleNewCase();
      } else {
        const updatedList = await listChatSessions(selectedTenant);
        setPastSessions(updatedList);
      }
    },
    [currentSessionId, handleNewCase, selectedTenant]
  );

  const handleClearAllPastSessions = useCallback(
    async () => {
      await clearChatSessions(selectedTenant);
      setPastSessions([]);
      handleNewCase();
    },
    [selectedTenant, handleNewCase]
  );

  // Instant Department / Clinical Role Switching
  const handleDepartmentSwitch = useCallback(
    (deptId: string) => {
      const clean = deptId === "general_memorial_cvor" ? "or_main" : deptId;
      setSelectedTenant(clean);
      setActiveDepartmentId(clean);
      setMobileSidebarOpen(false);
      handleNewCase();
    },
    [handleNewCase]
  );

  // Save updated user profile & align active department
  const handleSaveProfile = useCallback(
    (newProfile: UserProfile) => {
      saveProfile(newProfile);
      if (newProfile.departmentId && newProfile.departmentId !== selectedTenant) {
        handleDepartmentSwitch(newProfile.departmentId);
      }
    },
    [saveProfile, selectedTenant, handleDepartmentSwitch]
  );

  if (authChecked && !authSession) {
    return <AuthScreen onAuthSuccess={handleAuthSuccess} />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#09090b]">
      {/* Desktop Left Sidebar (Collapsible) */}
      {!sidebarCollapsed && (
        <div className="hidden md:block h-full">
          <Sidebar
            tenants={tenants}
            selectedTenant={selectedTenant}
            onSelectTenant={handleDepartmentSwitch}
            onNewCase={handleNewCase}
            autoTts={autoTts}
            onToggleTts={() => setAutoTts(!autoTts)}
            handsFreeActive={handsFreeUntil !== null}
            onStartHandsFree15Min={startHandsFree15Min}
            offlineSyncedCount={offlineSyncedCount}
            onSelectStarterPrompt={handleSendMessage}
            loading={loading}
            voiceMode={voiceMode}
            livekitConfigured={livekitConfigured}
            onToggleVoiceMode={toggleVoiceMode}
            onOpenQRPair={() => setQrModalOpen(true)}
            history={history}
            updateAvailable={updateAvailable}
            updateInfo={updateInfo}
            onDismissUpdate={dismissUpdate}
            userProfile={profile}
            onOpenProfileModal={(tab) => {
              setProfileModalTab(tab || "assignment");
              setProfileModalOpen(true);
            }}
            onOpenResourceManager={() => setResourceModalOpen(true)}
            onOpenPeerQnA={() => {
              setPeerQnAPrefill("");
              setPeerQnAOpen(true);
            }}
            onOpenFeedbackModal={() => setFeedbackModalOpen(true)}
            appSettings={appSettings}
            onToggleAutoUpdate={handleToggleAutoUpdate}
            onToggleAutoSync={handleToggleAutoSync}
            onCheckForUpdates={checkForUpdate}
            onManualSync={triggerSync}
            pastSessions={pastSessions}
            currentSessionId={currentSessionId}
            onSelectSession={handleSelectPastSession}
            onDeleteSession={handleDeletePastSession}
            onClearAllSessions={handleClearAllPastSessions}
            onSignOut={handleSignOut}
          />
        </div>
      )}

      {/* Mobile Drawer Overlay */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden bg-black/80 backdrop-blur-sm">
          <div className="relative w-72 max-w-[85%] h-full bg-[#121215]">
            <button
              onClick={() => setMobileSidebarOpen(false)}
              className="absolute top-3.5 right-3.5 p-1.5 text-zinc-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
            <Sidebar
              tenants={tenants}
              selectedTenant={selectedTenant}
              onSelectTenant={handleDepartmentSwitch}
              onNewCase={() => {
                handleNewCase();
                setMobileSidebarOpen(false);
              }}
              autoTts={autoTts}
              onToggleTts={() => setAutoTts(!autoTts)}
              handsFreeActive={handsFreeUntil !== null}
              onStartHandsFree15Min={startHandsFree15Min}
              offlineSyncedCount={offlineSyncedCount}
              onSelectStarterPrompt={(prompt) => {
                handleSendMessage(prompt);
                setMobileSidebarOpen(false);
              }}
              loading={loading}
              voiceMode={voiceMode}
              livekitConfigured={livekitConfigured}
              onToggleVoiceMode={toggleVoiceMode}
              onOpenQRPair={() => {
                setMobileSidebarOpen(false);
                setQrModalOpen(true);
              }}
              history={history}
              updateAvailable={updateAvailable}
              updateInfo={updateInfo}
              onDismissUpdate={dismissUpdate}
              userProfile={profile}
              onOpenProfileModal={(tab) => {
                setMobileSidebarOpen(false);
                setProfileModalTab(tab || "assignment");
                setProfileModalOpen(true);
              }}
              onOpenResourceManager={() => {
                setMobileSidebarOpen(false);
                setResourceModalOpen(true);
              }}
              onOpenPeerQnA={() => {
                setMobileSidebarOpen(false);
                setPeerQnAPrefill("");
                setPeerQnAOpen(true);
              }}
              onOpenFeedbackModal={() => {
                setMobileSidebarOpen(false);
                setFeedbackModalOpen(true);
              }}
              appSettings={appSettings}
              onToggleAutoUpdate={handleToggleAutoUpdate}
              onToggleAutoSync={handleToggleAutoSync}
              onCheckForUpdates={checkForUpdate}
              onManualSync={triggerSync}
              pastSessions={pastSessions}
              currentSessionId={currentSessionId}
              onSelectSession={(sessionId) => {
                handleSelectPastSession(sessionId);
                setMobileSidebarOpen(false);
              }}
              onDeleteSession={handleDeletePastSession}
              onClearAllSessions={handleClearAllPastSessions}
              onSignOut={handleSignOut}
            />
          </div>
        </div>
      )}

      {/* Main Single-Screen Chat Canvas & Omnibar */}
      <main
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className="flex-1 flex flex-col h-full overflow-hidden bg-[#09090b]"
      >
        {/* Ultra-Minimal Top Header */}
        <header className="h-12 border-b border-zinc-800 bg-[#09090b] px-3 sm:px-4 flex items-center justify-between shrink-0 z-10">
          {/* Left: Sidebar Toggle + Title */}
          <div className="flex items-center gap-2.5">
            {/* Mobile Hamburger */}
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="md:hidden p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
              title="Open Navigation"
            >
              <Menu className="w-4 h-4" />
            </button>

            {/* Desktop Sidebar Toggle */}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="hidden md:flex p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
              title={sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            >
              <PanelLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2">
              <span className="font-semibold text-zinc-100 text-sm tracking-tight">
                OR-Nav
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-zinc-400 bg-zinc-800/80 border border-zinc-800">
                {CURRENT_VERSION}
              </span>

              {/* Active Clinician Profile & Clinical Assignment Badge */}
              <button
                type="button"
                onClick={() => setProfileModalOpen(true)}
                title="Edit User Profile & Clinical Assignment"
                data-testid="header-profile-badge"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/60 text-xs text-zinc-200 font-medium transition-colors cursor-pointer"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span className="truncate max-w-[130px] sm:max-w-[260px]">
                  {profile.fullName} • {activeDept.shortName} • {profile.clinicalRole}
                </span>
                <ChevronDown className="w-3 h-3 text-zinc-400 shrink-0" />
              </button>
            </div>
          </div>

          {/* Right: Sync Status + Unanswered Dept Questions Pill + QR Pair + New Case */}
          <div className="flex items-center gap-1.5">
            {/* Background Sync Engine Status Pill */}
            <button
              type="button"
              onClick={() => triggerSync()}
              title="Click to trigger background sync"
              data-testid="header-sync-pill"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono border transition-colors cursor-pointer ${
                syncStatus === "syncing"
                  ? "bg-amber-950/40 border-amber-800/60 text-amber-300"
                  : syncStatus === "offline"
                  ? "bg-zinc-900 border-zinc-800 text-zinc-400"
                  : "bg-zinc-900/60 border-zinc-800 text-emerald-400 hover:bg-zinc-800"
              }`}
            >
              <span className="truncate max-w-[120px] sm:max-w-none">
                {statusLabel}
              </span>
            </button>

            {/* Over-The-Air Update Pill (if available) */}
            {updateAvailable && updateInfo && (
              <button
                type="button"
                onClick={() => openApkDownload(updateInfo.apk_download_url)}
                title={`New update ${updateInfo.version} ready — click to download APK`}
                data-testid="header-update-pill"
                className="hidden xs:flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-950/80 hover:bg-emerald-900/80 border border-emerald-500/50 text-emerald-300 text-[10px] font-mono font-semibold transition-colors shadow-sm cursor-pointer"
              >
                <span>✨ {updateInfo.version}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setQuestionsDrawerOpen(true)}
              title="Open Unanswered Dept Questions Feed"
              className="px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-mono text-zinc-300 hover:text-zinc-100 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
              <span>💬 {openQuestionsCount} Unanswered</span>
            </button>

            <button
              onClick={() => setQrModalOpen(true)}
              title="Pair Mobile Device (QR Code)"
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <QrCode className="w-4 h-4" />
            </button>

            <button
              onClick={handleNewCase}
              title="New Case (Clear Session)"
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <SquarePen className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Scrollable Chat Feed */}
        <ChatCanvas
          messages={messages}
          loading={loading}
          tenantId={selectedTenant}
          onVerifyPendingMove={handleVerifyPendingMove}
          onFlagWrong={handleFlagWrong}
          onSpeakSingleMessage={speakSingleMessage}
          onStarterChipClick={handleSendMessage}
          onConfirmImplicitLearn={handleConfirmImplicitLearn}
          onSaveQuickAddItem={async (item, loc, cat) => {
            try {
              const card = await addInventoryItemApi(item, loc, selectedTenant, cat || "Supplies");
              awardClinicalXP("inventory_fix", `Added "${card.item}" to Inventory (+5 XP)`);
              setMessages((prev) => [
                ...prev,
                {
                  id: `sys-${Date.now()}`,
                  sender: "assistant",
                  text: `✓ Added "${card.item}" to ${card.full_code}.`,
                  timestamp: new Date().toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                  coordinateCard: card,
                  coordinateCards: [card],
                  routingTier: "TIER_1_LOCAL_CSV",
                },
              ]);
            } catch (err) {
              console.error("Failed to add inventory item:", err);
            }
          }}
          onAskDepartmentPeers={(qContext) => {
            setPeerQnAPrefill(qContext || "");
            setPeerQnAOpen(true);
          }}
        />

        {/* Unified Bottom Omnibar with PTT & Voice Mode */}
        <Omnibar
          onSendMessage={handleSendMessage}
          onFileUpload={handleFileUpload}
          onAudioVoiceQuery={handleAudioVoiceQuery}
          disabled={loading}
          voiceMode={voiceMode}
          isHoldingPTT={isHoldingPTT}
          onStartPTT={startPTT}
          onStopPTT={stopPTT}
          placeholder={activeDept.placeholder}
        />
      </main>

      {/* Unanswered Department Questions Slide-Over Drawer */}
      <QuestionsDrawer
        isOpen={questionsDrawerOpen}
        onClose={() => setQuestionsDrawerOpen(false)}
        tenantId={selectedTenant}
        questions={questions}
        onRefreshQuestions={refreshQuestions}
      />

      {/* QR Code Wi-Fi Pairing Modal */}
      <QRPairModal isOpen={qrModalOpen} onClose={() => setQrModalOpen(false)} />

      {/* User Profile & Clinical Assignment Modal */}
      <UserProfileModal
        isOpen={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        currentProfile={profile}
        initialTab={profileModalTab}
        onSaveProfile={(updated) => {
          handleSaveProfile(updated);
          setIsOnboardingMode(false);
          setProfileModalOpen(false);
          if (authSession) {
            setAuthSession({
              ...authSession,
              onboardingCompleted: true,
              profile: updated,
            });
          }
        }}
        onOpenResourceManager={() => {
          setProfileModalOpen(false);
          setResourceModalOpen(true);
        }}
        onboardingMode={isOnboardingMode}
        onSignOut={handleSignOut}
      />

      {/* Floating XP Micro-Feedback Toast Pill */}
      {xpToast && (
        <aside
          role="status"
          aria-live="polite"
          data-testid="xp-toast-pill"
          className="fixed top-3 right-3 sm:top-4 sm:right-4 z-50 flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-zinc-950/95 border border-emerald-500/50 text-zinc-100 shadow-2xl backdrop-blur-md animate-in slide-in-from-top-2 duration-200 pointer-events-none"
        >
          <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-sm shrink-0">
            {xpToast.levelUp ? "🏆" : xpToast.badgeUnlocked ? "🎖️" : "✨"}
          </div>
          <div className="text-xs">
            <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
              <span>+{xpToast.amount} XP</span>
              {xpToast.levelUp && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  LEVEL UP! (Lv.{xpToast.level})
                </span>
              )}
            </div>
            <div className="text-[11px] text-zinc-300 truncate max-w-[220px]">
              {xpToast.badgeUnlocked ? `Badge: ${xpToast.badgeUnlocked.title}!` : xpToast.label}
            </div>
          </div>
        </aside>
      )}

      {/* On-Demand Hospital Knowledge Packs & Resource Manager Modal */}
      <ResourceManagerModal
        isOpen={resourceModalOpen}
        onClose={() => setResourceModalOpen(false)}
        activeProfile={profile}
      />

      {/* Over-The-Air (OTA) Auto-Update Prompt Modal */}
      <AutoUpdateModal
        isOpen={updateAvailable && !dismissed}
        onClose={dismissUpdate}
        manifest={updateInfo}
        currentVersion={currentVersion}
        currentBuild={currentBuild}
      />

      {/* Orientee Question & Multi-Peer Verification Ping Modal (Phase 31) */}
      <PeerQnAPanel
        isOpen={peerQnAOpen}
        onClose={() => setPeerQnAOpen(false)}
        tenantId={selectedTenant}
        userProfile={profile}
        prefillQuestion={peerQnAPrefill}
      />

      {/* Feedback & Dev Recommendations Hub Modal (Phase 36) */}
      <FeedbackModal
        isOpen={feedbackModalOpen}
        onClose={() => setFeedbackModalOpen(false)}
        userProfile={profile}
      />
    </div>
  );
}
