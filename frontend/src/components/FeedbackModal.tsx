"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  FeedbackItem,
  fetchFeedbackItems,
  submitManualFeedback,
  upvoteFeedback,
  updateFeedbackStatus,
  FEEDBACK_EVENT_NAME,
} from "@/lib/feedbackEngine";
import { awardClinicalXP } from "@/lib/gamification";
import { isAdminUser, getCurrentSession } from "@/lib/auth";
import { useModalA11y } from "@/hooks/useModalA11y";

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile?: {
    fullName?: string;
    clinicalRole?: string;
    facilityId?: string;
    departmentId?: string;
    email?: string;
    role?: string;
  };
  initialTab?: "give_feedback" | "recommendations";
}

export function FeedbackModal({
  isOpen,
  onClose,
  userProfile,
  initialTab = "give_feedback",
}: FeedbackModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const session = getCurrentSession();
  const isAdmin = isAdminUser(session || userProfile);

  const [activeTab, setActiveTab] = useState<"give_feedback" | "recommendations">(
    isAdmin ? initialTab : "give_feedback"
  );

  // Form State
  const [category, setCategory] = useState<"feature_request" | "bug_friction" | "data_inventory">("feature_request");
  const [rawText, setRawText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Recommendations / Admin Triage State
  const [feedbackList, setFeedbackList] = useState<FeedbackItem[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Reload feedback items
  const reloadFeedback = async () => {
    if (!isAdmin) return;
    try {
      const items = await fetchFeedbackItems({ sortBy: "priority" });
      setFeedbackList(items);
    } catch (e) {
      console.warn("Failed to load feedback items:", e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      if (!isAdmin) {
        setActiveTab("give_feedback");
      } else {
        setActiveTab(initialTab);
        reloadFeedback();
      }
    }
  }, [isOpen, initialTab, isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const handleUpdated = () => reloadFeedback();
    window.addEventListener(FEEDBACK_EVENT_NAME, handleUpdated);
    return () => window.removeEventListener(FEEDBACK_EVENT_NAME, handleUpdated);
  }, [isAdmin]);

  useModalA11y(isOpen, onClose, modalRef);

  if (!isOpen) return null;

  // Handle Manual Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawText.trim()) return;

    setIsSubmitting(true);
    try {
      await submitManualFeedback({
        rawText,
        category,
        severity: category === "bug_friction" ? "medium" : "low",
        userProfile,
      });

      // Award +5 XP for manual feedback contribution
      awardClinicalXP("feedback_manual", "Feedback Contributed (+5 XP)");

      setRawText("");
      setSubmitSuccess(true);
      if (isAdmin) {
        await reloadFeedback();
      }

      setTimeout(() => {
        setSubmitSuccess(false);
        if (isAdmin) {
          setActiveTab("recommendations");
        } else {
          onClose();
        }
      }, 1200);
    } catch (err) {
      console.error("Submission failed:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Upvote
  const handleUpvote = async (id: string) => {
    await upvoteFeedback(id);
    await reloadFeedback();
  };

  // Handle Mark Done (Resolve)
  const handleToggleResolve = async (id: string, currentStatus: string) => {
    const nextStatus = currentStatus === "resolved" ? "open" : "resolved";
    await updateFeedbackStatus(id, nextStatus);
    await reloadFeedback();
  };

  // Handle Copy Antigravity Fix Prompt
  const handleCopyPrompt = async (id: string, promptText: string) => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2500);
    }
  };

  const openItems = feedbackList.filter((it) => it.status === "open");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm animate-fadeIn"
      data-testid="feedback-modal"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400 text-sm">
              💬
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">
                {isAdmin ? "Feedback & Triage Hub" : "Send Feedback"}
              </h2>
              <p className="text-[11px] text-slate-400">
                {isAdmin
                  ? "Admin developer recommendations & quick fixes"
                  : "Help us improve your perioperative assistant"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Admin-Only Tab Switcher */}
        {isAdmin && (
          <div className="flex border-b border-slate-800 bg-slate-950/40 px-5">
            <button
              onClick={() => setActiveTab("give_feedback")}
              data-testid="tab-give-feedback"
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${
                activeTab === "give_feedback"
                  ? "border-indigo-500 text-indigo-400"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              ✍️ Submit
            </button>
            <button
              onClick={() => setActiveTab("recommendations")}
              data-testid="tab-recommendations-hub"
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${
                activeTab === "recommendations"
                  ? "border-indigo-500 text-indigo-400"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              🛠️ Admin Triage ({openItems.length})
            </button>
          </div>
        )}

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {activeTab === "give_feedback" || !isAdmin ? (
            /* ============================================================ */
            /* MINIMAL MOBILE FORM: CLINICIANS & SUBMIT VIEW                 */
            /* ============================================================ */
            <form onSubmit={handleSubmit} className="space-y-4">
              {submitSuccess && (
                <div
                  data-testid="feedback-success-banner"
                  className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-3 text-emerald-300 text-xs animate-fadeIn"
                >
                  <p className="font-semibold">🚀 Feedback Received! (+5 XP)</p>
                  <p className="text-[11px] text-emerald-400/80">
                    Thank you! We review clinician suggestions every day.
                  </p>
                </div>
              )}

              {/* 3 Simple Category Pills */}
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Category
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "feature_request", label: "✨ Feature" },
                    { id: "bug_friction", label: "🐛 Bug" },
                    { id: "data_inventory", label: "📦 Data" },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCategory(cat.id as any)}
                      className={`rounded-xl border p-2 text-center text-xs font-medium transition-all ${
                        category === cat.id
                          ? "border-indigo-500 bg-indigo-500/10 text-white shadow-sm ring-1 ring-indigo-500/40"
                          : "border-slate-800 bg-slate-950/50 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Clean Text Area */}
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Tell us what to improve...
                </label>
                <textarea
                  data-testid="feedback-input-text"
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  rows={4}
                  required
                  placeholder="Tell us what to improve..."
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-xs text-slate-200 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Submit Button */}
              <div className="flex items-center justify-end pt-1">
                <button
                  type="submit"
                  disabled={isSubmitting || !rawText.trim()}
                  data-testid="btn-submit-feedback"
                  className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-indigo-600/25 transition-all hover:bg-indigo-500 disabled:opacity-50"
                >
                  {isSubmitting ? "Submitting..." : "Submit Feedback (+5 XP)"}
                </button>
              </div>
            </form>
          ) : (
            /* ============================================================ */
            /* ADMIN-ONLY DECLUTTERED COMPACT TRIAGE VIEW                   */
            /* ============================================================ */
            <div className="space-y-2.5" data-testid="recommendations-hub">
              {openItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-xs text-slate-500">
                  ✓ Inbox zero! All clinical feedback items resolved.
                </div>
              ) : (
                openItems.map((item) => {
                  const isCopied = copiedId === item.id;
                  const catDotColor =
                    item.category === "bug_friction"
                      ? "bg-rose-500"
                      : item.category === "data_inventory"
                      ? "bg-amber-500"
                      : "bg-emerald-500";

                  return (
                    <div
                      key={item.id}
                      data-testid="recommendation-card"
                      className="rounded-xl border border-slate-800/90 bg-slate-950/60 p-3 transition-all hover:border-slate-700"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          {/* Top Row: Dot + Fix Title + Upvotes */}
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`h-2 w-2 rounded-full shrink-0 ${catDotColor}`} />
                            <span className="text-xs font-bold text-slate-100 truncate">
                              {item.aiRecommendation}
                            </span>
                            {item.upvotes > 1 && (
                              <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 px-1.5 py-0.2 rounded shrink-0">
                                x{item.upvotes}
                              </span>
                            )}
                          </div>

                          {/* Raw Quote */}
                          <p className="text-[11px] text-slate-400 line-clamp-1 italic pl-4">
                            "{item.rawText}"
                          </p>
                        </div>

                        {/* Compact Action Buttons */}
                        <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                          <button
                            onClick={() => handleCopyPrompt(item.id, item.suggestedFixPrompt)}
                            data-testid="btn-copy-prompt"
                            title="Copy Antigravity Directive"
                            className={`rounded-lg px-2 py-1 text-[11px] font-semibold transition-all ${
                              isCopied
                                ? "bg-emerald-600 text-white"
                                : "bg-indigo-600/80 hover:bg-indigo-500 text-white"
                            }`}
                          >
                            {isCopied ? "✓ Copied" : "📋 Prompt"}
                          </button>
                          <button
                            onClick={() => handleToggleResolve(item.id, item.status)}
                            data-testid="btn-resolve-feedback"
                            title="Mark Resolved"
                            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-1 text-[11px] font-semibold text-emerald-400 transition-all"
                          >
                            ✓ Done
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
