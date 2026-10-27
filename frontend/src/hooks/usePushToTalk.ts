"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Room, RoomEvent } from "livekit-client";
import { fetchVoiceStatus, fetchVoiceToken, VoiceStatusResponse } from "@/lib/api";

export type VoiceMode = "BROWSER_WEB_SPEECH" | "LIVEKIT_WEBRTC";

interface UsePushToTalkOptions {
  tenantId: string;
  onDataChannelSync?: (payload: any) => void;
  onSpeechTranscript?: (transcript: string) => void;
}

export function usePushToTalk({
  tenantId,
  onDataChannelSync,
}: UsePushToTalkOptions) {
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("BROWSER_WEB_SPEECH");
  const [livekitConfigured, setLivekitConfigured] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isHoldingPTT, setIsHoldingPTT] = useState<boolean>(false);
  const [roomError, setRoomError] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);

  // 1. Check Voice Server Status on mount
  useEffect(() => {
    fetchVoiceStatus()
      .then((status: VoiceStatusResponse) => {
        setLivekitConfigured(status.livekit_configured);
        if (status.livekit_configured) {
          setVoiceMode("LIVEKIT_WEBRTC");
        } else {
          setVoiceMode("BROWSER_WEB_SPEECH");
        }
      })
      .catch(() => {
        setVoiceMode("BROWSER_WEB_SPEECH");
      });
  }, []);

  // 2. Connect to LiveKit Room when in LIVEKIT_WEBRTC mode
  useEffect(() => {
    if (voiceMode !== "LIVEKIT_WEBRTC" || !livekitConfigured) {
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
        setIsConnected(false);
      }
      return;
    }

    let isCancelled = false;

    async function connectRoom() {
      try {
        setRoomError(null);
        const { token, livekit_url } = await fetchVoiceToken(tenantId);
        if (isCancelled) return;

        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
        });

        room.on(
          RoomEvent.DataReceived,
          (payload: Uint8Array, _participant, _kind, topic) => {
            if (topic === "or_nav_ui_sync") {
              try {
                const text = new TextDecoder().decode(payload);
                const data = JSON.parse(text);
                if (onDataChannelSync) {
                  onDataChannelSync(data);
                }
              } catch (parseErr) {
                console.error("Failed to parse data channel UI sync:", parseErr);
              }
            }
          }
        );

        room.on(RoomEvent.Disconnected, () => {
          setIsConnected(false);
        });

        await room.connect(livekit_url, token);
        await room.localParticipant.setMicrophoneEnabled(false);

        if (!isCancelled) {
          roomRef.current = room;
          setIsConnected(true);
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          const msg = err instanceof Error ? err.message : "Failed to connect to LiveKit Room";
          setRoomError(msg);
          setVoiceMode("BROWSER_WEB_SPEECH");
        }
      }
    }

    connectRoom();

    return () => {
      isCancelled = true;
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
        setIsConnected(false);
      }
    };
  }, [voiceMode, livekitConfigured, tenantId, onDataChannelSync]);

  // 3. Push-to-Talk Press Handler (LiveKit WebRTC mode + state sync)
  const startPTT = useCallback(async () => {
    setIsHoldingPTT(true);

    if (voiceMode === "LIVEKIT_WEBRTC" && roomRef.current?.localParticipant) {
      try {
        await roomRef.current.localParticipant.setMicrophoneEnabled(true);
      } catch (err) {
        console.error("Error enabling LiveKit microphone:", err);
      }
    }
  }, [voiceMode]);

  // 4. Push-to-Talk Release Handler
  const stopPTT = useCallback(async () => {
    setIsHoldingPTT(false);

    if (voiceMode === "LIVEKIT_WEBRTC" && roomRef.current?.localParticipant) {
      try {
        await roomRef.current.localParticipant.setMicrophoneEnabled(false);
      } catch (err) {
        console.error("Error muting LiveKit microphone:", err);
      }
    }
  }, [voiceMode]);

  const toggleVoiceMode = () => {
    if (voiceMode === "BROWSER_WEB_SPEECH") {
      setVoiceMode(livekitConfigured ? "LIVEKIT_WEBRTC" : "BROWSER_WEB_SPEECH");
    } else {
      setVoiceMode("BROWSER_WEB_SPEECH");
    }
  };

  return {
    voiceMode,
    livekitConfigured,
    isConnected,
    isHoldingPTT,
    roomError,
    startPTT,
    stopPTT,
    toggleVoiceMode,
  };
}
