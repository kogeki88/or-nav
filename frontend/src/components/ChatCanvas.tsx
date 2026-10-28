"use client";

import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CoordinateCardData, MoveWidgetData } from "@/lib/api";
import CoordinateCard from "./CoordinateCard";
import MoveVerifyWidget from "./MoveVerifyWidget";
import { Shield, Sparkles, BookOpen, Volume2, Users, PlusCircle, Check } from "lucide-react";
import { getDepartment } from "@/lib/departments";

export interface QuickAddWidgetData {
  item: string;
  suggested_location?: string;
}

export interface MessageItem {
  id: string;
  sender: "user" | "assistant" | "system";
  text: string;
  timestamp: string;
  phiDetected?: boolean;
  clientPhiDetected?: boolean;
  routingTier?: "TIER_1_LOCAL_CSV" | "TIER_2_GEMINI_RAG" | "MOVE_REPORTED" | "RBAC_RESTRICTED";
  latencyMs?: number;
  isEducationalBaseline?: boolean;
  coordinateCard?: CoordinateCardData | null;
  coordinateCards?: CoordinateCardData[];
  moveWidget?: MoveWidgetData | null;
  feedbackCaptured?: boolean;
  spokenTranscriptCorrection?: string;
  disambiguationChips?: string[];
  quickAddWidget?: QuickAddWidgetData | null;
}

interface ChatCanvasProps {
  messages: MessageItem[];
  loading: boolean;
  tenantId: string;
  onVerifyPendingMove: (item: string) => Promise<void>;
  onFlagWrong?: (item: string) => Promise<void>;
  onSpeakSingleMessage?: (text: string) => void;
  onStarterChipClick?: (prompt: string) => void;
  onAskDepartmentPeers?: (questionContext?: string) => void;
  onSaveQuickAddItem?: (item: string, location: string, category?: string) => Promise<void>;
}

const STARTER_PROMPTS = [
  { label: "Where is 3-0 Silk?", prompt: "where is 3-0 silk" },
  { label: "Dr. Patel's suture preferences", prompt: "What sutures does Dr. Patel prefer?" },
  { label: "MH Cart & Dantrolene dose", prompt: "What is the Dantrolene dosing for malignant hyperthermia?" },
  { label: "Report an item moved", prompt: "The 3-0 silk moved to OR 21 B 1 A" },
];

function InlineQuickAddCard({
  item,
  tenantId,
  onSave,
}: {
  item: string;
  tenantId: string;
  onSave?: (item: string, location: string, category?: string) => Promise<void>;
}) {
  const [location, setLocation] = React.useState("OR 21 B 1 A");
  const [category, setCategory] = React.useState("Supplies");
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  const handleCommit = async () => {
    if (!onSave || !location.trim()) return;
    setSaving(true);
    try {
      await onSave(item, location.trim(), category);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div
        data-testid="inline-quick-add-saved"
        className="w-full bg-emerald-950/30 border border-emerald-800/40 rounded-xl p-3 text-xs text-emerald-300 flex items-center gap-2"
      >
        <Check className="w-4 h-4 text-emerald-400" />
        <span>✓ "{item}" saved to inventory at {location} (+5 XP)</span>
      </div>
    );
  }

  return (
    <div
      data-testid="inline-quick-add-card"
      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3.5 space-y-3 shadow-lg"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5 font-mono uppercase tracking-wider">
          <PlusCircle className="w-4 h-4 text-emerald-400" />
          <span>Add to Department Inventory</span>
        </span>
        <span className="text-[10px] font-mono bg-emerald-500/10 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/20">
          +5 XP
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div>
          <label className="text-[11px] text-zinc-400 font-mono">Item Name</label>
          <input
            type="text"
            readOnly
            value={item}
            className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-200 font-medium"
          />
        </div>
        <div>
          <label className="text-[11px] text-zinc-400 font-mono">Location Coordinate</label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. OR 21 B 1 A, Rack 4 Shelf A"
            className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-700 text-zinc-100 font-mono focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={handleCommit}
        disabled={saving || !location.trim()}
        data-testid="save-quick-add-btn"
        className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
      >
        <Check className="w-3.5 h-3.5" />
        <span>{saving ? "Saving..." : "✓ Save Item to Inventory (+5 XP)"}</span>
      </button>
    </div>
  );
}

