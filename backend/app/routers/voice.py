"""
OR-Nav LiveKit Voice Router — Status & JWT Token Minting.

Endpoints:
    GET  /api/voice/status — Checks LiveKit configuration and returns active mode.
    POST /api/voice/token  — Generates short-lived WebRTC room token for clinicians.
"""

import os
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class VoiceStatusResponse(BaseModel):
    livekit_configured: bool
    livekit_url: Optional[str] = None
    mode: str  # "LIVEKIT_WEBRTC" | "BROWSER_WEB_SPEECH"


class VoiceTokenRequest(BaseModel):
    tenant_id: str = "general_memorial_cvor"
    participant_name: str = "cvor_clinician"


class VoiceTokenResponse(BaseModel):
    token: str
    room_name: str
    livekit_url: str
    tenant_id: str


def is_livekit_configured() -> bool:
    """Return True if all required LiveKit environment variables are set."""
    url = os.getenv("LIVEKIT_URL", "").strip()
    key = os.getenv("LIVEKIT_API_KEY", "").strip()
    secret = os.getenv("LIVEKIT_API_SECRET", "").strip()
    return bool(url and key and secret)


@router.get("/api/voice/status", response_model=VoiceStatusResponse)
async def get_voice_status():
    """
    Check if LiveKit WebRTC credentials are configured.
    Enables dual-mode operation:
      - Returns LIVEKIT_WEBRTC if configured.
      - Returns BROWSER_WEB_SPEECH for zero-config offline operation.
    """
    configured = is_livekit_configured()
    url = os.getenv("LIVEKIT_URL", "").strip() if configured else None
    mode = "LIVEKIT_WEBRTC" if configured else "BROWSER_WEB_SPEECH"

    return VoiceStatusResponse(
        livekit_configured=configured,
        livekit_url=url,
        mode=mode,
    )


@router.post("/api/voice/token", response_model=VoiceTokenResponse)
async def mint_voice_token(req: VoiceTokenRequest):
    """
    Mint a short-lived JWT Access Token for joining the CVOR LiveKit Room.

    Grants:
      - room_join=True
      - can_publish=True (audio stream under PTT gate)
      - can_subscribe=True (hear AI voice response)
      - can_publish_data=True (data channel for UI sync)

    Stores tenant_id in participant metadata for multi-tenant isolation.
    Returns HTTP 503 if LiveKit credentials are not configured.
    """
    if not is_livekit_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "LiveKit voice server is not configured. "
                "Ensure LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET are set in .env."
            ),
        )

    try:
        from livekit.api import AccessToken, VideoGrants
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="livekit-api package is not installed in the backend environment.",
        )

    api_key = os.getenv("LIVEKIT_API_KEY", "").strip()
    api_secret = os.getenv("LIVEKIT_API_SECRET", "").strip()
    livekit_url = os.getenv("LIVEKIT_URL", "").strip()
    room_name = f"or-nav-{req.tenant_id}"

    grant = VideoGrants(
        room_join=True,
        room=room_name,
        can_publish=True,
        can_subscribe=True,
        can_publish_data=True,
    )

    metadata = f'{{"tenant_id": "{req.tenant_id}"}}'

    token = (
        AccessToken(api_key, api_secret)
        .with_grants(grant)
        .with_identity(req.participant_name)
        .with_metadata(metadata)
    )

    jwt_string = token.to_jwt()

    return VoiceTokenResponse(
        token=jwt_string,
        room_name=room_name,
        livekit_url=livekit_url,
        tenant_id=req.tenant_id,
    )
