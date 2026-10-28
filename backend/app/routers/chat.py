"""
OR-Nav Hybrid Chat, Governance, Offline Sync, and In-RAM Voice Router.

Endpoints:
    POST /api/chat                    — Hybrid query router (PHI scrub -> Move detect -> Tier 1 -> Tier 2)
    POST /api/v1/voice-query          — In-RAM audio buffer scrubber + hybrid query router
    GET  /api/inventory/sync          — Full tenant inventory dump for Offline PWA (Dexie.js IndexedDB)
    POST /api/inventory/verify-move   — Crowdsourced 3-step move confirmation
    POST /api/inventory/flag-wrong    — Explicit governance flag (score -> 0.5, needs_reverification)
    GET  /api/questions               — List unanswered & tentative department questions
    POST /api/questions               — Create a new unanswered orientee question
    POST /api/questions/{id}/answer   — Submit peer answer ('confident' | 'tentative_unsure') or verify
    POST /api/questions/{id}/verify   — Promote peer answer into verified orientation.md
    POST /api/ingest                  — Upload CSV or MD to update tenant knowledge base
"""

import io
import re
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from app.config import get_tenant, settings, DEPARTMENTS
from app.scrubber import scrub_phi
from app.intent_parser import parse_clinical_intent, ClinicalIntent
from app.services.governance import get_governance_service
from app.services.inventory_search import (
    get_inventory_service,
    split_compound_query,
    preprocess_voice_query,
)
from app.services.rag_fallback import (
    get_rag_service,
    evaluate_rbac,
    filter_surgeon_note_for_role,
)


router = APIRouter(prefix="/api", tags=["chat"])


# ---------------------------------------------------------------------------
# Request / Response Schemas
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    """Incoming chat message from the frontend."""
    message: str = Field(..., min_length=1, max_length=2000, description="User query text")
    tenant_id: str = Field(
        default=settings.default_tenant,
        description="Hospital tenant directory ID",
    )
    facility_name: Optional[str] = Field(
        default="General Memorial Hospital",
        description="Root hospital facility name",
    )
    clinical_role: Optional[str] = Field(
        default=None,
        description="Assigned clinical role (e.g. Circulating RN (CNOR), Scrub Nurse / CST)",
    )


class CoordinateCard(BaseModel):
    """Structured 4-part location card returned by Tier 1 lookups."""
    item: str
    category: str
    room: str
    cabinet: str
    shelf: str
    container: str
    full_code: str
    human_alias: str = ""
    aliases: str = ""
    pending_location: str = ""
    verify_count: int = 0
    surgeon_notes: str = ""
    verification_score: float = 3.0
    status: str = "verified"
    last_verified_at: str = ""
    phonetic_code: str = ""
    match_stage: str = "STAGE_A_EXACT"
    surgeon_filter: Optional[str] = None
    highlighted_surgeon_note: Optional[str] = None


def extract_surgeon_name(text: str) -> Optional[str]:
    """Extract Dr. [Name] or Doctor [Name] from query text."""
    m = re.search(r"\b(?:dr\.?|doctor)\s+([a-zA-Z]+)\b", text, re.IGNORECASE)
    if m:
        return f"Dr. {m.group(1).capitalize()}"
    return None


def highlight_surgeon_note(surgeon: Optional[str], notes: Optional[str]) -> Optional[str]:
    """Find and return the specific sentence or clause for the given surgeon."""
    if not surgeon or not notes:
        return None
    s_last = re.sub(r"^(?:dr\.?|doctor)\s*", "", surgeon, flags=re.IGNORECASE).strip()
    clauses = re.split(r";|\.(?<!\bdr\.)\s+", notes, flags=re.IGNORECASE)
    matching = [c.strip() for c in clauses if re.search(rf"\b{re.escape(s_last)}\b", c, re.IGNORECASE)]
    if matching:
        return "; ".join(matching).strip()
    return None


class MoveVerifyWidget(BaseModel):
    """Crowdsourced move confirmation widget data."""
    item: str
    current_location: str
    new_location: str
    verify_count: int
    required_count: int = 3
    committed: bool = False


