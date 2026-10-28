"use client";

import React, { useState, useEffect } from "react";
import {
  FeedbackItem,
  fetchFeedbackItems,
  submitManualFeedback,
  upvoteFeedback,
  updateFeedbackStatus,
  generateTopRecommendations,
  FEEDBACK_EVENT_NAME,
} from "@/lib/feedbackEngine";
import { awardClinicalXP } from "@/lib/gamification";

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile?: {
    fullName?: string;
    clinicalRole?: string;
    facilityId?: string;
    departmentId?: string;
  };
  initialTab?: "give_feedback" | "recommendations";
}

export function FeedbackModal({
  isOpen,
  onClose,
  userProfile,
  initialTab = "recommendations",
}: FeedbackModalProps) {
  const [activeTab, setActiveTab] = useState<"give_feedback" | "recommendations">(initialTab);

  // Form State
  const [category, setCategory] = useState<"feature_request" | "bug_friction" | "data_inventory" | "ui_ux">("feature_request");
  const [severity, setSeverity] = useState<"low" | "medium" | "high">("medium");
  const [rawText, setRawText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Recommendations Hub State
  const [feedbackList, setFeedbackList] = useState<FeedbackItem[]>([]);
  const [sourceFilter, setSourceFilter] = useState<"all" | "chat" | "manual" | "resolved" | "feature" | "bug">("all");
  const [sortBy, setSortBy] = useState<"priority" | "upvotes" | "newest">("priority");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Load items
  const reloadFeedback = async () => {
    try {
      const items = await fetchFeedbackItems({
        tenantId: userProfile?.facilityId ? `${userProfile.facilityId}::${userProfile.departmentId || "or"}` : undefined,
        sortBy,
      });
      setFeedbackList(items);
    } catch (e) {
      console.warn("Failed to load feedback items:", e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      reloadFeedback();
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    const handleUpdated = () => reloadFeedback();
    window.addEventListener(FEEDBACK_EVENT_NAME, handleUpdated);
    return () => window.removeEventListener(FEEDBACK_EVENT_NAME, handleUpdated);
  }, []);

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
        severity,
        userProfile,
      });

      // Award +20 XP for manual feedback contribution
      awardClinicalXP("feedback_manual", "Clinical Feedback Contributed (+20 XP)");

      setRawText("");
      setSubmitSuccess(true);
      await reloadFeedback();

      setTimeout(() => {
        setSubmitSuccess(false);
        setActiveTab("recommendations");
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

  // Handle Resolve
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
      // Fallback
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2500);
    }
  };

  // Filtered List for Tab 2
  const filteredList = feedbackList.filter((item) => {
    if (sourceFilter === "chat") return item.source === "chat_auto_detected" && item.status !== "resolved";
    if (sourceFilter === "manual") return item.source === "manual_submission" && item.status !== "resolved";
    if (sourceFilter === "resolved") return item.status === "resolved";
    if (sourceFilter === "feature") return item.category === "feature_request" && item.status !== "resolved";
    if (sourceFilter === "bug") return item.category === "bug_friction" && item.status !== "resolved";
    return item.status !== "resolved"; // "all" displays all open/planned
  });

  const topRecommendations = generateTopRecommendations(feedbackList);
  const openCount = feedbackList.filter((it) => it.status === "open").length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-fadeIn"
      data-testid="feedback-modal"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
              💬
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Feedback & Dev Recommendations Hub</h2>
              <p className="text-xs text-slate-400">
                Turn bedside clinical friction into instant Antigravity engineering roadmaps
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-800 bg-slate-950/40 px-6">
          <button
            onClick={() => setActiveTab("recommendations")}
            data-testid="tab-recommendations-hub"
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === "recommendations"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            🧠 Compiled & Recommended Updates
            {openCount > 0 && (
              <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-xs font-semibold text-indigo-300">
                {openCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("give_feedback")}
            data-testid="tab-give-feedback"
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === "give_feedback"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            ✍️ Give Feedback
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-400">
              +20 XP
            </span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "give_feedback" ? (
            /* ============================================================ */
            /* TAB 1: GIVE FEEDBACK                                         */
            /* ============================================================ */
            <form onSubmit={handleSubmit} className="space-y-5">
              {submitSuccess && (
                <div
                  data-testid="feedback-success-banner"
                  className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-4 text-emerald-300 animate-fadeIn"
                >
                  <p className="font-semibold">🚀 Feedback Logged to Developer Hub! (+20 XP)</p>
                  <p className="text-xs text-emerald-400/80">
                    Your suggestion has been synthesized into an actionable Antigravity prompt.
                  </p>
                </div>
              )}

              {/* Category Selector */}
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Feedback Category
                </label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { id: "feature_request", label: "✨ Feature Idea" },
                    { id: "bug_friction", label: "🐛 Bug / Friction" },
                    { id: "data_inventory", label: "📦 Missing Data" },
                    { id: "ui_ux", label: "🎨 UI / Layout" },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCategory(cat.id as any)}
                      className={`rounded-xl border p-3 text-left text-xs font-medium transition-all ${
                        category === cat.id
                          ? "border-indigo-500 bg-indigo-500/10 text-white shadow-sm ring-1 ring-indigo-500/50"
                          : "border-slate-800 bg-slate-950/50 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Urgency Selector */}
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Urgency / Clinical Impact
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "low", label: "Low", desc: "Cosmetic / Nice to have" },
                    { id: "medium", label: "Medium", desc: "Slows down shift" },
                    { id: "high", label: "🚨 High", desc: "Clinical blocker / Safety" },
                  ].map((urg) => (
                    <button
                      key={urg.id}
                      type="button"
                      onClick={() => setSeverity(urg.id as any)}
                      className={`rounded-xl border p-2.5 text-left text-xs font-medium transition-all ${
                        severity === urg.id
                          ? "border-amber-500 bg-amber-500/10 text-white shadow-sm ring-1 ring-amber-500/50"
                          : "border-slate-800 bg-slate-950/50 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                      }`}
                    >
                      <div className="font-semibold text-slate-200">{urg.label}</div>
                      <div className="text-[10px] text-slate-400">{urg.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Feedback Textarea */}
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  What's slowing you down or what should we build next?
                </label>
                <textarea
                  data-testid="feedback-input-text"
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  rows={4}
                  required
                  placeholder="e.g. I wish the Lap Chole card showed the exact clip applier size, or the screen glare in OR 4 is blinding during laparoscopy..."
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 text-sm text-slate-200 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Submit Button */}
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-slate-500">
                  Contributing feedback improves unit efficiency & earns clinical XP.
                </span>
                <button
                  type="submit"
                  disabled={isSubmitting || !rawText.trim()}
                  data-testid="btn-submit-feedback"
                  className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-500 disabled:opacity-50"
                >
                  {isSubmitting ? "Submitting..." : "🚀 Submit Feedback (+20 XP)"}
                </button>
              </div>
            </form>
          ) : (
            /* ============================================================ */
            /* TAB 2: COMPILED & RECOMMENDED UPDATES (DEV HUB)              */
            /* ============================================================ */
            <div className="space-y-6" data-testid="recommendations-hub">
              {/* Top Recommendations Banner */}
              {topRecommendations.length > 0 && (
                <div
                  data-testid="top-recommendations-banner"
                  className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-950/20 via-slate-900 to-indigo-950/20 p-4 shadow-lg"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400">
                      ⚡ Top Synthesized Dev Recommendations
                    </h3>
                    <span className="text-[11px] text-slate-400">Sorted by Severity & Frequency</span>
                  </div>
                  <div className="space-y-2">
                    {topRecommendations.map((rec, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2 rounded-lg bg-slate-950/60 px-3 py-2 text-xs text-slate-200"
                      >
                        <span className="text-slate-400">{idx + 1}.</span>
                        <span className="font-medium text-slate-300">{rec}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Filter & Sort Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: "all", label: "All Open" },
                    { id: "chat", label: "🤖 Chat Detected" },
                    { id: "manual", label: "✍️ Direct Feedback" },
                    { id: "feature", label: "✨ Features" },
                    { id: "bug", label: "🐛 Bugs" },
                    { id: "resolved", label: "✓ Resolved" },
                  ].map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setSourceFilter(f.id as any)}
                      data-testid={`filter-${f.id}`}
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                        sourceFilter === f.id
                          ? "bg-indigo-600 text-white"
                          : "bg-slate-800/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Sort:</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-300 focus:outline-none"
                  >
                    <option value="priority">🔥 Highest Priority</option>
                    <option value="upvotes">👍 Most Upvoted</option>
                    <option value="newest">⏱️ Newest</option>
                  </select>
                </div>
              </div>

              {/* Recommendations List */}
              <div className="space-y-4">
                {filteredList.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-sm text-slate-500">
                    No feedback items found matching this filter.
                  </div>
                ) : (
                  filteredList.map((item) => {
                    const isCopied = copiedId === item.id;
                    return (
                      <div
                        key={item.id}
                        data-testid="recommendation-card"
                        className={`rounded-2xl border p-4.5 transition-all ${
                          item.status === "resolved"
                            ? "border-emerald-950/40 bg-slate-950/40 opacity-70"
                            : item.severity === "high"
                            ? "border-rose-900/40 bg-gradient-to-b from-rose-950/10 to-slate-900"
                            : "border-slate-800 bg-slate-900/90"
                        }`}
                      >
                        {/* Top Meta Bar */}
                        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            {/* Source Badge */}
                            <span
                              className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                                item.source === "chat_auto_detected"
                                  ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                                  : "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                              }`}
                            >
                              {item.source === "chat_auto_detected" ? "🤖 Chat Detected" : "✍️ Direct Feedback"}
                            </span>

                            {/* Category Badge */}
                            <span className="rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                              {item.category === "feature_request"
                                ? "✨ Feature"
                                : item.category === "bug_friction"
                                ? "🐛 Bug"
                                : item.category === "data_inventory"
                                ? "📦 Data"
                                : "🎨 UI/UX"}
                            </span>

                            {/* Severity Pill */}
                            <span
                              className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                                item.severity === "high"
                                  ? "bg-rose-500/20 text-rose-300"
                                  : item.severity === "medium"
                                  ? "bg-amber-500/20 text-amber-300"
                                  : "bg-slate-700/40 text-slate-400"
                              }`}
                            >
                              {item.severity.toUpperCase()}
                            </span>
                          </div>

                          <div className="text-right text-[11px] text-slate-400">
                            <span className="font-medium text-slate-300">{item.userName}</span> ({item.userRole})
                          </div>
                        </div>

                        {/* Raw User Quote */}
                        <div className="mb-3 rounded-xl border border-slate-800/80 bg-slate-950/60 p-3 text-xs italic text-slate-300">
                          "{item.rawText}"
                        </div>

                        {/* Synthesized Dev Recommendation */}
                        <div className="mb-3.5 rounded-xl border border-indigo-500/20 bg-indigo-950/20 p-3">
                          <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-indigo-400">
                            🛠️ Recommended Fix
                          </div>
                          <div className="text-xs font-medium text-indigo-200">
                            {item.aiRecommendation}
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3">
                          <button
                            onClick={() => handleCopyPrompt(item.id, item.suggestedFixPrompt)}
                            data-testid="btn-copy-prompt"
                            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                              isCopied
                                ? "bg-emerald-600 text-white"
                                : "bg-indigo-600/90 text-white hover:bg-indigo-500 shadow-md shadow-indigo-600/20"
                            }`}
                          >
                            {isCopied ? "✓ Copied to Clipboard!" : "📋 Copy Antigravity Fix Prompt"}
                          </button>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleUpvote(item.id)}
                              data-testid="btn-upvote-feedback"
                              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700"
                            >
                              👍 +1 ({item.upvotes})
                            </button>
                            <button
                              onClick={() => handleToggleResolve(item.id, item.status)}
                              data-testid="btn-resolve-feedback"
                              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
                                item.status === "resolved"
                                  ? "bg-slate-800 text-slate-400 hover:text-white"
                                  : "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                              }`}
                            >
                              {item.status === "resolved" ? "Reopen" : "✓ Mark Resolved"}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
