"use client";

import React, { useState, useEffect } from "react";
import {
  Plus,
  Settings,
  ChevronDown,
  ChevronUp,
  QrCode,
  Building,
  Sparkles,
  Check,
  Clock,
} from "lucide-react";
import { fetchGeminiStatus, saveGeminiKey } from "@/lib/api";

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
}: SidebarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

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
    <aside className="w-64 sm:w-72 h-full flex flex-col bg-[#121215] border-r border-zinc-800/80 text-zinc-100 shrink-0 select-none">
      {/* Top Brand & New Case */}
      <div className="p-3.5 border-b border-zinc-800/80">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-100 text-sm tracking-tight">OR-Nav</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-zinc-400 bg-zinc-800/80 border border-zinc-800">
              v1.0
            </span>
          </div>
          <span className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>Ready</span>
          </span>
        </div>

        {/* Clean + New Case Button */}
        <button
          onClick={onNewCase}
          className="w-full mt-3 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-100 hover:bg-white active:bg-zinc-200 text-zinc-950 font-medium text-xs transition-colors shadow-sm cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>New Case</span>
        </button>
      </div>

      {/* Recent History / Cases Feed */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        <div className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider px-2 py-1">
          Recent Queries
        </div>

        {history && history.length > 0 ? (
          history.slice(-15).reverse().map((item, idx) => (
            <button
              key={idx}
              onClick={() => onSelectStarterPrompt?.(item)}
              disabled={loading}
              className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-zinc-800/80 text-xs text-zinc-300 hover:text-zinc-100 truncate transition-colors cursor-pointer"
              title={item}
            >
              {item}
            </button>
          ))
        ) : (
          <div className="px-2 py-6 text-xs text-zinc-600 italic">
            No queries in current session
          </div>
        )}
      </div>

      {/* Collapsible Bottom Settings Drawer / Accordion */}
      <div className="border-t border-zinc-800/80 bg-zinc-900/40">
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Settings className="w-3.5 h-3.5 text-zinc-500" />
            <span className="font-medium">Preferences & System</span>
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
          <div className="p-3.5 space-y-3 border-t border-zinc-800/80 bg-zinc-950 text-xs animate-in fade-in duration-150">
            {/* Gemini AI Engine Configuration */}
            <div className="space-y-1.5 pb-2.5 border-b border-zinc-800/80">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-zinc-400 flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-zinc-500" />
                  <span>Gemini AI Engine</span>
                </span>
              </div>
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
              <form onSubmit={handleSaveKey} className="flex items-center gap-1.5 pt-1">
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

            {/* Facility Tenant Dropdown */}
            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1 flex items-center gap-1.5">
                <Building className="w-3 h-3 text-zinc-500" />
                <span>Facility Tenant</span>
              </label>
              <select
                value={selectedTenant}
                onChange={(e) => onSelectTenant(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-700 cursor-pointer"
              >
                {tenants.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ").toUpperCase()}
                  </option>
                ))}
                {tenants.length === 0 && (
                  <option value="general_memorial_cvor">GENERAL MEMORIAL CVOR</option>
                )}
              </select>
            </div>

            {/* Silent-First OR Output & 15-Min Hands-Free Audio Window */}
            <div className="space-y-1.5 pt-0.5">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Silent-First TTS</span>
                <button
                  onClick={onToggleTts}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium transition-colors cursor-pointer ${
                    autoTts
                      ? "bg-zinc-200 text-zinc-900 font-bold"
                      : "bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {autoTts ? "AUDIO ON" : "SILENT"}
                </button>
              </div>
              {onStartHandsFree15Min && (
                <button
                  type="button"
                  onClick={onStartHandsFree15Min}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-[11px] transition-colors cursor-pointer"
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

            {/* Mobile QR Pair Trigger */}
            {onOpenQRPair && (
              <button
                onClick={onOpenQRPair}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <QrCode className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Mobile QR Pairing</span>
                </div>
                <span className="text-[10px] text-zinc-500 font-mono">Wi-Fi</span>
              </button>
            )}

            {/* Voice, Offline PWA & HIPAA Status */}
            <div className="pt-2 border-t border-zinc-800/80 space-y-1 text-[11px] text-zinc-500 font-mono">
              <div className="flex items-center justify-between">
                <span>Offline Cache:</span>
                <span className="text-zinc-400">{offlineSyncedCount} items (Dexie)</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Voice Engine:</span>
                <span className="text-zinc-400">
                  {voiceMode === "LIVEKIT_WEBRTC" ? "LiveKit WebRTC" : "Browser Web Speech"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>HIPAA Scrubber:</span>
                <span className="text-emerald-500">Active</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