class QuickAddWidget(BaseModel):
    """Inline widget prompt when user asks to add an item without coordinates."""
    item: str
    suggested_location: Optional[str] = None


class ChatResponse(BaseModel):
    """Unified response from /api/chat."""
    reply_text: str
    routing_tier: str  # "TIER_1_LOCAL_CSV" | "TIER_2_GEMINI_RAG" | "MOVE_REPORTED"
    scrubbed_query: str
    phi_detected: bool
    latency_ms: float
    is_educational_baseline: bool = False
    coordinate_card: Optional[CoordinateCard] = None
    coordinate_cards: list[CoordinateCard] = Field(default_factory=list)
    move_widget: Optional[MoveVerifyWidget] = None
    spoken_transcript_correction: Optional[str] = None
    disambiguation_chips: list[str] = Field(default_factory=list)
    quick_add_widget: Optional[QuickAddWidget] = None


class AddItemRequest(BaseModel):
    """Request body for POST /api/inventory/add-item."""
    tenant_id: str = Field(default=settings.default_tenant)
    item: str = Field(..., min_length=1)
    location: str = Field(..., min_length=1)
    category: str = Field(default="Supplies")
    surgeon_notes: str = Field(default="")


class VerifyMoveRequest(BaseModel):
    """Request body for POST /api/inventory/verify-move."""
    tenant_id: str = Field(default=settings.default_tenant)
    item: str = Field(..., min_length=1, description="Exact item name to verify move for")
    expected_location: Optional[str] = Field(default=None, description="Expected pending coordinate target (prevents stale confirms)")


class VerifyMoveResponse(BaseModel):
    """Response from POST /api/inventory/verify-move."""
    item: str
    full_code: str
    pending_location: str
    verify_count: int
    committed: bool
    superseded: bool = False
    reply_text: str
    coordinate_card: CoordinateCard


class FlagWrongRequest(BaseModel):
    """Request body for POST /api/inventory/flag-wrong."""
    tenant_id: str = Field(default=settings.default_tenant)
    item: str = Field(..., min_length=1)
    reason: str = Field(default="Location empty or item moved")


class CreateQuestionRequest(BaseModel):
    """Request body for POST /api/questions."""
    tenant_id: str = Field(default=settings.default_tenant)
    question_text: str = Field(..., min_length=3)
    asked_by_role: str = Field(default="Clinical Orientee RN")


class AnswerQuestionRequest(BaseModel):
    """Request body for POST /api/questions/{question_id}/answer."""
    tenant_id: str = Field(default=settings.default_tenant)
    answer_text: Optional[str] = Field(default=None)
    confidence: str = Field(default="confident")  # "confident" | "tentative_unsure" | "verified"
    responder_role: str = Field(default="Clinical Peer RN")
    promote_to_verified: bool = Field(default=False)


def check_tenant(tenant_id: str) -> TenantConfig:
    """Validate tenant_id format and existence, returning 400 for path traversal or 404."""
    try:
        return get_tenant(tenant_id)
    except ValueError as e:
        msg = str(e)
        if "Invalid tenant_id" in msg or "Path traversal" in msg:
            raise HTTPException(status_code=400, detail=msg)
        raise HTTPException(status_code=404, detail=msg)


# ---------------------------------------------------------------------------
# POST /api/chat — Hybrid Query Router
# ---------------------------------------------------------------------------

