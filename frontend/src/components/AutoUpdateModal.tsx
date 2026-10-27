"use client";

import React from "react";
import { Download, X, Sparkles } from "lucide-react";
import type { VersionManifest } from "@/lib/version";
import { openApkDownload } from "@/hooks/useAppUpdate";

interface AutoUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  manifest: VersionManifest | null;
  currentVersion: string;
  currentBuild: number;
}

export default function AutoUpdateModal({
  isOpen,
  onClose,
  manifest,
  currentVersion,
  currentBuild,
}: AutoUpdateModalProps) {
  if (!isOpen || !manifest) return null;

  const handleInstall = async () => {
    await openApkDownload(manifest.apk_download_url);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-sm rounded-2xl bg-zinc-950 border border-emerald-500/40 p-5 shadow-2xl space-y-4"
        data-testid="auto-update-modal"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-1.5">
                <span>New Update Available</span>
              </h2>
              <p className="text-[11px] text-zinc-400 font-mono">
                {currentVersion} (Build {currentBuild}) ➔ {manifest.version} (Build {manifest.build_number})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {manifest.changelog && (
          <div className="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 text-xs text-zinc-300 leading-relaxed space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold font-mono">
              What's New in {manifest.version}
            </div>
            <p className="whitespace-pre-wrap">{manifest.changelog}</p>
          </div>
        )}

        <div className="space-y-2 pt-1">
          <button
            type="button"
            onClick={handleInstall}
            data-testid="btn-install-apk-modal"
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-zinc-950 text-xs font-bold transition-colors cursor-pointer shadow-lg shadow-emerald-500/20"
          >
            <Download className="w-4 h-4" />
            <span>Download & Install {manifest.version} Now</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 px-3 text-xs text-zinc-400 hover:text-zinc-200 transition-colors font-medium text-center cursor-pointer"
          >
            Remind Me Later
          </button>
        </div>
      </div>
    </div>
  );
}
