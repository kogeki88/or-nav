"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import ChatCanvas, { MessageItem } from "@/components/ChatCanvas";
import Omnibar from "@/components/Omnibar";
import { QRPairModal } from "@/components/QRPairModal";
import QuestionsDrawer from "@/components/QuestionsDrawer";
import {
  fetchTenants,
  sendChatMessage,
  sendVoiceAudioQuery,
  verifyMove,
  flagItemWrong,
  fetchQuestions,
  ingestFile,
  DepartmentQuestion,
} from "@/lib/api";
import {
  syncTenantInventoryToOfflineDb,
  queueOfflineMutation,
  flushOfflineOutbox,
} from "@/lib/offlineDb";
import { scrubPhi } from "@/lib/scrubClient";
import { usePushToTalk } from "@/hooks/usePushToTalk";
import { useWakeLock } from "@/hooks/useWakeLock";
import { Menu, X, PanelLeft, QrCode, SquarePen, MessageSquare } from "lucide-react";

export default function Home() {
  const [tenants, setTenants] = useState<string[]>(["general_memorial_cvor"]);
  const [selectedTenant, setSelectedTenant] = useState<string>("general_memorial_cvor");
  const [messages, setMessages] = useState<MessageItem[]>([]);
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

  // Vector 6: Session epoch & AbortController to discard in-flight responses on + New Case or tenant switch
  const sessionEpochRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load available tenants from backend
  useEffect(() => {
    fetchTenants()
      .then((data) => {
        if (data.tenants && data.tenants.length > 0) {
          setTenants(data.tenants);
          if (data.default) setSelectedTenant(data.default);
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
    syncTenantInventoryToOfflineDb(selectedTenant).then((count) => {
      if (count > 0) setOfflineSyncedCount(count);
    });
  }, [selectedTenant, refreshQuestions]);

  // Vector 6: Restore active case messages from sessionStorage on load / tenant switch
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = sessionStorage.getItem(`ornav_active_case_${selectedTenant}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      }
    } catch (e) {
      console.warn("Could not restore case session from storage:", e);
    }
  }, [selectedTenant]);

  // Vector 6: Persist active case messages into sessionStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (messages.length > 0) {
        sessionStorage.setItem(`ornav_active_case_${selectedTenant}`, JSON.stringify(messages));
      } else {
        sessionStorage.removeItem(`ornav_active_case_${selectedTenant}`);
      }
    } catch (e) {
      console.warn("Could not persist case session to storage:", e);
    }
  }, [messages, selectedTenant]);

  // Vector 5: Auto-flush offline mutation outbox when network reconnects
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOnline = () => {
      flushOfflineOutbox().then((flushed) => {
        if (flushed > 0) {
          setMessages((prev) => [
            ...prev,
            {
              id: `sys-sync-${Date.now()}`,
              sender: "system",
              text: `✓ Reconnected: Synced ${flushed} offline action(s) to hospital database.`,
              timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            },
          ]);
        }
      });
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

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

      const userMsgId = `user-${Date.now()}`;
      const userMessage: MessageItem = {
        id: userMsgId,
        sender: "user",
        text: clientScrubbed,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        clientPhiDetected,
      };

      setMessages((prev) => [...prev, userMessage]);
      setLoading(true);

      try {
        const { response } = await sendChatMessage(rawMessage, selectedTenant, ac.signal);

        // Vector 6: If + New Case or Tenant Switch occurred mid-flight, discard stale response!
        if (sessionEpochRef.current !== requestEpoch) {
          return;
        }

        const cards =
          response.coordinate_cards && response.coordinate_cards.length > 0
            ? response.coordinate_cards
            : response.coordinate_card
            ? [response.coordinate_card]
            : [];

        const assistantMessage: MessageItem = {
          id: `assistant-${Date.now()}`,
          sender: "assistant",
          text: response.reply_text,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          phiDetected: response.phi_detected || clientPhiDetected,
          clientPhiDetected,
          routingTier: response.routing_tier,
          latencyMs: response.latency_ms,
          isEducationalBaseline: response.is_educational_baseline,
          coordinateCard: response.coordinate_card,
          coordinateCards: cards,
          moveWidget: response.move_widget,
        };

        setMessages((prev) => [...prev, assistantMessage]);

        // Deep Vector 5: Invalidate & Re-sync IndexedDB cache immediately when move reported
        if (response.routing_tier === "MOVE_REPORTED") {
          syncTenantInventoryToOfflineDb(selectedTenant).then((count) => {
            if (count > 0) setOfflineSyncedCount(count);
          });
        }

        if (response.reply_text) {
          speakText(response.reply_text);
        }
      } catch (err: unknown) {
        if (sessionEpochRef.current !== requestEpoch) {
          return;
        }
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        const errorText = err instanceof Error ? err.message : "Error communicating with OR-Nav";
        const errorMsg: MessageItem = {
          id: `error-${Date.now()}`,
          sender: "system",
          text: `⚠️ Network error: ${errorText}`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        if (sessionEpochRef.current === requestEpoch) {
          setLoading(false);
        }
      }
    },
    [loading, selectedTenant, speakText]
  );

  // Hook up Voice Push-to-Talk -> strictly queries OR-Nav AI assistant
  const handleVoiceTranscribed = useCallback(
    (text: string) => {
      handleSendMessage(text);
    },
    [handleSendMessage]
  );

  // Handle MediaRecorder / native audio capture -> POST /api/v1/voice-query.
  // Returns true if a real query was routed, false on silence (nothing posted to chat).
  const handleAudioVoiceQuery = useCallback(
    async (audioBlob: Blob | File): Promise<boolean> => {
      if (loading) return false;
      setLoading(true);
      try {
        const response = await sendVoiceAudioQuery(audioBlob, selectedTenant);
        if (response.silence || !response.safe_transcript || !response.reply_text) {
          return false;
        }
        const queryText = response.safe_transcript;
        setHistory((prev) => (prev.includes(queryText) ? prev : [...prev, queryText]));

        const userMsg: MessageItem = {
          id: `user-voice-${Date.now()}`,
          sender: "user",
          text: queryText,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          clientPhiDetected: response.phi_detected,
        };

        const assistantMsg: MessageItem = {
          id: `assistant-voice-${Date.now()}`,
          sender: "assistant",
          text: response.reply_text,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          phiDetected: response.phi_detected,
          routingTier: response.routing_tier,
          latencyMs: response.latency_ms,
          isEducationalBaseline: response.is_educational_baseline,
          coordinateCard: response.coordinate_card ?? null,
          moveWidget: response.move_widget ?? null,
        };

        setMessages((prev) => [...prev, userMsg, assistantMsg]);
        speakText(response.reply_text);
        return true;
      } catch (err: unknown) {
        const errorText = err instanceof Error ? err.message : "Voice query failed";
        setMessages((prev) => [
          ...prev,
          {
            id: `err-voice-${Date.now()}`,
            sender: "system",
            text: `⚠️ Voice transcription error: ${errorText}`,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        ]);
        return true;
      } finally {
        setLoading(false);
      }
    },
    [loading, selectedTenant, speakText]
  );

  const handleLiveKitUiSync = useCallback((data: any) => {
    const livekitMsgId = `assistant-livekit-${Date.now()}`;
    const msg: MessageItem = {
      id: livekitMsgId,
      sender: "assistant",
      text: data.reply_text || data.message || "",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      routingTier: data.tier || "TIER_1_LOCAL_CSV",
      coordinateCard: data.coordinate_card || null,
      moveWidget: data.move_widget || null,
    };
    setMessages((prev) => [...prev, msg]);
  }, []);

  const {
    voiceMode,
    isHoldingPTT,
    livekitConfigured,
    startPTT,
    stopPTT,
    toggleVoiceMode,
  } = usePushToTalk({
    tenantId: selectedTenant,
    onSpeechTranscript: handleVoiceTranscribed,
    onDataChannelSync: handleLiveKitUiSync,
  });

  // Vector 7: Keep screen awake during 15-Min Hands-Free mode or while recording
  const isHandsFreeActive = (handsFreeUntil !== null && Date.now() < handsFreeUntil) || isHoldingPTT;
  useWakeLock(isHandsFreeActive);

  // Verify Move from widget (Vector 5: Offline outbox fallback)
  const handleVerifyPendingMove = async (item: string) => {
    try {
      const res = await verifyMove(selectedTenant, item);
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-${Date.now()}`,
          sender: "system",
          text: `✓ Verification recorded for ${res.item} (${res.verify_count}/3). ${
            res.committed ? "Relocation committed to master database." : ""
          }`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
      // Invalidate & Re-sync local IndexedDB offline cache
      syncTenantInventoryToOfflineDb(selectedTenant).then((count) => {
        if (count > 0) setOfflineSyncedCount(count);
      });
    } catch (err) {
      console.warn("Move verification offline, queueing to outbox:", err);
      await queueOfflineMutation({
        type: "verify_move",
        tenant_id: selectedTenant,
        item,
        timestamp: new Date().toISOString(),
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-offline-${Date.now()}`,
          sender: "system",
          text: `⚡ Offline: Move confirmation for ${item} queued. Will sync when reconnected.`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    }
  };

  // Explicit Flag Empty / Moved (Vector 5: Offline outbox fallback)
  const handleFlagWrong = async (item: string) => {
    try {
      await flagItemWrong(selectedTenant, item, "Flagged empty or relocated from CoordinateCard");
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-flag-${Date.now()}`,
          sender: "system",
          text: `⚠️ Flagged ${item} for re-verification (score dropped to 0.5).`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
      // Invalidate & Re-sync local IndexedDB offline cache
      syncTenantInventoryToOfflineDb(selectedTenant).then((count) => {
        if (count > 0) setOfflineSyncedCount(count);
      });
    } catch (err) {
      console.warn("Flag wrong offline, queueing to outbox:", err);
      await queueOfflineMutation({
        type: "flag_wrong",
        tenant_id: selectedTenant,
        item,
        reason: "Location empty or item moved",
        timestamp: new Date().toISOString(),
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-offline-${Date.now()}`,
          sender: "system",
          text: `⚡ Offline: Flag for ${item} queued. Will sync when reconnected.`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
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
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
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
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
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

  // + New Case: wipes session, aborts in-flight requests, and returns to pure empty state
  const handleNewCase = () => {
    sessionEpochRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    setLoading(false);
    if (typeof window !== "undefined") {
      try {
        sessionStorage.removeItem(`ornav_active_case_${selectedTenant}`);
        if ("speechSynthesis" in window) {
          window.speechSynthesis.cancel();
        }
      } catch {}
    }
    setMessages([]);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#09090b]">
      {/* Desktop Left Sidebar (Collapsible) */}
      {!sidebarCollapsed && (
        <div className="hidden md:block h-full">
          <Sidebar
            tenants={tenants}
            selectedTenant={selectedTenant}
            onSelectTenant={(t) => {
              setSelectedTenant(t);
              handleNewCase();
            }}
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
              onSelectTenant={(t) => {
                setSelectedTenant(t);
                setMobileSidebarOpen(false);
                handleNewCase();
              }}
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

            <div className="flex items-baseline gap-1.5">
              <span className="font-semibold text-zinc-100 text-sm tracking-tight">OR-Nav</span>
              <span className="text-xs text-zinc-500 font-mono hidden sm:inline">
                / {selectedTenant.replace(/_/g, " ")}
              </span>
            </div>
          </div>

          {/* Right: Unanswered Dept Questions Pill + QR Pair + New Case */}
          <div className="flex items-center gap-1.5">
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
    </div>
  );
}