@router.post("/chat", response_model=ChatResponse)
async def handle_chat(req: ChatRequest):
    """
    Hybrid query router:
      1. Scrub PHI from incoming message before any processing.
      2. Parse structured semantic intent and spoken clinical speech biases.
      3. Check if message reports a conversational inventory mutation (Add Item or Move Item).
      4. Attempt Tier 1 3-Stage Deterministic Cascade (<15ms, $0 LLM cost).
      5. Fall back to Tier 2 Gemini 2.5 Flash RAG (+ GLOBAL_BASELINE) for procedural queries.
    """
    t0 = time.perf_counter()

    check_tenant(req.tenant_id)

    # Step 1: Mandatory PHI Scrubbing at the edge & Voice Self-Correction
    scrub_result = scrub_phi(req.message)
    scrubbed_text = scrub_result.text
    phi_detected = scrub_result.redaction_count > 0

    # Step 1.5: Semantic Intent & Biased Clinical Listening Normalizer
    parsed_intent = parse_clinical_intent(scrubbed_text, req.clinical_role)
    processed_text = preprocess_voice_query(parsed_intent.normalized_query)

    inv_service = get_inventory_service(req.tenant_id)

    # Step 1.8: Handle Conversational Inventory Mutations (Add Item)
    if parsed_intent.intent == ClinicalIntent.MUTATE_INVENTORY and parsed_intent.entities.action == "add":
        item_to_add = parsed_intent.entities.item or processed_text
        if parsed_intent.entities.location:
            card_dict = inv_service.add_inventory_item(item_to_add, parsed_intent.entities.location)
            card = CoordinateCard(**card_dict)
            elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
            reply = f"✓ Added {card.item} to inventory at {card.full_code}."
            return ChatResponse(
                reply_text=reply,
                routing_tier="TIER_1_LOCAL_CSV",
                scrubbed_query=scrubbed_text,
                phi_detected=phi_detected,
                latency_ms=elapsed_ms,
                coordinate_card=card,
                coordinate_cards=[card],
                spoken_transcript_correction=parsed_intent.spoken_transcript_correction,
            )
        else:
            elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
            reply = f"What location should I add '{item_to_add}' to? Fill in the details below or say 'Add {item_to_add} to OR 21 B 1 A'."
            return ChatResponse(
                reply_text=reply,
                routing_tier="TIER_1_LOCAL_CSV",
                scrubbed_query=scrubbed_text,
                phi_detected=phi_detected,
                latency_ms=elapsed_ms,
                quick_add_widget=QuickAddWidget(item=item_to_add),
                spoken_transcript_correction=parsed_intent.spoken_transcript_correction,
            )

    # Step 2: Check for natural language move command
    move_parsed = inv_service.parse_move_command(processed_text)
    if move_parsed is not None:
        item_query, new_loc = move_parsed
        card_dict = inv_service.report_move(item_query, new_loc)
        if card_dict is not None:
            elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
            card = CoordinateCard(**card_dict)
            widget = MoveVerifyWidget(
                item=card.item,
                current_location=card.full_code,
                new_location=card.pending_location,
                verify_count=card.verify_count,
                required_count=3,
                committed=False,
            )
            reply = (
                f"Move reported for {card.item} to {new_loc} "
                f"(1/3 confirmations). Needs 2 more confirmations from peers "
                f"before updating primary location {card.full_code}."
            )
            return ChatResponse(
                reply_text=reply,
                routing_tier="MOVE_REPORTED",
                scrubbed_query=scrubbed_text,
                phi_detected=phi_detected,
                latency_ms=elapsed_ms,
                coordinate_card=card,
                move_widget=widget,
                spoken_transcript_correction=parsed_intent.spoken_transcript_correction,
            )

    # Step 3: Tier 1 Local CSV Lookup (Multi-Item Compound Lookup & Single Item Cascade)
    compound_parts = split_compound_query(processed_text)
    if len(compound_parts) >= 2:
        cards_found: list[CoordinateCard] = []
        missing_parts: list[str] = []
        procedural_parts: list[str] = []
        surgeon_name = extract_surgeon_name(processed_text) or extract_surgeon_name(req.message)

        for part in compound_parts:
            c_dict = inv_service.search(part, record_implicit_verification=True)
            if c_dict is not None:
                card = CoordinateCard(**c_dict)
                if surgeon_name:
                    spec_note = highlight_surgeon_note(surgeon_name, card.surgeon_notes)
                    if spec_note:
                        card.surgeon_filter = surgeon_name
                        card.highlighted_surgeon_note = spec_note
                if req.clinical_role:
                    card.surgeon_notes = filter_surgeon_note_for_role(card.surgeon_notes, req.clinical_role) or ""
                    if card.highlighted_surgeon_note:
                        card.highlighted_surgeon_note = filter_surgeon_note_for_role(card.highlighted_surgeon_note, req.clinical_role)
                        if not card.highlighted_surgeon_note:
                            card.surgeon_filter = None
                if not any(existing.item == card.item for existing in cards_found):
                    cards_found.append(card)
            else:
                if inv_service.is_procedural_query(part) or re.search(
                    r"\b(what|how|why|when|who|dose|target|protocol|guideline|preference|act)\b",
                    part,
                    re.IGNORECASE,
                ):
                    procedural_parts.append(part)
                else:
                    missing_parts.append(part)

        if len(cards_found) >= 1:
            elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
            if len(cards_found) > 1:
                reply_lines = [
                    f"• {c.item}: {c.room}, Cabinet {c.cabinet}, Shelf {c.shelf}, Bin {c.container}"
                    for c in cards_found
                ]
                reply = f"Found {len(cards_found)} items:\n" + "\n".join(reply_lines)
            else:
                card = cards_found[0]
                reply = f"Found {card.item}: {card.room}, Cabinet {card.cabinet}, Shelf {card.shelf}, Bin {card.container}."
                if card.highlighted_surgeon_note:
                    reply += f" Note for {card.surgeon_filter}: {card.highlighted_surgeon_note}."
                elif card.surgeon_notes:
                    reply += f" Note: {card.surgeon_notes}."

            # Crack B: If compound query includes procedural/protocol question, resolve via RAG
            if procedural_parts:
                rag_service = get_rag_service(req.tenant_id)
                for p_query in procedural_parts:
                    allowed, denial_reason = evaluate_rbac(p_query, req.clinical_role)
                    if not allowed:
                        reply += f"\n\n📋 Clinical Guidance for '{p_query}':\n{denial_reason}"
                    else:
                        rag_reply, _ = await rag_service.query_with_meta(
                            p_query,
                            facility_name=req.facility_name,
                            clinical_role=req.clinical_role,
                        )
                        reply += f"\n\n📋 Clinical Guidance for '{p_query}':\n{rag_reply}"

            if missing_parts:
                missing_str = ", ".join(f"'{p}'" for p in missing_parts)
                reply += f"\nCould not find {missing_str} in local inventory."

            return ChatResponse(
                reply_text=reply,
                routing_tier="TIER_1_LOCAL_CSV",
                scrubbed_query=scrubbed_text,
                phi_detected=phi_detected,
                latency_ms=elapsed_ms,
                coordinate_card=cards_found[0],
                coordinate_cards=cards_found,
                move_widget=None,
                spoken_transcript_correction=parsed_intent.spoken_transcript_correction,
                disambiguation_chips=parsed_intent.disambiguation_options,
            )

    # Vector 4: Generic Family Multi-Match (e.g. "where is prolene", "where are blades")
    if not inv_service.is_procedural_query(processed_text):
        family_cards_dict = inv_service.search_family(processed_text, max_results=4)
        if len(family_cards_dict) > 1:
            elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
            family_cards = [CoordinateCard(**cd) for cd in family_cards_dict]
            if req.clinical_role:
                for fc in family_cards:
                    fc.surgeon_notes = filter_surgeon_note_for_role(fc.surgeon_notes, req.clinical_role) or ""
            reply_lines = [
                f"• {c.item}: {c.room}, Cabinet {c.cabinet}, Shelf {c.shelf}, Bin {c.container}"
                for c in family_cards
            ]
            reply = f"Found {len(family_cards)} items in this family:\n" + "\n".join(reply_lines)
            return ChatResponse(
                reply_text=reply,
                routing_tier="TIER_1_LOCAL_CSV",
                scrubbed_query=scrubbed_text,
                phi_detected=phi_detected,
                latency_ms=elapsed_ms,
                coordinate_card=family_cards[0],
                coordinate_cards=family_cards,
                move_widget=None,
                spoken_transcript_correction=parsed_intent.spoken_transcript_correction,
                disambiguation_chips=parsed_intent.disambiguation_options,
            )

    # Standard Single Item Search
    card_dict = inv_service.search(processed_text, record_implicit_verification=True)
    if card_dict is not None:
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        card = CoordinateCard(**card_dict)

        surgeon_name = extract_surgeon_name(processed_text) or extract_surgeon_name(req.message)
        if surgeon_name:
            spec_note = highlight_surgeon_note(surgeon_name, card.surgeon_notes)
            if spec_note:
                card.surgeon_filter = surgeon_name
                card.highlighted_surgeon_note = spec_note

        if req.clinical_role:
            card.surgeon_notes = filter_surgeon_note_for_role(card.surgeon_notes, req.clinical_role) or ""
            if card.highlighted_surgeon_note:
                card.highlighted_surgeon_note = filter_surgeon_note_for_role(card.highlighted_surgeon_note, req.clinical_role)
                if not card.highlighted_surgeon_note:
                    card.surgeon_filter = None

        reply = f"{card.item} is in {card.room}, Cabinet {card.cabinet}, Shelf {card.shelf}, Container {card.container}."
        if card.highlighted_surgeon_note:
            reply += f" Note for {card.surgeon_filter}: {card.highlighted_surgeon_note}."
        elif card.surgeon_notes:
            reply += f" Note: {card.surgeon_notes}."

        widget = None
        if card.pending_location:
            widget = MoveVerifyWidget(
                item=card.item,
                current_location=card.full_code,
                new_location=card.pending_location,
                verify_count=card.verify_count,
                required_count=3,
                committed=False,
            )

        return ChatResponse(
            reply_text=reply,
            routing_tier="TIER_1_LOCAL_CSV",
            scrubbed_query=scrubbed_text,
            phi_detected=phi_detected,
            latency_ms=elapsed_ms,
            coordinate_card=card,
            coordinate_cards=[card],
            move_widget=widget,
            spoken_transcript_correction=parsed_intent.spoken_transcript_correction,
            disambiguation_chips=parsed_intent.disambiguation_options,
        )

    # If the user was searching for a specific item and it is not in inventory, show quick-add widget
    if parsed_intent.intent == ClinicalIntent.FIND_INVENTORY:
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        target_item = (parsed_intent.entities.item or processed_text).strip()
        reply = f"'{target_item}' is not currently stocked in local inventory. Would you like to add it?"
        return ChatResponse(
            reply_text=reply,
            routing_tier="TIER_1_LOCAL_CSV",
            scrubbed_query=scrubbed_text,
            phi_detected=phi_detected,
            latency_ms=elapsed_ms,
            coordinate_card=None,
            coordinate_cards=[],
            move_widget=None,
            quick_add_widget=QuickAddWidget(item=target_item),
            spoken_transcript_correction=parsed_intent.spoken_transcript_correction,
            disambiguation_chips=parsed_intent.disambiguation_options,
        )

    # Step 4: Tier 2 Gemini 2.5 Flash RAG Fallback (+ GLOBAL_BASELINE)
    allowed, denial_reason = evaluate_rbac(scrubbed_text, req.clinical_role)
    if not allowed:
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        return ChatResponse(
            reply_text=denial_reason or "Access restricted.",
            routing_tier="RBAC_RESTRICTED",
            scrubbed_query=scrubbed_text,
            phi_detected=phi_detected,
            latency_ms=elapsed_ms,
            is_educational_baseline=False,
            coordinate_card=None,
            move_widget=None,
            spoken_transcript_correction=parsed_intent.spoken_transcript_correction,
        )

    rag_service = get_rag_service(req.tenant_id)
    rag_reply, is_baseline = await rag_service.query_with_meta(
        scrubbed_text,
        facility_name=req.facility_name,
        clinical_role=req.clinical_role,
    )
    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)

    return ChatResponse(
        reply_text=rag_reply,
        routing_tier="TIER_2_GEMINI_RAG",
        scrubbed_query=scrubbed_text,
        phi_detected=phi_detected,
        latency_ms=elapsed_ms,
        is_educational_baseline=is_baseline,
        coordinate_card=None,
        move_widget=None,
        spoken_transcript_correction=parsed_intent.spoken_transcript_correction,
        disambiguation_chips=parsed_intent.disambiguation_options,
    )


