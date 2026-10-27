"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Mic, Send, Paperclip, Loader2, Radio } from "lucide-react";

interface OmnibarProps {
  onSendMessage: (rawMessage: string) => void;
  onFileUpload: (file: File) => void;
  /**
   * Upload a recorded audio blob to /api/v1/voice-query.
   * Resolves `true` if a real query was routed, `false` if the backend reported silence.
   */
  onAudioVoiceQuery?: (audioBlob: Blob | File) => Promise<boolean>;
  disabled?: boolean;
  voiceMode?: "BROWSER_WEB_SPEECH" | "LIVEKIT_WEBRTC";
  isHoldingPTT?: boolean;
  onStartPTT?: () => void;
  onStopPTT?: () => void;
  placeholder?: string;
}

type MicStatus = "idle" | "requesting" | "recording" | "transcribing";

// Compressed 1-second audio clips (~800-1200 bytes); blobs < 400 bytes are treated as silence
const MIN_AUDIO_BYTES = 400;
const MAX_RECORDING_DURATION_MS = 25000; // 25-second pocket-dial auto-stop cap
const DIDNT_CATCH_THAT = "Didn't catch that — try speaking closer to the mic";
const MIC_PERMISSION_NEEDED = "Mic permission needed";
const DEFAULT_PLACEHOLDER = "Ask location or tap/hold mic to speak...";

function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.innerWidth < 768 ||
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}

function getSpeechRecognitionCtor(): any {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

function hasGetUserMedia(): boolean {
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  );
}

function getSupportedAudioMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/aac",
    "audio/ogg;codecs=opus",
  ];
  for (const t of types) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {}
  }
  return "";
}

