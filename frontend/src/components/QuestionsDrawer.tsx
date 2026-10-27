"use client";

import React, { useState } from "react";
import {
  DepartmentQuestion,
  createQuestion,
  answerQuestion,
} from "@/lib/api";
import {
  X,
  MessageSquare,
  CheckCircle2,
  HelpCircle,
  Send,
  Plus,
} from "lucide-react";

interface QuestionsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  questions: DepartmentQuestion[];
  onRefreshQuestions: () => Promise<void>;
}

export default function QuestionsDrawer({
  isOpen,
  onClose,
  tenantId,
  questions,
  onRefreshQuestions,
}: QuestionsDrawerProps) {
  const [newQuestionText, setNewQuestionText] = useState("");
  const [submittingNew, setSubmittingNew] = useState(false);
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCreateQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQuestionText.trim() || submittingNew) return;
    setSubmittingNew(true);
    try {
      await createQuestion(tenantId, newQuestionText.trim(), "CVOR Orientee RN");
      setNewQuestionText("");
      await onRefreshQuestions();
    } catch (err) {
      console.error("Failed to post question:", err);
    } finally {
      setSubmittingNew(false);
    }
  };

  const handleSubmitPeerAnswer = async (
    questionId: string,
    confidence: "confident" | "tentative_unsure"
  ) => {
    const text = (draftAnswers[questionId] || "").trim();
    if (!text || busyId) return;
    setBusyId(questionId);
    try {
      await answerQuestion(tenantId, questionId, {
        answerText: text,
        confidence,
        responderRole: "CVOR Peer RN",
      });
      setDraftAnswers((prev) => ({ ...prev, [questionId]: "" }));
      await onRefreshQuestions();
    } catch (err) {
      console.error("Failed to submit peer answer:", err);
    } finally {
      setBusyId(null);
    }
  };

  const handlePromoteVerify = async (questionId: string) => {
    if (busyId) return;
    setBusyId(questionId);
    try {
      await answerQuestion(tenantId, questionId, {
        promoteToVerified: true,
      });
      await onRefreshQuestions();
    } catch (err) {
      console.error("Failed to verify answer:", err);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-xs">
      <div className="w-full max-w-md h-full bg-[#121215] border-l border-zinc-800/80 flex flex-col text-zinc-100 shadow-2xl animate-in slide-in-from-right duration-150">
        {/* Top Header */}
        <div className="px-4 py-3.5 border-b border-zinc-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-zinc-400" />
            <div>
              <h2 className="text-sm font-semibold text-zinc-100 tracking-tight">
                Unanswered Dept Questions
              </h2>
              <p className="text-[11px] text-zinc-500 font-mono">
                Passive Peer Q&A · Preceptor Governance
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Ask New Orientee Question Form */}
        <form
          onSubmit={handleCreateQuestion}
          className="p-3.5 border-b border-zinc-800/80 bg-zinc-950/60 space-y-2"
        >
          <label className="block text-[11px] font-mono text-zinc-400 uppercase tracking-wider">
            Log Unanswered Floor Question
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newQuestionText}
              onChange={(e) => setNewQuestionText(e.target.value)}
              placeholder="e.g. Where are backup 5-0 Prolene sutures kept?"
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700"
            />
            <button
              type="submit"
              disabled={!newQuestionText.trim() || submittingNew}
              className="px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 font-medium text-xs transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Ask</span>
            </button>
          </div>
        </form>

        {/* Questions Feed */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
          {questions.map((q) => {
            const isVerified = q.status === "verified";
            const isTentative = q.status === "answered_tentative";
            const draft = draftAnswers[q.id] || "";

            return (
              <div
                key={q.id}
                className="rounded-xl bg-zinc-900/90 border border-zinc-800/80 p-3.5 space-y-2.5"
              >
                {/* Status Badge & Role */}
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="text-zinc-400">{q.asked_by_role}</span>
                  {isVerified ? (
                    <span className="px-2 py-0.5 rounded bg-emerald-950/50 border border-emerald-800/50 text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Verified in Guide
                    </span>
                  ) : isTentative ? (
                    <span className="px-2 py-0.5 rounded bg-amber-950/40 border border-amber-800/50 text-amber-300 flex items-center gap-1">
                      <HelpCircle className="w-3 h-3" /> Tentative (Unsure)
                    </span>
                  ) : q.status === "answered_confident" ? (
                    <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200">
                      Peer Answered
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-zinc-800/80 border border-zinc-700/80 text-zinc-300">
                      Open Question
                    </span>
                  )}
                </div>

                {/* Question Text */}
                <p className="text-xs sm:text-sm font-medium text-zinc-100 leading-snug">
                  {q.question_text}
                </p>

                {/* Existing Peer Answers */}
                {q.answers && q.answers.length > 0 && (
                  <div className="space-y-2 pt-1">
                    {q.answers.map((ans) => (
                      <div
                        key={ans.id}
                        className="rounded-lg bg-zinc-950/70 border border-zinc-800/80 p-2.5 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
                          <span>{ans.responder_role}</span>
                          <span
                            className={
                              ans.confidence === "tentative_unsure"
                                ? "text-amber-400"
                                : "text-emerald-400"
                            }
                          >
                            {ans.confidence === "tentative_unsure"
                              ? "I think so (Unsure)"
                              : "Confident"}
                          </span>
                        </div>
                        <p className="text-zinc-200 leading-relaxed">{ans.answer_text}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Peer Response Input + Confidence Buttons */}
                {!isVerified && (
                  <div className="pt-1.5 space-y-2 border-t border-zinc-800/60">
                    <input
                      type="text"
                      value={draft}
                      onChange={(e) =>
                        setDraftAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                      }
                      placeholder="Write a peer answer for the orientee..."
                      className="w-full bg-zinc-950 border border-zinc-800/80 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={!draft.trim() || busyId === q.id}
                          onClick={() => handleSubmitPeerAnswer(q.id, "confident")}
                          className="px-2.5 py-1 rounded bg-zinc-200 hover:bg-white text-zinc-950 font-medium text-[11px] transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1"
                        >
                          <Send className="w-3 h-3" />
                          <span>Confident</span>
                        </button>
                        <button
                          type="button"
                          disabled={!draft.trim() || busyId === q.id}
                          onClick={() => handleSubmitPeerAnswer(q.id, "tentative_unsure")}
                          className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-zinc-700/80 font-medium text-[11px] transition-colors cursor-pointer disabled:opacity-40"
                        >
                          I think so / Unsure
                        </button>
                      </div>

                      {q.answers && q.answers.length > 0 && (
                        <button
                          type="button"
                          disabled={busyId === q.id}
                          onClick={() => handlePromoteVerify(q.id)}
                          className="px-2.5 py-1 rounded bg-emerald-950/60 hover:bg-emerald-900/70 text-emerald-300 border border-emerald-800/60 font-mono text-[11px] transition-colors cursor-pointer"
                        >
                          ✅ Worked — Verify
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