# ---------------------------------------------------------------------------
# POST /api/v1/voice-query — In-RAM Audio Scrubber & Hybrid Router
# ---------------------------------------------------------------------------

_MIN_AUDIO_BYTES = 400  # Compressed 1-second audio clips can be ~800-1200 bytes; blobs <400 are treated as silence
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB upload cap (Deep Vector 7)


@router.post("/v1/voice-query")
async def handle_in_ram_voice_query(
    file: UploadFile = File(...),
    tenant_id: str = Form(default=settings.default_tenant),
    transcript_hint: Optional[str] = Form(default=None),
):
    """
    Zero-Disk-Write In-RAM Audio Endpoint:
      1. Reads uploaded audio bytes strictly into an in-memory `io.BytesIO` buffer.
      2. Rejects payloads > 10 MB with HTTP 413 Payload Too Large.
      3. Attempts `faster-whisper` if installed; otherwise passes in-RAM audio bytes
         directly to `gemini-2.5-flash` (`types.Part.from_bytes`) with CVOR biased vocabulary.
      4. Explicitly deletes `audio_bytes` and closes buffer in RAM (`del audio_bytes`).
      5. Scrubs PHI and routes through the deterministic/RAG hybrid router.
      6. If no speech is detected (empty / tiny blob / "[SILENCE]"), returns
         `{"safe_transcript": "", "silence": true}` and routes NOTHING.
      7. Catches all decoding/gemini exceptions gracefully without throwing HTTP 500.
    """
    import os

    check_tenant(tenant_id)

    try:
        explicit_transcript = (transcript_hint or "").strip()
        audio_bytes = await file.read()
        if len(audio_bytes) > MAX_UPLOAD_SIZE:
            raise HTTPException(
                status_code=413,
                detail="Payload too large. Audio file exceeds 10 MB limit.",
            )
        audio_buffer = io.BytesIO(audio_bytes)

        if len(audio_bytes) == 0:
            return {"safe_transcript": "", "silence": True, "error_handled": True}

        # Strip codec parameters (e.g. ';codecs=opus') because Gemini API rejects them
        raw_content_type = (file.content_type or "").split(";")[0].strip().lower()
        fname = (file.filename or "").lower()

        # Reject unsupported non-audio MIME types / non-audio filenames immediately
        is_audio_content = raw_content_type.startswith("audio/") or any(
            fname.endswith(ext) for ext in (".webm", ".mp4", ".m4a", ".wav", ".ogg")
        )
        if not is_audio_content:
            return {"safe_transcript": "", "silence": True, "error_handled": True}

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

        # Validate container magic bytes for raw audio payloads (guard against non-audio garbage)
        if not explicit_transcript and len(audio_bytes) >= _MIN_AUDIO_BYTES:
            is_valid_magic = False
            if mime_type == "audio/wav" and (audio_bytes[:4] == b"RIFF" and audio_bytes[8:12] == b"WAVE"):
                is_valid_magic = True
            elif mime_type == "audio/webm" and audio_bytes[:4] == b"\x1a\x45\xdf\xa3":
                is_valid_magic = True
            elif mime_type == "audio/ogg" and audio_bytes[:4] == b"OggS":
                is_valid_magic = True
            elif mime_type == "audio/mp4" and (len(audio_bytes) >= 8 and (audio_bytes[4:8] == b"ftyp" or b"ftyp" in audio_bytes[:32])):
                is_valid_magic = True

            if not is_valid_magic:
                return {"safe_transcript": "", "silence": True, "error_handled": True}

        transcribed_text = ""

        try:
            # 1. Attempt local faster-whisper if installed (skip for tiny/silent blobs)
            if not explicit_transcript and len(audio_bytes) >= _MIN_AUDIO_BYTES:
                try:
                    from faster_whisper import WhisperModel  # type: ignore

                    model = WhisperModel("tiny.en", device="cpu", compute_type="int8")
                    segments, _ = model.transcribe(audio_buffer)
                    transcribed_text = " ".join(seg.text for seg in segments).strip()
                except Exception:
                    pass

            # 2. If faster-whisper is not installed, use Gemini 2.5 Flash Multimodal Audio
            active_key = os.getenv("GEMINI_API_KEY", "").strip()
            if (
                not transcribed_text
                and not explicit_transcript
                and active_key
                and active_key != "your-api-key-here"
                and len(audio_bytes) >= _MIN_AUDIO_BYTES
            ):
                try:
                    from google import genai

                    client = genai.Client(api_key=active_key)
                    audio_part = genai.types.Part.from_bytes(
                        data=audio_bytes,
                        mime_type=mime_type,
                    )
                    from app.routers.voice import SURGICAL_TRANSCRIPTION_PROMPT
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

            # 3. Use an explicitly client-supplied transcript only if one was sent
            if not transcribed_text and explicit_transcript:
                transcribed_text = explicit_transcript
        finally:
            audio_buffer.close()
            del audio_bytes

        # Strict silence handling: NO hardcoded fallback query is ever routed.
        cleaned = transcribed_text.strip().strip('"').strip("'").strip()
        if not cleaned or cleaned.upper().strip(".") in ("[SILENCE]", "SILENCE"):
            return {"safe_transcript": "", "silence": True}

        chat_resp = await handle_chat(ChatRequest(message=cleaned, tenant_id=tenant_id))
        payload = chat_resp.model_dump()
        payload["safe_transcript"] = chat_resp.scrubbed_query
        payload["silence"] = False
        return payload
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning(f"Voice query exception handled cleanly: {exc}")
        return {"safe_transcript": "", "silence": True, "error_handled": True}
    payload["silence"] = False
    return payload


