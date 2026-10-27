"use client";

import React, { useState } from "react";
import { CoordinateCardData } from "@/lib/api";
import {
  ChevronRight,
  ChevronDown,
  CheckCircle,
  Flag,
  Volume2,
  AlertTriangle,
  ThumbsUp,
} from "lucide-react";

interface CoordinateCardProps {
  card: CoordinateCardData;
  onVerifyPendingMove?: (item: string) => Promise<void>;
  onFlagWrong?: (item: string) => Promise<void>;
  onSpeakText?: (text: string) => void;
  defaultExpanded?: boolean;
  departmentId?: string;
}

function isOlderThan90Days(isoDate?: string): boolean {
  if (!isoDate) return false;
  const ts = Date.parse(isoDate);
  if (Number.isNaN(ts)) return false;
  const diffDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  return diffDays > 90;
}

export default function CoordinateCard({
  card,
  onVerifyPendingMove,
  onFlagWrong,
  onSpeakText,
  defaultExpanded = false,
  departmentId,
}: CoordinateCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [verifying, setVerifying] = useState(false);
  const [confirmedLocally, setConfirmedLocally] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [flaggedLocally, setFlaggedLocally] = useState(false);
  const [reverifiedLocally, setReverifiedLocally] = useState(false);
  const [speakingCard, setSpeakingCard] = useState(false);

  const isOR = !departmentId || departmentId === "or_main" || departmentId === "general_memorial_cvor";
  const notesHeader = isOR ? "Surgeon & Case Notes" : "Clinical & Unit Notes";
  const toggleLabel = isOR ? "Surgeon notes & relocation options" : "Clinical notes & relocation options";
  const calloutLabel = card.surgeon_filter ? `${card.surgeon_filter}` : isOR ? "Surgeon Note" : "Clinical Note";

  const hasPendingMove = Boolean(card.pending_location && card.pending_location.trim().length > 0);
  const hasSurgeonNotes = Boolean(card.surgeon_notes && card.surgeon_notes.trim().length > 0);
  const effectiveStatus = flaggedLocally ? "needs_reverification" : reverifiedLocally ? "verified" : (card.status || "verified");
  const effectiveScore = flaggedLocally ? 0.5 : reverifiedLocally ? 3.0 : (card.verification_score ?? 3.0);
  const isStale90Days = !reverifiedLocally && isOlderThan90Days(card.last_verified_at);
  const showDecayBanner = isStale90Days || effectiveStatus === "needs_reverification";

  const humanAlias =
    card.human_alias ||
    `${card.room} · Cart ${card.cabinet} · Shelf ${card.shelf} · Bin ${card.container}`;

  const handleConfirmMove = async () => {
    if (!onVerifyPendingMove || verifying) return;
    setVerifying(true);
    try {
      await onVerifyPendingMove(card.item);
      setConfirmedLocally(true);
    } catch (e) {
      console.error("Failed to verify move:", e);
    } finally {
      setVerifying(false);
    }
  };

  const handleFlagWrong = async () => {
    if (flagging || flaggedLocally) return;
    setFlagging(true);
    try {
      if (onFlagWrong) {
        await onFlagWrong(card.item);
      }
      setFlaggedLocally(true);
      setReverifiedLocally(false);
    } catch (e) {
      console.error("Failed to flag item:", e);
    } finally {
      setFlagging(false);
    }
  };

  const handleSpeakCard = () => {
    const spoken = `${card.item} is in ${card.room}, Cabinet ${card.cabinet}, Shelf ${card.shelf}, Bin ${card.container}.`;
    setSpeakingCard(true);
    setTimeout(() => setSpeakingCard(false), 1800);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(spoken);
        u.rate = 1.05;
        u.pitch = 1.0;
        window.speechSynthesis.speak(u);
        return;
      } catch {}
    }
    if (onSpeakText) {
      onSpeakText(spoken);
    }
  };

  return (
    <div
      data-testid="coordinate-card"
      className="mt-2.5 w-full max-w-md rounded-xl bg-zinc-900/90 border border-zinc-800 p-4 text-zinc-100 shadow-sm"
    >
      {/* Header: Item Name + Category + On-Demand Audio Readback */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm sm:text-base font-semibold text-zinc-100 tracking-tight truncate">
            {card.item}
          </h3>
          {effectiveStatus === "provisional" && (
            <span className="text-[10px] font-mono text-amber-400/90 bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-800/50 shrink-0">
              Provisional {effectiveScore.toFixed(1)}/3.0
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            data-testid="card-speaker-btn"
            onClick={handleSpeakCard}
            title="Read coordinate aloud (Single-Response TTS)"
            className={`p-1 rounded transition-colors cursor-pointer ${
              speakingCard
                ? "text-emerald-400 bg-emerald-950/50"
                : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80"
            }`}
          >
            <Volume2 className="w-3.5 h-3.5" />
          </button>
          {card.category && (
            <span className="text-xs font-medium text-zinc-400 bg-zinc-800/60 px-2 py-0.5 rounded border border-zinc-800/80">
              {card.category}
            </span>
          )}
        </div>
      </div>

      {/* Coordinate Strip: Unified 4-column divider grid */}
      <div className="grid grid-cols-4 divide-x divide-zinc-800 bg-zinc-950 rounded-lg border border-zinc-800/80 py-3 mt-3 mb-2 text-center">
        <div>
          <div className="text-[10px] font-mono font-medium tracking-wider text-zinc-500 uppercase">
            Room
          </div>
          <div className="text-xl sm:text-2xl font-mono font-semibold text-zinc-100 mt-0.5">
            {card.room}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-mono font-medium tracking-wider text-zinc-500 uppercase">
            Cab
          </div>
          <div className="text-xl sm:text-2xl font-mono font-semibold text-zinc-100 mt-0.5">
            {card.cabinet}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-mono font-medium tracking-wider text-zinc-500 uppercase">
            Shelf
          </div>
          <div className="text-xl sm:text-2xl font-mono font-semibold text-zinc-100 mt-0.5">
            {card.shelf}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-mono font-medium tracking-wider text-zinc-500 uppercase">
            Bin
          </div>
          <div className="text-xl sm:text-2xl font-mono font-semibold text-zinc-100 mt-0.5">
            {card.container}
          </div>
        </div>
      </div>

      {/* Human-Friendly Landmark Subtitle */}
      <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 px-0.5 mb-2">
        <span className="truncate">{humanAlias}</span>
        {effectiveStatus === "verified" && !isStale90Days && (
          <span className="text-[10px] text-emerald-400/90 shrink-0 ml-2">
            ✓ Verified ({effectiveScore.toFixed(1)})
          </span>
        )}
      </div>

      {/* Highlighted Surgeon Preference Callout */}
      {card.highlighted_surgeon_note && (
        <div
          data-testid="surgeon-preference-callout"
          className="mb-2.5 px-3 py-2 rounded-lg bg-emerald-950/40 border border-emerald-700/50 text-xs text-emerald-200 flex items-start gap-2 shadow-sm"
        >
          <span className="font-semibold text-emerald-400 shrink-0 font-mono text-[11px] uppercase tracking-wider mt-0.5">
            {calloutLabel}
          </span>
          <span className="leading-snug">{card.highlighted_surgeon_note}</span>
        </div>
      )}

      {/* 90-Day Decay / Needs Re-verification Amber Footer */}
      {showDecayBanner && (
        <div className="mb-2.5 px-2.5 py-1.5 rounded-lg bg-amber-950/30 border border-amber-800/50 flex items-center justify-between gap-2 text-[11px] text-amber-300/90 font-mono">
          <span className="flex items-center gap-1.5 truncate">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>
              {effectiveStatus === "needs_reverification"
                ? "Flagged empty/moved · Tap 👍 to re-verify"
                : "90+ days since last check · Tap 👍 to re-verify"}
            </span>
          </span>
          <button
            type="button"
            onClick={() => {
              setFlaggedLocally(false);
              setReverifiedLocally(true);
            }}
            className="px-2 py-0.5 rounded bg-amber-900/50 hover:bg-amber-800/60 text-amber-200 border border-amber-700/50 flex items-center gap-1 shrink-0 cursor-pointer transition-colors"
            title="Confirm item is stocked at this location"
          >
            <ThumbsUp className="w-3 h-3" />
            <span>Re-verify</span>
          </button>
        </div>
      )}

      {/* Progressive Disclosure: Collapsible Details & Governance Actions */}
      <div className="border-t border-zinc-800/80 pt-2.5 mt-1">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between text-xs text-zinc-400 hover:text-zinc-200 transition-colors py-0.5 group cursor-pointer"
        >
          <div className="flex items-center gap-1.5">
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-300" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-300" />
            )}
            <span className="font-medium">{toggleLabel}</span>
          </div>
          {hasPendingMove && !confirmedLocally && (
            <span className="w-2 h-2 rounded-full bg-amber-500" title="Relocation pending" />
          )}
        </button>

        {expanded && (
          <div className="mt-3 space-y-2.5 text-xs animate-in fade-in duration-150">
            {hasSurgeonNotes && (
              <div className="rounded-lg bg-zinc-950/60 p-2.5 border border-zinc-800/80 text-zinc-300 leading-relaxed">
                <span className="text-[11px] font-semibold text-zinc-400 block mb-0.5 uppercase tracking-wider font-mono">
                  {notesHeader}
                </span>
                {card.surgeon_notes}
              </div>
            )}

            {hasPendingMove && (
              <div className="rounded-lg bg-zinc-950/60 p-2.5 border border-zinc-800/80 flex items-center justify-between gap-2">
                <div className="text-zinc-300 text-xs">
                  <span className="text-[10px] text-zinc-500 uppercase font-mono block">
                    Pending Move
                  </span>
                  <span>
                    → <strong className="font-mono text-zinc-100">{card.pending_location}</strong> (
                    {card.verify_count}/3)
                  </span>
                </div>
                {!confirmedLocally ? (
                  <button
                    onClick={handleConfirmMove}
                    disabled={verifying}
                    className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-xs font-medium text-zinc-200 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                  >
                    {verifying ? "Confirming..." : "Confirm"}
                  </button>
                ) : (
                  <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> Confirmed
                  </span>
                )}
              </div>
            )}

            {/* Governance Action: Flag Empty / Moved */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-zinc-500 font-mono">
                Bin empty or item relocated?
              </span>
              {!flaggedLocally ? (
                <button
                  type="button"
                  onClick={handleFlagWrong}
                  disabled={flagging}
                  className="px-2.5 py-1 rounded bg-zinc-950 hover:bg-zinc-800 border border-zinc-800/80 text-[11px] font-mono text-zinc-400 hover:text-amber-300 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Flag className="w-3 h-3" />
                  <span>{flagging ? "Flagging..." : "Flag Empty / Moved"}</span>
                </button>
              ) : (
                <span className="text-[11px] font-mono text-amber-400">
                  Flagged for re-verification (0.5)
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