export default function ChatCanvas({
  messages,
  loading,
  tenantId,
  onVerifyPendingMove,
  onFlagWrong,
  onSpeakSingleMessage,
  onStarterChipClick,
  onAskDepartmentPeers,
  onSaveQuickAddItem,
}: ChatCanvasProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const dept = getDepartment(tenantId);
  const starterPrompts = dept.starterPrompts;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 space-y-5 bg-[#09090b]">
      {/* Empty State: Centered Minimalist Welcome */}
      {messages.length === 0 && (
        <div className="h-full min-h-[60vh] flex flex-col items-center justify-center text-center px-4 max-w-lg mx-auto">
          <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4 text-zinc-300">
            <Sparkles className="w-5 h-5 text-zinc-400" />
          </div>
          <h2 className="text-lg sm:text-xl font-semibold text-zinc-100 tracking-tight mb-1.5">
            {dept.id === "or_main" ? "What do you need for this case?" : `What do you need in ${dept.shortName}?`}
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400 mb-6 max-w-sm leading-relaxed">
            Instant {dept.name} storage coordinates, supply locations, and unit protocols.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
            {starterPrompts.map((item, idx) => (
              <button
                key={idx}
                onClick={() => onStarterChipClick?.(item.prompt)}
                className="text-left px-3.5 py-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800/80 active:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-300 hover:text-zinc-100 transition-colors cursor-pointer"
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onAskDepartmentPeers?.()}
              className="col-span-1 sm:col-span-2 text-left px-3.5 py-2.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 active:bg-amber-500/25 border border-amber-500/30 text-xs text-amber-300 transition-colors cursor-pointer flex items-center justify-between"
            >
              <span className="flex items-center gap-2 font-medium">
                <Users className="w-3.5 h-3.5 text-amber-400" />
                <span>Orientee doubt? Ask department peers</span>
              </span>
              <span className="text-[10px] font-mono bg-amber-500/20 px-2 py-0.5 rounded-full text-amber-200">Peer Ping</span>
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <AnimatePresence initial={false}>
        {messages.map((msg) => {
          if (msg.sender === "system") {
            return (
              <div key={msg.id} className="flex justify-center my-2">
                <span className="text-[11px] text-zinc-500 font-mono bg-zinc-900/60 px-2.5 py-1 rounded-full border border-zinc-800/60">
                  {msg.text}
                </span>
              </div>
            );
          }

          if (msg.sender === "user") {
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                className="flex flex-col items-end space-y-1"
              >
                <div className="max-w-[85%] sm:max-w-[70%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-zinc-800 text-zinc-100 text-sm leading-relaxed">
                  <div className="whitespace-pre-wrap break-words">{msg.text}</div>
                </div>
                {msg.feedbackCaptured && (
                  <span
                    data-testid="feedback-captured-pill"
                    className="text-[10px] text-indigo-400 font-medium flex items-center gap-1 mr-1 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20 animate-fadeIn"
                  >
                    💡 Logged to Developer Feedback (+3 XP)
                  </span>
                )}
                {msg.spokenTranscriptCorrection && (
                  <span
                    data-testid="speech-normalized-pill"
                    className="text-[10px] text-emerald-400 font-mono flex items-center gap-1 mr-1 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20"
                  >
                    🎙️ {msg.spokenTranscriptCorrection}
                  </span>
                )}
                {msg.clientPhiDetected && (
                  <span className="text-[10px] text-zinc-500 font-mono flex items-center gap-1 mr-1">
                    <Shield className="w-3 h-3 text-zinc-400" /> PHI Redacted
                  </span>
                )}
              </motion.div>
            );
          }

          // Assistant Message
          const isPhiScrubbed = msg.phiDetected || msg.clientPhiDetected;

          return (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
              className="flex flex-col items-start space-y-1.5 max-w-[95%] sm:max-w-[85%]"
            >
              {/* Global Educational Baseline Distinction Badge */}
              {msg.isEducationalBaseline && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-950/30 border border-amber-800/50 text-[11px] font-mono text-amber-300">
                  <BookOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>📘 Standard Clinical Reference — Defer to Facility Policy</span>
                </div>
              )}

              {/* Voice Transcript Normalization Pill */}
              {msg.spokenTranscriptCorrection && (
                <div
                  data-testid="speech-normalized-pill"
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-mono text-emerald-300"
                >
                  <span>🎙️ {msg.spokenTranscriptCorrection}</span>
                </div>
              )}

              {/* Text Body & Coordinate Card(s) */}
              {(() => {
                const cards =
                  msg.coordinateCards && msg.coordinateCards.length > 0
                    ? msg.coordinateCards
                    : msg.coordinateCard
                    ? [msg.coordinateCard]
                    : [];

                if (cards.length === 0) {
                  const needsPeerHelp =
                    msg.text &&
                    (msg.text.includes("Could not find") ||
                      msg.text.includes("⚠️") ||
                      msg.text.includes("not find") ||
                      msg.isEducationalBaseline ||
                      msg.text.includes("unanswered"));
                  return (
                    <div className="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed py-1 space-y-2">
                      <div>{msg.text}</div>
                      {needsPeerHelp && onAskDepartmentPeers && (
                        <button
                          type="button"
                          onClick={() => onAskDepartmentPeers(msg.text)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-all cursor-pointer shadow-sm active:scale-95"
                        >
                          <Users className="w-3.5 h-3.5 text-amber-400" />
                          <span>🚨 Ask Department Peers</span>
                        </button>
                      )}
                    </div>
                  );
                }

                return (
                  <div className="flex flex-col space-y-2.5 w-full">
                    {cards.length > 1 && (
                      <div className="text-xs text-zinc-400 font-medium">
                        Found {cards.length} items:
                      </div>
                    )}
                    {cards.map((card, cIdx) => (
                      <CoordinateCard
                        key={`${card.item}-${cIdx}`}
                        card={card}
                        departmentId={tenantId}
                        onVerifyPendingMove={onVerifyPendingMove}
                        onFlagWrong={onFlagWrong}
                        onSpeakText={onSpeakSingleMessage}
                      />
                    ))}
                    {/* Vector 3: Partial Compound Missing Item Alert */}
                    {msg.text && (msg.text.includes("Could not find") || msg.text.includes("⚠️")) && (
                      <div className="text-xs text-amber-300 bg-amber-950/40 border border-amber-800/40 px-3 py-2 rounded-lg flex items-center justify-between gap-2 mt-1">
                        <span>⚠️ {msg.text.split("\n").filter(l => l.includes("Could not find") || l.includes("⚠️")).join(" ")}</span>
                        {onAskDepartmentPeers && (
                          <button
                            type="button"
                            onClick={() => onAskDepartmentPeers(msg.text)}
                            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 cursor-pointer"
                          >
                            <Users className="w-3 h-3" />
                            <span>Ask Peers</span>
                          </button>
                        )}
                      </div>
                    )}
                    {/* Crack B: Hybrid Compound Clinical Protocol Guidance */}
                    {msg.text && (msg.text.includes("Clinical Guidance") || msg.text.includes("Protocol Guidance") || msg.text.includes("📋")) && (
                      <div
                        data-testid="hybrid-clinical-guidance"
                        className="mt-2 text-xs sm:text-sm text-zinc-200 bg-zinc-950/90 border border-sky-800/50 rounded-xl p-3.5 leading-relaxed space-y-1.5 shadow-sm"
                      >
                        <div className="font-semibold text-sky-400 flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider">
                          <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                          <span>Clinical Guidance</span>
                        </div>
                        <div className="text-zinc-300 whitespace-pre-wrap">
                          {msg.text.split(/📋.*?\n/).filter(Boolean).pop()?.trim() || msg.text}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Inline Move Verify Widget */}
              {msg.moveWidget && (
                <MoveVerifyWidget
                  widget={msg.moveWidget}
                  tenantId={tenantId}
                />
              )}

              {/* Suture Gauge Disambiguation Chips */}
              {msg.disambiguationChips && msg.disambiguationChips.length > 0 && (
                <div data-testid="disambiguation-chips" className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-xs text-zinc-400 font-medium">Available Gauges:</span>
                  {msg.disambiguationChips.map((gauge) => {
                    const baseItem = msg.coordinateCard?.item || msg.text.split(/[:\n]/)[0].replace(/.*?(?=vicryl|prolene|silk|ti-cron|monocryl|ethibond|chromic)/i, "") || "vicryl";
                    return (
                      <button
                        key={gauge}
                        type="button"
                        onClick={() => onStarterChipClick?.(`where is ${gauge} ${baseItem.trim()}`)}
                        className="px-2.5 py-1 rounded-md text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-200 border border-zinc-700 cursor-pointer shadow-sm transition-all"
                      >
                        {gauge}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Inline Quick-Add Item Widget */}
              {msg.quickAddWidget && (
                <InlineQuickAddCard
                  item={msg.quickAddWidget.item}
                  tenantId={tenantId}
                  onSave={onSaveQuickAddItem}
                />
              )}

              {/* Minimal Whisper-Quiet Metadata Footer */}
              <div className="flex items-center gap-2 text-[11px] text-zinc-500 font-mono pt-1">
                {msg.routingTier === "TIER_1_LOCAL_CSV" && (
                  <span>Instant lookup · {msg.latencyMs ?? 0}ms</span>
                )}
                {msg.routingTier === "TIER_2_GEMINI_RAG" && (
                  <span>Clinical protocol · {msg.latencyMs ?? 0}ms</span>
                )}
                {msg.routingTier === "MOVE_REPORTED" && (
                  <span>Relocation logged · {msg.latencyMs ?? 0}ms</span>
                )}
                {msg.routingTier === "RBAC_RESTRICTED" && (
                  <span className="text-amber-400/90 font-medium">Role-restricted · {msg.latencyMs ?? 0}ms</span>
                )}
                {isPhiScrubbed && (
                  <>
                    <span>·</span>
                    <span className="flex items-center gap-1 text-zinc-400">
                      <Shield className="w-3 h-3" /> PHI Scrubbed
                    </span>
                  </>
                )}
                {!msg.coordinateCard && (!msg.coordinateCards || msg.coordinateCards.length === 0) && msg.text && onSpeakSingleMessage && (
                  <>
                    <span>·</span>
                    <button
                      type="button"
                      onClick={() => onSpeakSingleMessage(msg.text)}
                      className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                      title="Read response aloud"
                    >
                      <Volume2 className="w-3 h-3" /> Read aloud
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-500 font-mono py-2">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-ping" />
          <span>Searching inventory...</span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