export default function Omnibar({
  onSendMessage,
  onFileUpload,
  onAudioVoiceQuery,
  disabled = false,
  isHoldingPTT = false,
  onStartPTT,
  onStopPTT,
  placeholder: customPlaceholder,
}: OmnibarProps) {
  const [input, setInput] = useState("");
  const [micStatus, setMicStatus] = useState<MicStatus>("idle");
  const [flashPlaceholder, setFlashPlaceholder] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const micStatusRef = useRef<MicStatus>("idle");
  const isStartingMicRef = useRef<boolean>(false);
  const recordingStartedAtRef = useRef<number>(0);
  const liveTranscriptRef = useRef<string>("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoldingSpaceRef = useRef<boolean>(false);

  const onSendMessageRef = useRef(onSendMessage);
  const onAudioVoiceQueryRef = useRef(onAudioVoiceQuery);
  useEffect(() => {
    onSendMessageRef.current = onSendMessage;
    onAudioVoiceQueryRef.current = onAudioVoiceQuery;
  }, [onSendMessage, onAudioVoiceQuery]);

  const activeListening = micStatus === "recording" || isHoldingPTT;

  const showFlash = useCallback((text: string, ms: number = 2000) => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlashPlaceholder(text);
    flashTimerRef.current = setTimeout(() => setFlashPlaceholder(null), ms);
  }, []);

  const triggerHaptic = (durationMs: number = 35) => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(durationMs);
      } catch {}
    }
  };

  const clearTimers = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
  };

  const cleanupMediaStream = () => {
    if (mediaStreamRef.current) {
      try {
        mediaStreamRef.current.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {}
        });
      } catch {}
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
  };

  const resetToIdle = useCallback(() => {
    micStatusRef.current = "idle";
    setMicStatus("idle");
    clearTimers();
    cleanupMediaStream();
    onStopPTT?.();
  }, [onStopPTT]);

  /** Upload an audio blob/file; never uploads tiny/silent blobs. */
  const submitAudio = useCallback(
    async (audio: Blob | File) => {
      if (audio.size < MIN_AUDIO_BYTES || !onAudioVoiceQueryRef.current) {
        showFlash(DIDNT_CATCH_THAT);
        resetToIdle();
        return;
      }
      micStatusRef.current = "transcribing";
      setMicStatus("transcribing");
      try {
        const routed = await onAudioVoiceQueryRef.current(audio);
        if (!routed) showFlash(DIDNT_CATCH_THAT);
      } catch {
        showFlash(DIDNT_CATCH_THAT);
      } finally {
        resetToIdle();
        inputRef.current?.blur();
      }
    },
    [showFlash, resetToIdle]
  );

  // Finalize recording: stop recorders, wait 200ms for final audio chunk, and submit
  const finalizeAndSubmitRecording = useCallback(() => {
    if (micStatusRef.current !== "recording" && micStatusRef.current !== "requesting") return;

    micStatusRef.current = "transcribing";
    setMicStatus("transcribing");
    clearTimers();
    triggerHaptic(20);
    onStopPTT?.();

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    if (mediaStreamRef.current) {
      try {
        mediaStreamRef.current.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {}
        });
      } catch {}
    }

    setTimeout(() => {
      const capturedText = liveTranscriptRef.current.trim();
      const recordedChunks = [...audioChunksRef.current];
      liveTranscriptRef.current = "";
      audioChunksRef.current = [];
      cleanupMediaStream();
      setInput("");
      inputRef.current?.blur();

      // 1. Spoken words captured by desktop Web Speech -> send them directly
      if (capturedText.length > 0) {
        onSendMessageRef.current(capturedText);
        resetToIdle();
        return;
      }

      // 2. Upload recorded audio chunks to Gemini audio endpoint
      if (recordedChunks.length > 0) {
        const mimeType = recordedChunks[0]?.type || getSupportedAudioMimeType() || "audio/webm";
        submitAudio(new Blob(recordedChunks, { type: mimeType }));
      } else {
        showFlash(DIDNT_CATCH_THAT);
        resetToIdle();
      }
    }, 200);
  }, [onStopPTT, showFlash, submitAudio, resetToIdle]);

  const handlePermissionBlocked = useCallback(() => {
    resetToIdle();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort?.();
      } catch {}
    }
    showFlash(MIC_PERMISSION_NEEDED, 3000);
  }, [resetToIdle, showFlash]);

  const startRecordingSession = useCallback(
    async (isSpacebar: boolean = false) => {
      if (disabled || micStatusRef.current === "transcribing" || isStartingMicRef.current) return;
      isStartingMicRef.current = true;
      try {
        clearTimers();
        setFlashPlaceholder(null);
        liveTranscriptRef.current = "";
        audioChunksRef.current = [];

        if (!hasGetUserMedia()) {
          handlePermissionBlocked();
          return;
        }

        micStatusRef.current = "requesting";
        setMicStatus("requesting");
        triggerHaptic(30);
        onStartPTT?.();

        const mobile = isMobileDevice();
        const SpeechRecognition = getSpeechRecognitionCtor();

        // 1. Desktop only: Web Speech for live interim words in the input box
        if (!mobile && SpeechRecognition) {
          try {
            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = "en-US";

            recognition.onresult = (event: any) => {
              let fullTranscript = "";
              for (let i = 0; i < event.results.length; i++) {
                fullTranscript += event.results[i][0].transcript + " ";
              }
              const cleaned = fullTranscript.replace(/\s+/g, " ").trim();
              if (!cleaned) return;
              liveTranscriptRef.current = cleaned;
              setInput(cleaned);
            };

            recognition.onerror = () => {
              // Silence/abort is ignored; MediaRecorder acts as resilient fallback
            };

            recognitionRef.current = recognition;
            recognition.start();
          } catch {}
        }

        // 2. Cross-platform MediaRecorder with 200ms continuous chunk timeslice
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (micStatusRef.current !== "requesting") {
            try {
              stream.getTracks().forEach((t) => t.stop());
            } catch {}
            return;
          }

          mediaStreamRef.current = stream;
          const supportedMime = getSupportedAudioMimeType();
          const recorder = supportedMime
            ? new MediaRecorder(stream, { mimeType: supportedMime })
            : new MediaRecorder(stream);

          recorder.ondataavailable = (ev) => {
            if (ev.data && ev.data.size > 0) audioChunksRef.current.push(ev.data);
          };

          mediaRecorderRef.current = recorder;
          recorder.start(200);

          recordingStartedAtRef.current = Date.now();
          micStatusRef.current = "recording";
          setMicStatus("recording");
          triggerHaptic(40);

          // Deep Vector 7: 25-second pocket-dial auto-stop cap
          if (maxDurationTimerRef.current) clearTimeout(maxDurationTimerRef.current);
          maxDurationTimerRef.current = setTimeout(() => {
            finalizeAndSubmitRecording();
          }, MAX_RECORDING_DURATION_MS);
        } catch (err: any) {
          handlePermissionBlocked();
        }
      } finally {
        isStartingMicRef.current = false;
      }
    },
    [disabled, handlePermissionBlocked, onStartPTT]
  );

  // Single mic button: Deterministic State Machine for Mobile & Desktop
  const handleMicPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (disabled || micStatusRef.current === "transcribing") return;

    // If currently recording or requesting: tap again to finalize and send!
    if (micStatusRef.current === "recording" || micStatusRef.current === "requesting") {
      finalizeAndSubmitRecording();
      return;
    }

    startRecordingSession(false);
  };

  const handleMicPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    // If still requesting or idle, ignore pointer release (do not cancel async start)
    if (micStatusRef.current !== "recording") return;

    const elapsedSinceStart = Date.now() - recordingStartedAtRef.current;
    // Taps (<800ms) stay in recording mode! Clinician speaks and taps again to send.
    if (elapsedSinceStart < 800) {
      return;
    }

    // Long press (>=800ms hold after recording began): Walkie-Talkie release to send
    finalizeAndSubmitRecording();
  };

  // Spacebar foot-pedal PTT (desktop only, ignored while typing in the input)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isTyping =
        activeEl instanceof HTMLTextAreaElement || activeEl instanceof HTMLInputElement;
      if (
        e.code === "Space" &&
        !e.repeat &&
        !isHoldingSpaceRef.current &&
        !isTyping &&
        !disabled &&
        micStatusRef.current === "idle"
      ) {
        e.preventDefault();
        isHoldingSpaceRef.current = true;
        startRecordingSession(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && isHoldingSpaceRef.current) {
        e.preventDefault();
        isHoldingSpaceRef.current = false;
        finalizeAndSubmitRecording();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [disabled, startRecordingSession, finalizeAndSubmitRecording]);

  useEffect(() => {
    return () => {
      clearTimers();
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      cleanupMediaStream();
    };
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (micStatusRef.current === "recording" || micStatusRef.current === "requesting") {
      finalizeAndSubmitRecording();
      return;
    }
    if (!input.trim() || disabled || micStatus === "transcribing") return;
    if (input.length > 2000) {
      showFlash("Query exceeds 2,000 character limit", 3000);
      return;
    }
    const msg = input.trim();
    setInput("");
    inputRef.current?.blur();
    onSendMessage(msg);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onFileUpload(files[0]);
      e.target.value = "";
    }
  };

  const placeholder =
    micStatus === "requesting"
      ? "🎙️ Starting mic..."
      : micStatus === "recording"
      ? "🔴 Recording... Tap mic to send"
      : micStatus === "transcribing"
      ? "Transcribing audio clip..."
      : flashPlaceholder || customPlaceholder || DEFAULT_PLACEHOLDER;

  const isTranscribingState = micStatus === "transcribing";

  return (
    <div className="p-3 sm:p-4 bg-[#09090b] border-t border-zinc-800/60">
      <div className="max-w-3xl mx-auto">
        <form
          onSubmit={handleSubmit}
          className={`rounded-xl bg-zinc-900 border px-2 sm:px-3 py-1.5 sm:py-2 flex items-center gap-1.5 sm:gap-2 shadow-sm transition-colors ${
            activeListening
              ? "border-rose-700/80"
              : micStatus === "requesting"
              ? "border-amber-600/70"
              : "border-zinc-800 focus-within:border-zinc-700"
          }`}
        >
          {/* Hidden file input (.csv, .md) */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.md,.txt"
            className="hidden"
            onChange={handleFileInputChange}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            title="Upload Inventory CSV or Orientation Markdown (.csv, .md)"
            data-testid="paperclip-upload-btn"
            className="p-1.5 sm:p-2 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <div className="flex-1 min-w-0 flex items-center gap-2">
            {activeListening && (
              <Radio className="w-3.5 h-3.5 text-rose-400 animate-pulse shrink-0" />
            )}
            {micStatus === "requesting" && (
              <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
            )}
            <input
              ref={inputRef}
              type="text"
              value={input}
              maxLength={2000}
              onChange={(e) => setInput(e.target.value)}
              placeholder={placeholder}
              disabled={disabled || micStatus === "recording" || micStatus === "requesting"}
              data-testid="omnibar-input"
              className={`w-full bg-transparent text-sm text-zinc-100 focus:outline-none truncate py-1 ${
                flashPlaceholder && !activeListening
                  ? "placeholder:text-amber-400/80"
                  : micStatus === "recording"
                  ? "placeholder:text-rose-400 font-medium"
                  : micStatus === "requesting"
                  ? "placeholder:text-amber-400"
                  : "placeholder:text-zinc-500"
              }`}
            />
          </div>

          {/* Real walkie-talkie mic button: Tap to Start/Send or Hold to Talk */}
          <button
            type="button"
            data-testid="ptt-mic-btn"
            onPointerDown={handleMicPointerDown}
            onPointerUp={handleMicPointerUp}
            disabled={disabled || isTranscribingState}
            title={
              micStatus === "recording"
                ? "Tap to send voice query"
                : micStatus === "requesting"
                ? "Initializing microphone..."
                : "Tap to record or hold to speak (Spacebar on desktop)"
            }
            className={`p-2 rounded-lg transition-all shrink-0 cursor-pointer select-none touch-none ${
              micStatus === "recording"
                ? "bg-rose-600 text-white animate-pulse shadow-sm"
                : micStatus === "requesting"
                ? "bg-amber-600/30 text-amber-300 animate-pulse"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            } disabled:opacity-50`}
          >
            {isTranscribingState || micStatus === "requesting" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </button>

          <button
            type="submit"
            disabled={disabled || isTranscribingState || (!input.trim() && !activeListening && micStatus !== "requesting")}
            className="p-2 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 transition-colors shrink-0 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isTranscribingState ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
