"use client";

import React, { useState, useRef } from "react";
import { Download, X, Sparkles } from "lucide-react";
import type { VersionManifest } from "@/lib/version";
import { openApkDownload } from "@/hooks/useAppUpdate";
import { useModalA11y } from "@/hooks/useModalA11y";

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
  const modalRef = useRef<HTMLDivElement>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);

  useModalA11y(isOpen, onClose, modalRef);

  if (!isOpen || !manifest) return null;

  const handleInstall = async () => {
    setIsDownloading(true);
    setProgress(0);
    for (let i = 0; i <= 100; i += 10) {
      setProgress(i);
      await new Promise(r => setTimeout(r, 50));
    }
    await openApkDownload(manifest.apk_download_url);
    setIsDownloading(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        ref={modalRef}
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
            aria-label="Close"
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
          {isDownloading ? (
            <div className="w-full space-y-2 py-2" data-testid="progress-container">
              <div className="w-full bg-zinc-800 rounded-full h-2.5">
                <div
                  className="bg-emerald-500 h-2.5 rounded-full transition-all duration-200"
                  style={{ width: `${progress}%` }}
                  data-testid="progress-bar"
                ></div>
              </div>
              <p className="text-xs text-center text-zinc-400 font-mono">Downloading... {progress}%</p>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
