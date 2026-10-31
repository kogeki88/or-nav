"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Users,
  Check,
  CheckCheck,
  Clock,
  Send,
  MessageSquare,
  Sparkles,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  type PeerQuestion,
  type PeerAnswer,
  getOfflinePeerQuestions,
  saveOfflinePeerQuestion,
  saveOfflinePeerQuestions,
} from "@/lib/offlineDb";
import { createTimeoutSignal } from "@/lib/auth";
import { type UserProfile } from "@/lib/userProfile";
import { getDepartment } from "@/lib/departments";
import { awardClinicalXP } from "@/lib/gamification";

interface PeerQnAPanelProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  userProfile?: UserProfile;
  prefillQuestion?: string;
}

function getPeerApiUrl(path: string): string {
  if (typeof window !== "undefined") {
    const host = window.location.hostname || "localhost";
    const port = window.location.port;
    if (port === "3000" || port === "") {
      return `http://${host}:8000${path}`;
    }
  }
  return path;
}

const PeerQnAPanel = React.memo(function PeerQnAPanel({
  isOpen,
  onClose,
  tenantId,
  userProfile,
  prefillQuestion = "",
}: PeerQnAPanelProps) {
  const [questions, setQuestions] = useState<PeerQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [newQuestionText, setNewQuestionText] = useState(prefillQuestion);
  const [activeAnsweringId, setActiveAnsweringId] = useState<string | null>(null);
  const [answerInputs, setAnswerInputs] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState<"questions" | "ask">("questions");

  const dept = getDepartment(tenantId);
  const clinicianName = userProfile?.fullName || "Clinical Colleague";
  const clinicianRole = userProfile?.clinicalRole || "Circulating RN";

  useEffect(() => {
    if (prefillQuestion) {
      setNewQuestionText(prefillQuestion);
      setTab("ask");
    }
  }, [prefillQuestion]);

  useEffect(() => {
    if (isOpen) {
      fetchQuestions();
    }
  }, [isOpen, tenantId]);

  async function fetchQuestions() {
    setLoading(true);
    try {
      // 1. First load from local IndexedDB cache for instant display
      const local = await getOfflinePeerQuestions(tenantId);
      if (local && local.length > 0) {
        setQuestions(local);
      }

      // 2. Fetch fresh from backend with fast 1500ms timeout
      const res = await fetch(getPeerApiUrl(`/api/peer-questions?tenant_id=${encodeURIComponent(tenantId)}`), {
        signal: createTimeoutSignal(1500),
      });
      if (res.ok) {
        const data: PeerQuestion[] = await res.json();
        setQuestions(data);
        await saveOfflinePeerQuestions(data);
      }
    } catch (err) {
      console.warn("Backend unavailable/timeout, using offline peer questions:", err);
      const fallback = await getOfflinePeerQuestions(tenantId);
      if (fallback && fallback.length > 0) setQuestions(fallback);
    } finally {
      setLoading(false);
    }
  }

  async function handleAskQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (!newQuestionText.trim() || submitting) return;
    setSubmitting(true);
    const localId = `pq-local-${Date.now()}`;
    const newQ: PeerQuestion = {
      id: localId,
      tenantId: tenantId,
      questionText: newQuestionText.trim(),
      askedBy: clinicianName,
      role: clinicianRole,
      createdAt: new Date().toISOString(),
      answers: [],
      status: "unverified",
      verificationsCount: 0,
    };

    try {
      const res = await fetch(getPeerApiUrl("/api/peer-questions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: createTimeoutSignal(1500),
        body: jsonBody({
          tenant_id: tenantId,
          question_text: newQuestionText.trim(),
          asked_by: clinicianName,
          role: clinicianRole,
        }),
      });

      if (res.ok) {
        const created: PeerQuestion = await res.json();
        setQuestions((prev) => [created, ...prev.filter((q) => q.id !== created.id)]);
        await saveOfflinePeerQuestion(created);
        awardClinicalXP("ask_question", "Question Broadcasted");
        setNewQuestionText("");
        setTab("questions");
        return;
      }
    } catch (err) {
      console.warn("Backend peer question post failed/offline, saving locally:", err);
    } finally {
      setSubmitting(false);
    }

    // Offline local fallback
    setQuestions((prev) => [newQ, ...prev]);
    await saveOfflinePeerQuestion(newQ);
    awardClinicalXP("ask_question", "Question Broadcasted (Offline)");
    setNewQuestionText("");
    setTab("questions");
  }

  async function handleAddAnswer(questionId: string) {
    const text = answerInputs[questionId]?.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(getPeerApiUrl(`/api/peer-questions/${questionId}/answers`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: createTimeoutSignal(1500),
        body: JSON.stringify({
          answered_by: `${clinicianName} (${clinicianRole})`,
          answer_text: text,
        }),
      });

      if (res.ok) {
        const updated: PeerQuestion = await res.json();
        setQuestions((prev) => prev.map((q) => (q.id === questionId ? updated : q)));
        await saveOfflinePeerQuestion(updated);
        awardClinicalXP("peer_answer", "Peer Answer Submitted");
        setAnswerInputs((prev) => ({ ...prev, [questionId]: "" }));
        setActiveAnsweringId(null);
        return;
      }
    } catch (err) {
      console.warn("Backend peer answer failed/offline, adding locally:", err);
    } finally {
      setSubmitting(false);
    }

    // Offline local fallback
    const currentQ = questions.find((q) => q.id === questionId);
    if (currentQ) {
      const newAnswer: PeerAnswer = {
        answerId: `pa-local-${Date.now()}`,
        answeredBy: `${clinicianName} (${clinicianRole})`,
        answerText: text,
        verifiedBy: [],
        isVerifiedConsensus: false,
      };
      const updatedQ: PeerQuestion = {
        ...currentQ,
        answers: [...(currentQ.answers || []), newAnswer],
      };
      setQuestions((prev) => prev.map((q) => (q.id === questionId ? updatedQ : q)));
      await saveOfflinePeerQuestion(updatedQ);
      awardClinicalXP("peer_answer", "Peer Answer Submitted (Offline)");
      setAnswerInputs((prev) => ({ ...prev, [questionId]: "" }));
      setActiveAnsweringId(null);
    }
  }

  async function handleVerifyAnswer(questionId: string, answerId: string) {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(getPeerApiUrl(`/api/peer-questions/${questionId}/answers/${answerId}/verify`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: createTimeoutSignal(1500),
        body: JSON.stringify({
          verified_by: `${clinicianName} (${clinicianRole})`,
        }),
      });

      if (res.ok) {
        const updated: PeerQuestion = await res.json();
        setQuestions((prev) => prev.map((q) => (q.id === questionId ? updated : q)));
        await saveOfflinePeerQuestion(updated);
        awardClinicalXP("peer_verify", "Consensus Verification Vote");
        return;
      }
    } catch (err) {
      console.warn("Backend peer verify failed/offline, updating locally:", err);
    } finally {
      setSubmitting(false);
    }

    // Offline local fallback
    const currentQ = questions.find((q) => q.id === questionId);
    if (currentQ) {
      const verifierName = `${clinicianName} (${clinicianRole})`;
      const updatedAnswers = currentQ.answers.map((a) => {
        if (a.answerId === answerId && !a.verifiedBy.includes(verifierName)) {
          const nextVerifiedBy = [...a.verifiedBy, verifierName];
          return {
            ...a,
            verifiedBy: nextVerifiedBy,
            isVerifiedConsensus: nextVerifiedBy.length >= 2,
          };
        }
        return a;
      });
      const hasConsensus = updatedAnswers.some((a) => a.isVerifiedConsensus || a.verifiedBy.length >= 2);
      const totalVerifications = updatedAnswers.reduce((sum, a) => sum + a.verifiedBy.length, 0);
      const updatedQ: PeerQuestion = {
        ...currentQ,
        answers: updatedAnswers,
        status: hasConsensus ? "verified" : currentQ.status,
        verificationsCount: totalVerifications,
      };
      setQuestions((prev) => prev.map((q) => (q.id === questionId ? updatedQ : q)));
      await saveOfflinePeerQuestion(updatedQ);
      awardClinicalXP("peer_verify", "Consensus Verification Vote (Offline)");
    }
  }

  function jsonBody(obj: any): string {
    return JSON.stringify(obj);
  }

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="peer-qna-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col bg-[#121215] border border-zinc-800 rounded-2xl shadow-2xl text-zinc-100 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800/80 bg-zinc-950/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h2 id="peer-qna-title" className="text-sm font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
                <span>Peer Q&A · Orientee Verification</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700/60">
                  {dept.shortName}
                </span>
              </h2>
              <p className="text-[11px] text-zinc-400">
                Multi-peer verified clinical guidance & orientee answers
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-zinc-800/80 bg-zinc-950/30 px-5 pt-2 gap-2 text-xs">
          <button
            type="button"
            onClick={() => setTab("questions")}
            className={`pb-2 px-3 font-medium transition-colors border-b-2 flex items-center gap-1.5 cursor-pointer ${
              tab === "questions"
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Active Questions ({questions.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("ask")}
            className={`pb-2 px-3 font-medium transition-colors border-b-2 flex items-center gap-1.5 cursor-pointer ${
              tab === "ask"
                ? "border-amber-500 text-amber-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Ask Department Peers</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === "ask" && (
            <form onSubmit={handleAskQuestion} className="space-y-3.5">
              <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                <div className="text-xs font-semibold text-amber-300 flex items-center gap-1.5 mb-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>Broadcast to All Active Department Peers</span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  When local inventory or RAG protocols leave you unsure, ping your circulating and scrub peers. Questions will show as <strong className="text-amber-300">🟡 Unverified (0/2)</strong> until 2 clinicians confirm the answer.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Your Clinical or Procedural Question
                </label>
                <textarea
                  value={newQuestionText}
                  onChange={(e) => setNewQuestionText(e.target.value)}
                  placeholder="e.g. Where is the emergency vascular shunt stored during ruptured AAA? Or what is the proper warm-up time for the Belmont rapid infuser?"
                  rows={4}
                  required
                  className="w-full bg-zinc-900 border border-zinc-800 focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40 rounded-xl p-3 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none leading-relaxed resize-none"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-zinc-500">
                  Posting as: <span className="text-zinc-300 font-medium">{clinicianName}</span> ({clinicianRole})
                </span>
                <button
                  type="submit"
                  disabled={submitting || !newQuestionText.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-zinc-950 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-md active:scale-95"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{submitting ? "Broadcasting..." : "Broadcast Question"}</span>
                </button>
              </div>
            </form>
          )}

          {tab === "questions" && (
            <>
              {loading && questions.length === 0 ? (
                <div className="py-12 text-center text-xs text-zinc-500">
                  Loading peer questions...
                </div>
              ) : questions.length === 0 ? (
                <div className="py-12 text-center space-y-2">
                  <div className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-500">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <div className="text-xs font-medium text-zinc-400">
                    No open peer questions in this department.
                  </div>
                  <p className="text-[11px] text-zinc-500 max-w-xs mx-auto">
                    Have an orientee question or setup doubt? Click "Ask Department Peers" above to broadcast.
                  </p>
                </div>
              ) : (
                <div className="space-y-3.5">
                  {questions.map((q, index) => {
                    if (!q || typeof q !== 'object') return null;
                    const isVerified = q.status === "verified" || ((q.verificationsCount ?? 0) >= 2);
                    return (
                      <div
                        key={q.id || `q-fallback-${index}`}
                        data-testid={`peer-question-${q.id}`}
                        className={`p-4 rounded-xl border transition-all ${
                          isVerified
                            ? "bg-zinc-950/70 border-emerald-900/40 hover:border-emerald-700/50"
                            : "bg-zinc-950/70 border-zinc-800 hover:border-zinc-700"
                        }`}
                      >
                        {/* Question Header & Verification Badge */}
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div>
                            <span className="text-[11px] font-medium text-zinc-400">
                              {q.askedBy} <span className="text-zinc-600">·</span> {q.role}
                            </span>
                          </div>

                          {/* Dynamic Peer Verification Badge */}
                          {isVerified ? (
                            <span
                              data-testid="badge-verified"
                              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-sm"
                            >
                              <CheckCheck className="w-3 h-3 text-emerald-400" />
                              <span>🟢 Verified</span>
                            </span>
                          ) : (
                            <span
                              data-testid="badge-unverified"
                              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30 shadow-sm"
                            >
                              <Clock className="w-3 h-3 text-amber-400" />
                              <span>🟡 Unverified ({q.verificationsCount}/2)</span>
                            </span>
                          )}
                        </div>

                        {/* Question Text */}
                        <h3 className="text-xs sm:text-sm font-medium text-zinc-100 leading-snug mb-3">
                          {q.questionText}
                        </h3>

                        {/* Answers Section */}
                        <div className="space-y-2.5 border-t border-zinc-800/60 pt-2.5">
                          {!q.answers || q.answers.length === 0 ? (
                            <div className="text-[11px] text-zinc-500 italic">
                              Awaiting peer answers...
                            </div>
                          ) : (
                            q.answers.map((ans) => {
                              if (!ans || typeof ans !== 'object') return null;
                              const alreadyVerified = ans.verifiedBy && Array.isArray(ans.verifiedBy) && ans.verifiedBy.some(
                                (v) => typeof v === 'string' && v.includes(clinicianName)
                              );
                              return (
                                <div
                                  key={ans.answerId}
                                  className="p-2.5 rounded-lg bg-zinc-900/70 border border-zinc-800/80 text-xs space-y-2"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="text-zinc-200 leading-relaxed">
                                      {ans.answerText}
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-zinc-800/40 text-[11px]">
                                    <div className="text-zinc-400">
                                      Answered by: <span className="text-zinc-300 font-medium">{ans.answeredBy}</span>
                                    </div>

                                    {/* Action: Verify Answer Button */}
                                    <button
                                      type="button"
                                      disabled={alreadyVerified || submitting}
                                      onClick={() => handleVerifyAnswer(q.id, ans.answerId)}
                                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                                        alreadyVerified
                                          ? "bg-zinc-800 text-emerald-400 border border-emerald-500/30 cursor-default"
                                          : "bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 active:scale-95"
                                      }`}
                                    >
                                      {alreadyVerified ? (
                                        <>
                                          <Check className="w-3 h-3 text-emerald-400" />
                                          <span>✓ Verified by You</span>
                                        </>
                                      ) : (
                                        <>
                                          <Check className="w-3 h-3 text-emerald-400" />
                                          <span>[✓ Verify Answer]</span>
                                        </>
                                      )}
                                    </button>
                                  </div>

                                  {/* Verifiers List */}
                                  {ans.verifiedBy.length > 0 && (
                                    <div className="text-[10px] text-zinc-500 pt-0.5 flex items-center gap-1">
                                      <CheckCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                                      <span>
                                        Verified by: {ans.verifiedBy.join(", ")}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          )}

                          {/* Quick Answer Toggle / Form */}
                          {activeAnsweringId === q.id ? (
                            <div className="mt-2 space-y-2">
                              <textarea
                                value={answerInputs[q.id] || ""}
                                onChange={(e) =>
                                  setAnswerInputs({ ...answerInputs, [q.id]: e.target.value })
                                }
                                placeholder="Enter clinical location or guidance..."
                                rows={2}
                                className="w-full bg-zinc-900 border border-zinc-800 focus:border-emerald-500/60 rounded-lg p-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none resize-none"
                              />
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setActiveAnsweringId(null)}
                                  className="px-2.5 py-1 text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  disabled={submitting || !answerInputs[q.id]?.trim()}
                                  onClick={() => handleAddAnswer(q.id)}
                                  className="px-3 py-1 rounded-md text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer disabled:opacity-50"
                                >
                                  Submit Answer
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setActiveAnsweringId(q.id)}
                              className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1 cursor-pointer pt-1"
                            >
                              <span>+ Add Answer</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});

export default PeerQnAPanel;
