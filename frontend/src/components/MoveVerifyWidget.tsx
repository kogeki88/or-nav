"use client";

import React, { useState, useRef } from "react";
import { MoveWidgetData, verifyMove } from "@/lib/api";
import { ArrowRight, CheckCircle2 } from "lucide-react";

interface MoveVerifyWidgetProps {
  widget: MoveWidgetData;
  tenantId: string;
  onCommitted?: (item: string) => void;
}

export default function MoveVerifyWidget({
  widget,
  tenantId,
  onCommitted,
}: MoveVerifyWidgetProps) {
  const [currentCount, setCurrentCount] = useState<number>(widget.verify_count);
  const [isCommitted, setIsCommitted] = useState<boolean>(widget.committed);
  const [loading, setLoading] = useState<boolean>(false);
  const lastTapRef = useRef<number>(0);

  const handleVerify = async () => {
    const now = Date.now();
    if (loading || isCommitted || now - lastTapRef.current < 1000) return;
    lastTapRef.current = now;
    setLoading(true);

    try {
      const result = await verifyMove(tenantId, widget.item, widget.new_location);
      setCurrentCount(result.verify_count);
      setIsCommitted(result.committed);

      if (result.committed && onCommitted) {
        onCommitted(widget.item);
      }
    } catch (err: unknown) {
      console.error("Verify failed:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-2.5 w-full max-w-md rounded-xl bg-zinc-900/90 border border-zinc-800 p-3.5 text-zinc-100 shadow-sm">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs sm:text-sm font-medium text-zinc-200">
          <span>{widget.item}</span>
          <ArrowRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <span className="font-mono font-semibold text-zinc-100 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800">
            {widget.new_location}
          </span>
        </div>

        {isCommitted ? (
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Committed</span>
          </div>
        ) : (
          <button
            onClick={handleVerify}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-900 text-xs font-medium transition-colors cursor-pointer shrink-0 disabled:opacity-50"
          >
            {loading ? "Confirming..." : `Confirm (${currentCount}/3)`}
          </button>
        )}
      </div>

      {/* Progress Dots */}
      <div className="mt-2.5 pt-2 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-500 font-mono">
        <div className="flex items-center gap-1.5">
          {[1, 2, 3].map((step) => {
            const active = isCommitted || step <= currentCount;
            return (
              <span
                key={step}
                className={`w-1.5 h-1.5 rounded-full ${
                  active ? "bg-emerald-400" : "bg-zinc-700"
                }`}
              />
            );
          })}
          <span className="ml-1 text-[11px] text-zinc-400">
            {isCommitted ? "3/3 confirmed" : `${currentCount}/3 confirmations`}
          </span>
        </div>
        <span className="text-[10px] text-zinc-500">Crowdsourced Move</span>
      </div>
    </div>
  );
}