# ---------------------------------------------------------------------------
# GET /api/inventory/sync — Layer 1 Offline PWA IndexedDB Sync
# ---------------------------------------------------------------------------

@router.get("/inventory/sync")
async def sync_inventory(
    tenant_id: str = Query(default=settings.default_tenant),
):
    """Return full enriched inventory list for local Dexie.js IndexedDB caching."""
    check_tenant(tenant_id)

    inv_service = get_inventory_service(tenant_id)
    items = inv_service.get_sync_payload()
    return {
        "tenant_id": tenant_id,
        "count": len(items),
        "synced_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "items": items,
    }


# ---------------------------------------------------------------------------
# POST /api/inventory/flag-wrong — Explicit Clinical Governance Flag
# ---------------------------------------------------------------------------

@router.post("/inventory/flag-wrong", response_model=CoordinateCard)
async def handle_flag_wrong(req: FlagWrongRequest):
    """
    Explicitly flag an inventory item as empty/moved/incorrect.
    Immediately drops `verification_score` to 0.5 and sets `status = 'needs_reverification'`.
    """
    check_tenant(req.tenant_id)

    inv_service = get_inventory_service(req.tenant_id)
    updated = inv_service.flag_wrong(req.item, req.reason)
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Item '{req.item}' not found in inventory.")

    return CoordinateCard(**updated)


