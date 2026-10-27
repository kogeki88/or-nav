"use client";

import React, { useState, useEffect, useCallback } from "react";
import QRCode from "qrcode";
import { fetchNetworkInfo, NetworkInfoResponse } from "@/lib/api";

interface QRPairModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function QRPairModal({ isOpen, onClose }: QRPairModalProps) {
  const [networkInfo, setNetworkInfo] = useState<NetworkInfoResponse | null>(null);
  const [mode, setMode] = useState<"https" | "lan">("https");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const generateQR = useCallback(async (url: string) => {
    try {
      const dataUrl = await QRCode.toDataURL(url, {
        width: 256,
        margin: 2,
        color: {
          dark: "#0b1120",
          light: "#ffffff",
        },
      });
      setQrCodeDataUrl(dataUrl);
    } catch {
      setError("Failed to generate QR code");
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    setLoading(true);
    setError(null);

    fetchNetworkInfo()
      .then(async (info) => {
        if (!mounted) return;
        setNetworkInfo(info);
        const httpsUrl =
          info.https_url ||
          (info.mobile_url && info.mobile_url.startsWith("https://") ? info.mobile_url : null);
        const preferHttps = Boolean(info.https_active && httpsUrl);
        const initialMode = preferHttps ? "https" : "lan";
        setMode(initialMode);

        const targetUrl = preferHttps ? httpsUrl! : info.lan_url || info.mobile_url;
        await generateQR(targetUrl);
        if (mounted) setLoading(false);
      })
      .catch((_err) => {
        if (!mounted) return;
        const fallbackHost = typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
        const fallbackUrl = `http://${fallbackHost}:3000`;
        setNetworkInfo({
          lan_ip: fallbackHost,
          mobile_url: fallbackUrl,
          lan_url: fallbackUrl,
          https_active: false,
        });
        setMode("lan");
        generateQR(fallbackUrl).then(() => {
          if (mounted) setLoading(false);
        });
      });

    return () => {
      mounted = false;
    };
  }, [isOpen, generateQR]);

  const getHttpsUrl = () => {
    if (networkInfo?.https_url) return networkInfo.https_url;
    if (networkInfo?.mobile_url && networkInfo.mobile_url.startsWith("https://")) {
      return networkInfo.mobile_url;
    }
    return null;
  };

  const httpsCandidate = getHttpsUrl();

  const activeUrl =
    mode === "https" && httpsCandidate
      ? httpsCandidate
      : networkInfo?.lan_url || "http://192.168.1.217:3000";

  const handleModeChange = async (newMode: "https" | "lan") => {
    setMode(newMode);
    const targetUrl =
      newMode === "https" && httpsCandidate
        ? httpsCandidate
        : networkInfo?.lan_url || "http://192.168.1.217:3000";
    await generateQR(targetUrl);
  };

  if (!isOpen) return null;

  const copyToClipboard = () => {
    if (!activeUrl) return;
    navigator.clipboard.writeText(activeUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-xl bg-zinc-900 border border-zinc-800 p-5 shadow-2xl text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Close pairing dialog"
          className="absolute top-3.5 right-3.5 text-zinc-400 hover:text-zinc-100 transition-colors p-1 rounded-md hover:bg-zinc-800 cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-2.5 mb-3.5">
          <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
              />
            </svg>
          </div>
          <div>
            <h3 id="qr-modal-title" className="text-sm font-semibold text-zinc-100">
              Mobile Device Pairing
            </h3>
            <p className="text-[11px] text-zinc-400">Scan QR to connect phone or tablet</p>
          </div>
        </div>

        {/* Segmented Mode Selector: HTTPS Tunnel vs Local LAN */}
        <div className="flex items-center gap-1 p-1 bg-zinc-950 rounded-lg border border-zinc-800 text-xs mb-3">
          <button
            type="button"
            onClick={() => handleModeChange("https")}
            className={`flex-1 py-1.5 px-2 rounded-md font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
              mode === "https"
                ? "bg-zinc-800 text-zinc-100 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                networkInfo?.https_active ? "bg-emerald-400 animate-pulse" : "bg-zinc-500"
              }`}
            />
            <span>🔒 HTTPS Tunnel</span>
          </button>
          <button
            type="button"
            onClick={() => handleModeChange("lan")}
            className={`flex-1 py-1.5 px-2 rounded-md font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
              mode === "lan"
                ? "bg-zinc-800 text-zinc-100 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <span>📶 Local LAN IP</span>
          </button>
        </div>

        {/* QR Code Container */}
        <div className="my-2 flex flex-col items-center justify-center">
          <div className="p-2.5 bg-white rounded-xl shadow border border-zinc-200">
            {loading ? (
              <div className="w-48 h-48 flex flex-col items-center justify-center text-zinc-600 gap-2">
                <div className="w-6 h-6 border-2 border-zinc-800 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs font-mono font-medium">Starting Tunnel...</span>
              </div>
            ) : error ? (
              <div className="w-48 h-48 flex items-center justify-center text-red-500 text-xs p-4 text-center">
                {error}
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrCodeDataUrl}
                alt={`QR code pairing to ${activeUrl}`}
                className="w-48 h-48 rounded-lg block"
              />
            )}
          </div>
          <p className="text-[11px] text-zinc-400 text-center mt-2.5 max-w-xs leading-relaxed">
            {mode === "https"
              ? "HTTPS Secure Context active — full Walkie-Talkie Push-to-Talk & PWA install supported."
              : "Direct LAN connection for testing on local Wi-Fi network."}
          </p>
        </div>

        {/* URL Badge & Copy */}
        <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-2.5 mb-3 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <span className="block text-[10px] font-mono uppercase text-zinc-500">
              {mode === "https" ? "Cloudflare HTTPS URL" : "Local LAN URL"}
            </span>
            <code className="text-xs font-mono text-zinc-200 truncate block">
              {activeUrl}
            </code>
          </div>
          <button
            onClick={copyToClipboard}
            className="px-2.5 py-1 text-xs font-medium rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors border border-zinc-700 flex items-center gap-1.5 flex-shrink-0 cursor-pointer"
          >
            {copied ? (
              <>
                <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-emerald-400 text-[11px]">Copied</span>
              </>
            ) : (
              <>
                <svg className="w-3 h-3 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                <span className="text-[11px]">Copy</span>
              </>
            )}
          </button>
        </div>

        {/* Android .apk Live-Reload Section */}
        <div className="pt-2.5 border-t border-zinc-800 flex items-center justify-between text-xs">
          <div className="min-w-0 pr-2">
            <span className="text-zinc-200 text-[11px] font-medium block">
              Android .apk Live-Reload
            </span>
            <span className="text-[10px] text-zinc-500 block truncate">
              Native Capacitor wrapper for LAN
            </span>
          </div>
          <a
            href="/or-nav.apk"
            download="or-nav.apk"
            className="px-2.5 py-1 text-[11px] font-medium rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors border border-zinc-700 flex items-center gap-1 shrink-0 cursor-pointer"
            title="Download compiled Android .apk if generated"
          >
            <span>📱 Download .apk</span>
          </a>
        </div>
      </div>
    </div>
  );
}
