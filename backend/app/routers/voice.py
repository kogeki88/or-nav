"""
OR-Nav LiveKit Voice Router — Status & JWT Token Minting.

Endpoints:
    GET  /api/voice/status — Checks LiveKit configuration and returns active mode.
    POST /api/voice/token  — Generates short-lived WebRTC room token for clinicians.
"""

import io
import os
import re
from typing import Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from app.services.surgical_ontology import normalize_or_lingo
from app.scrubber import scrub_phi

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


class VoiceTranscribeResponse(BaseModel):
    transcript: str
    safe_transcript: str
    silence: bool


SURGICAL_TRANSCRIPTION_PROMPT = (
    "You are an expert Operating Room and Surgical Scrub Nurse transcriber. Transcribe the audio verbatim. "
    "Accurately identify surgical instruments, eponyms, sutures, and OR terminology: "
    "Adson, DeBakey, Gerald, Russian, Metzenbaum, Mayo, Iris, Tenotomy, Crile, Kelly, Pean, Kocher, Allis, "
    "Babcock, Mixter, Schnidt, Satinsky, Cooley, Mayo-Hegar, Crile-Wood, Ryder, Castroviejo, Army-Navy, Senn, "
    "Richardson, Deaver, Malleable, Weitlaner, Gelpi, Bookwalter, Omni-Tract, Balfour, Finochietto, Kerrison, "
    "Leksell, Cobb, Freer, Penfield, Kittner, Ray-Tec, Yankauer, Frazier, Poole, Prolene, Vicryl, Monocryl, "
    "Ethibond, Silk, Bovie, snaps, pickups, metz, peanut, etc. "
    "CRITICAL RULE: If the audio contains only silence, static, clicks, or background hum with no clear human speech, "
    "return the exact string [SILENCE] and nothing else. "
    "Return ONLY the verbatim transcript text with no quotes, tags, or conversational preamble."
)


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


@router.post("/api/voice/transcribe", response_model=VoiceTranscribeResponse)
async def transcribe_surgical_audio(
    file: UploadFile = File(...),
    tenant_id: str = Form(default="sacred_heart::or"),
    transcript_hint: Optional[str] = Form(default=None),
):
    """
    Multimodal Surgical Voice Transcription Endpoint.
    Transcribes incoming audio in RAM with OR/CVOR vocabulary biasing.
    """
    audio_bytes = await file.read()
    if len(audio_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio file exceeds 10 MB limit.")

    if len(audio_bytes) < 400:
        return VoiceTranscribeResponse(transcript="", safe_transcript="", silence=True)

    raw_content_type = (file.content_type or "").split(";")[0].strip().lower()
    fname = (file.filename or "").lower()

    if "webm" in raw_content_type or fname.endswith(".webm"):
        mime_type = "audio/webm"
    elif "mp4" in raw_content_type or fname.endswith(".mp4") or fname.endswith(".m4a"):
        mime_type = "audio/mp4"
    elif "wav" in raw_content_type or fname.endswith(".wav"):
        mime_type = "audio/wav"
    elif "ogg" in raw_content_type or fname.endswith(".ogg"):
        mime_type = "audio/ogg"
    elif raw_content_type.startswith("audio/"):
        mime_type = raw_content_type
    else:
        mime_type = "audio/wav"

    transcribed_text = (transcript_hint or "").strip()

    # 1. Faster-whisper fallback
    if not transcribed_text:
        try:
            from faster_whisper import WhisperModel
            buffer = io.BytesIO(audio_bytes)
            model = WhisperModel("tiny.en", device="cpu", compute_type="int8")
            segments, _ = model.transcribe(buffer)
            transcribed_text = " ".join(seg.text for seg in segments).strip()
        except Exception:
            pass

    # 2. Gemini 2.5 Flash Multimodal Audio with Surgical Biasing
    active_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not transcribed_text and active_key and active_key != "your-api-key-here":
        try:
            from google import genai
            client = genai.Client(api_key=active_key)
            audio_part = genai.types.Part.from_bytes(data=audio_bytes, mime_type=mime_type)
            resp = await client.aio.models.generate_content(
                model="gemini-2.5-flash",
                contents=[audio_part, SURGICAL_TRANSCRIPTION_PROMPT],
                config=genai.types.GenerateContentConfig(
                    temperature=0.0,
                    max_output_tokens=256,
                ),
            )
            if resp and resp.text:
                transcribed_text = resp.text.strip().strip('"').strip("'")
        except Exception:
            pass

    del audio_bytes

    cleaned = transcribed_text.strip().strip('"').strip("'").strip()
    if not cleaned or cleaned.upper().strip(".") in ("[SILENCE]", "SILENCE"):
        return VoiceTranscribeResponse(transcript="", safe_transcript="", silence=True)

    normalized = normalize_or_lingo(cleaned)
    scrubbed = scrub_phi(normalized).text

    return VoiceTranscribeResponse(
        transcript=normalized,
        safe_transcript=scrubbed,
        silence=False,
    )