# ---------------------------------------------------------------------------
# POST /api/inventory/verify-move — 3-Step Crowdsourced Move Consensus
# ---------------------------------------------------------------------------

@router.post("/inventory/verify-move", response_model=VerifyMoveResponse)
async def handle_verify_move(req: VerifyMoveRequest):
    """
    Increment verification count for an item's pending move.
    Auto-commits the new coordinates to primary columns when verify_count reaches 3.
    Vector 3: Checks expected_location to reject stale confirmations on superseded moves.
    """
    check_tenant(req.tenant_id)

    inv_service = get_inventory_service(req.tenant_id)
    result = inv_service.verify_move(req.item, req.expected_location)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Item '{req.item}' not found in inventory.")

    committed = result.pop("committed", False)
    superseded = result.pop("superseded", False)
    card = CoordinateCard(**result)

    if superseded:
        reply_text = (
            f"Relocation for {card.item} was superseded by a newer move report to {card.pending_location} "
            f"({card.verify_count}/3)."
        )
    elif committed:
        reply_text = (
            f"3/3 confirmations reached! {card.item} location committed to "
            f"{card.full_code}."
        )
    else:
        reply_text = (
            f"Move verified for {card.item} ({card.verify_count}/3 confirmations "
            f"toward {card.pending_location})."
        )

    return VerifyMoveResponse(
        item=card.item,
        full_code=card.full_code,
        pending_location=card.pending_location,
        verify_count=card.verify_count,
        committed=committed,
        superseded=superseded,
        reply_text=reply_text,
        coordinate_card=card,
    )


# ---------------------------------------------------------------------------
# POST /api/inventory/add-item — Conversational or Interactive Inventory Addition
# ---------------------------------------------------------------------------

@router.post("/inventory/add-item", response_model=CoordinateCard)
async def handle_add_inventory_item(req: AddItemRequest):
    """
    Directly insert or update an item in inventory with specified coordinates.
    """
    check_tenant(req.tenant_id)

    inv_service = get_inventory_service(req.tenant_id)
    card_dict = inv_service.add_inventory_item(
        item=req.item,
        location_str=req.location,
        category=req.category,
        surgeon_notes=req.surgeon_notes,
    )
    return CoordinateCard(**card_dict)



# ---------------------------------------------------------------------------
# GET & POST /api/questions — Passive Unanswered Dept Questions Feed
# ---------------------------------------------------------------------------

@router.get("/questions")
async def list_department_questions(
    tenant_id: str = Query(default=settings.default_tenant),
    include_verified: bool = Query(default=True),
):
    """List open, tentative, and verified peer questions for the department."""
    check_tenant(tenant_id)

    gov = get_governance_service(tenant_id)
    questions = gov.list_questions(include_verified=include_verified)
    open_count = sum(1 for q in questions if q.get("status") != "verified")
    return {
        "tenant_id": tenant_id,
        "open_count": open_count,
        "questions": questions,
    }


@router.post("/questions")
async def create_department_question(req: CreateQuestionRequest):
    """Create a new unanswered department question."""
    check_tenant(req.tenant_id)

    gov = get_governance_service(req.tenant_id)
    created = gov.create_question(req.question_text, req.asked_by_role)
    return created


@router.post("/questions/{question_id}/answer")
async def answer_department_question(question_id: str, req: AnswerQuestionRequest):
    """
    Submit a peer answer ('confident' or 'tentative_unsure') or promote to
    'verified' (`promote_to_verified=True`), which appends the Q&A to `orientation.md`.
    """
    check_tenant(req.tenant_id)

    gov = get_governance_service(req.tenant_id)
    updated = gov.answer_question(
        question_id=question_id,
        answer_text=req.answer_text,
        confidence=req.confidence,
        responder_role=req.responder_role,
        promote_to_verified=req.promote_to_verified,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Question '{question_id}' not found.")

    return updated


# ---------------------------------------------------------------------------
# POST /api/ingest — Dynamic CSV / Markdown Upload
# ---------------------------------------------------------------------------

@router.post("/ingest")
async def handle_ingest(
    tenant_id: str = Form(default=settings.default_tenant),
    file: UploadFile = File(...),
):
    """
    Upload a new inventory.csv or orientation.md for a tenant.
    Reloads the in-memory InventoryService and RAGService caches immediately.
    """
    tenant = check_tenant(tenant_id)

    filename = (file.filename or "").lower()
    raw_bytes = await file.read()
    if len(raw_bytes) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=413,
            detail="Payload too large. Ingest file exceeds 10 MB limit.",
        )
    text_content = raw_bytes.decode("utf-8", errors="replace")

    if filename.endswith(".csv"):
        inv_service = get_inventory_service(tenant_id)
        try:
            row_count = inv_service.ingest_csv(text_content)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        get_rag_service(tenant_id).reload()
        return {
            "status": "ok",
            "tenant_id": tenant_id,
            "file_type": "csv",
            "rows_loaded": row_count,
        }
    elif filename.endswith(".md") or filename.endswith(".txt"):
        tenant.orientation_path.parent.mkdir(parents=True, exist_ok=True)
        tenant.orientation_path.write_text(text_content, encoding="utf-8")
        get_rag_service(tenant_id).reload()
        return {
            "status": "ok",
            "tenant_id": tenant_id,
            "file_type": "markdown",
            "characters_loaded": len(text_content),
        }
    else:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Upload a .csv (inventory) or .md (orientation) file.",
        )
