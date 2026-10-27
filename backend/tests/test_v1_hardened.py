"""
Unit & Integration Tests for OR-Nav v1.0 Hardened MVP Architecture (Phase 9).

Verifies:
  1. Layer 2 Phonetic Double Metaphone & OR Homophone Resolution:
     - "where is the bakery" -> DeBakey Forceps 12in
     - "find pro lean" -> 2-0 Prolene Suture
     - "four oh tie cron" -> 2-0 Ti-Cron Suture
     - "white laner" -> Saphenous Vein Retractor
     - Pure phonetic misspellings ("debakee", "weitlener") via Stage B Double Metaphone
  2. Layer 2 In-RAM Audio Scrubber (`POST /api/v1/voice-query`):
     - Processes audio bytes in memory (`io.BytesIO`), scrubs PHI, and resolves query
  3. Layer 3 Implicit Behavioral Verification (+0.5 per lookup -> verified at 3.0)
     & Explicit Flag Wrong (`POST /api/inventory/flag-wrong` -> score 0.5, needs_reverification)
  4. Layer 3 Passive Unanswered Dept Questions Feed (`/api/questions`):
     - List seeded questions, create new question, answer with `tentative_unsure` and `confident`,
       and promote `[Worked — Verify]` into `orientation.md`
  5. Layer 3 Global Educational Baseline (`GLOBAL_BASELINE/baseline.md`):
     - Carotid Endarterectomy cranial nerve check sets `is_educational_baseline: True`
  6. Layer 1 Offline PWA Sync Endpoint (`GET /api/inventory/sync`)
"""

import io
import shutil
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.config import get_tenant, HOSPITALS_DIR
from app.services.governance import reset_governance_services
from app.services.inventory_search import (
    normalize_and_hash,
    reset_inventory_services,
)
from app.services.rag_fallback import reset_rag_services


@pytest.fixture(autouse=True)
def isolate_v1_tenant_data():
    """Backup and restore inventory.csv, orientation.md, and unanswered_questions.json."""
    tenant = get_tenant("general_memorial_cvor")
    inv_path = tenant.inventory_path
    orient_path = tenant.orientation_path
    q_path = HOSPITALS_DIR / "general_memorial_cvor" / "unanswered_questions.json"

    inv_bak = inv_path.with_suffix(".csv.v1bak")
    orient_bak = orient_path.with_suffix(".md.v1bak")
    q_bak = q_path.with_suffix(".json.v1bak")

    shutil.copyfile(inv_path, inv_bak)
    shutil.copyfile(orient_path, orient_bak)
    if q_path.exists():
        shutil.copyfile(q_path, q_bak)

    reset_inventory_services()
    reset_rag_services()
    reset_governance_services()

    yield

    if inv_bak.exists():
        shutil.copyfile(inv_bak, inv_path)
        inv_bak.unlink()
    if orient_bak.exists():
        shutil.copyfile(orient_bak, orient_path)
        orient_bak.unlink()
    if q_bak.exists():
        shutil.copyfile(q_bak, q_path)
        q_bak.unlink()

    reset_inventory_services()
    reset_rag_services()
    reset_governance_services()


@pytest.fixture
def client():
    return TestClient(app)


class TestPhoneticDoubleMetaphoneCascade:
    """Verify OR Homophone Map + Double Metaphone 3-Stage Deterministic Cascade."""

    def test_normalize_and_hash_homophones(self):
        norm1, phon1 = normalize_and_hash("where is the bakery")
        assert "debakey" in norm1
        assert "TPK" in phon1

        norm2, phon2 = normalize_and_hash("four oh tie cron")
        assert "4-0" in norm2
        assert "ti-cron" in norm2
        assert "TKRN" in phon2

    @pytest.mark.parametrize("query,expected_item", [
        ("where is the bakery", "DeBakey Forceps 12in"),
        ("find pro lean", "2-0 Prolene Suture"),
        ("four oh tie cron", "2-0 Ti-Cron Suture"),
        ("white laner", "Saphenous Vein Retractor"),
        ("where are the debakee forceps", "DeBakey Forceps 12in"),
        ("need a weitlener", "Saphenous Vein Retractor"),
    ])
    def test_phonetic_and_homophone_queries_resolve_tier_1(self, client, query, expected_item):
        resp = client.post(
            "/api/chat",
            json={"message": query, "tenant_id": "general_memorial_cvor"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["routing_tier"] == "TIER_1_LOCAL_CSV", f"Failed Tier 1 for '{query}'"
        card = data["coordinate_card"]
        assert card is not None
        assert card["item"] == expected_item
        assert len(card["human_alias"]) > 5
        assert card["phonetic_code"] != ""


class TestInRamVoiceQueryEndpoint:
    """Verify POST /api/v1/voice-query processes audio in RAM and scrubs PHI."""

    def test_tiny_silent_blob_returns_silence_and_routes_nothing(self, client):
        """A tiny/empty blob with NO explicit transcript must NOT route any default query."""
        files = {"file": ("silence.webm", io.BytesIO(b"\x1a\x45\xdf\xa3" + b"\x00" * 64), "audio/webm")}
        resp = client.post("/api/v1/voice-query", files=files, data={"tenant_id": "general_memorial_cvor"})
        assert resp.status_code == 200
        body = resp.json()
        assert body == {"safe_transcript": "", "silence": True}
        assert "coordinate_card" not in body

    @pytest.mark.live_llm
    def test_live_silent_wav_gemini_returns_silence(self, client):
        """A real 1.5s silent WAV (zero samples) must return silence, never a hallucinated item."""
        import os
        import wave

        if not os.getenv("GEMINI_API_KEY", "").strip():
            pytest.skip("GEMINI_API_KEY not configured for live audio transcription")

        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            wf.writeframes(b"\x00\x00" * 24000)
        files = {"file": ("silent.wav", io.BytesIO(buf.getvalue()), "audio/wav")}
        resp = client.post("/api/v1/voice-query", files=files, data={"tenant_id": "general_memorial_cvor"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["silence"] is True
        assert body["safe_transcript"] == ""

    def test_in_ram_voice_query_scrubs_phi_and_routes(self, client):
        fake_webm_bytes = b"\x1a\x45\xdf\xa3" + b"\x00" * 128
        files = {"file": ("ptt_clip.webm", io.BytesIO(fake_webm_bytes), "audio/webm")}
        data = {
            "tenant_id": "general_memorial_cvor",
            "transcript_hint": "Patient John Smith MRN 9384721 asks where is the bakery",
        }
        resp = client.post("/api/v1/voice-query", files=files, data=data)
        assert resp.status_code == 200
        body = resp.json()
        assert body["phi_detected"] is True
        assert "John Smith" not in body["scrubbed_query"]
        assert body["routing_tier"] == "TIER_1_LOCAL_CSV"
        assert body["coordinate_card"]["item"] == "DeBakey Forceps 12in"

    def test_real_wav_audio_upload_in_ram_voice_query(self, client):
        """Synthesize a valid 16kHz mono PCM WAV file in RAM and verify /api/v1/voice-query end-to-end."""
        import math
        import struct
        import wave

        wav_buf = io.BytesIO()
        sample_rate = 16000
        duration_sec = 0.5
        n_samples = int(sample_rate * duration_sec)
        with wave.open(wav_buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            frames = bytearray()
            for i in range(n_samples):
                val = int(4000 * math.sin(2 * math.pi * 440.0 * (i / sample_rate)))
                frames.extend(struct.pack("<h", val))
            wf.writeframes(bytes(frames))

        wav_bytes = wav_buf.getvalue()
        assert len(wav_bytes) > 1000

        files = {"file": ("or_voice_query.wav", io.BytesIO(wav_bytes), "audio/wav")}
        data = {
            "tenant_id": "general_memorial_cvor",
            "transcript_hint": "Patient Sarah Connor MRN 8841209 needs four oh tie cron",
        }
        resp = client.post("/api/v1/voice-query", files=files, data=data)
        assert resp.status_code == 200
        body = resp.json()
        assert body["phi_detected"] is True
        assert "Sarah Connor" not in body["scrubbed_query"]
        assert "8841209" not in body["scrubbed_query"]
        assert body["routing_tier"] == "TIER_1_LOCAL_CSV"
        assert body["coordinate_card"]["item"] == "2-0 Ti-Cron Suture"

    @pytest.mark.live_llm
    def test_live_spoken_wav_gemini_audio_transcription_and_phi_scrub(self, client):
        """
        Synthesize real spoken English speech into an in-memory WAV buffer using
        Windows SpeechSynthesizer (with NO transcript_hint) and verify that
        POST /api/v1/voice-query transcribes it via Gemini 2.5 Flash Audio,
        scrubs spoken PHI, and resolves the CoordinateCard.
        """
        import os
        import subprocess
        import tempfile

        if not os.getenv("GEMINI_API_KEY", "").strip():
            pytest.skip("GEMINI_API_KEY not configured for live audio transcription")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_path = tmp.name

        try:
            ps_cmd = (
                "Add-Type -AssemblyName System.Speech; "
                "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
                f"$synth.SetOutputToWaveFile('{tmp_path}'); "
                "$synth.Speak('Patient John Smith MRN 9384721 where is the three oh silk'); "
                "$synth.Dispose();"
            )
            subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], check=True)
            with open(tmp_path, "rb") as f:
                spoken_wav_bytes = f.read()
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

        assert len(spoken_wav_bytes) > 4000

        # Upload ONLY the raw WAV audio bytes with NO transcript_hint!
        files = {"file": ("spoken_or_query.wav", io.BytesIO(spoken_wav_bytes), "audio/wav")}
        data = {"tenant_id": "general_memorial_cvor"}
        resp = client.post("/api/v1/voice-query", files=files, data=data)
        assert resp.status_code == 200
        body = resp.json()
        assert "John Smith" not in body["scrubbed_query"]
        assert body["routing_tier"] == "TIER_1_LOCAL_CSV"
        assert body["coordinate_card"]["item"] == "3-0 Silk Suture"


class TestImplicitVerificationAndFlagWrong:
    """Verify +0.5 implicit behavioral verification and explicit flag-wrong decay."""

    def test_implicit_verification_promotes_provisional_to_verified(self, client):
        # Ice Slush Machine Bags starts at verification_score=1.5, status='provisional'
        r1 = client.post("/api/chat", json={"message": "where is ice slush"})
        c1 = r1.json()["coordinate_card"]
        assert c1["item"] == "Ice Slush Machine Bags"
        assert c1["verification_score"] == 2.0
        assert c1["status"] == "provisional"

        # 2nd unflagged lookup -> 2.5 (still provisional)
        r2 = client.post("/api/chat", json={"message": "where is ice slush"})
        c2 = r2.json()["coordinate_card"]
        assert c2["verification_score"] == 2.5
        assert c2["status"] == "provisional"

        # 3rd unflagged lookup -> 3.0 (auto-promoted to 'verified'!)
        r3 = client.post("/api/chat", json={"message": "where is ice slush"})
        c3 = r3.json()["coordinate_card"]
        assert c3["verification_score"] == 3.0
        assert c3["status"] == "verified"

    def test_explicit_flag_wrong_drops_score_to_0_5(self, client):
        resp = client.post(
            "/api/inventory/flag-wrong",
            json={
                "tenant_id": "general_memorial_cvor",
                "item": "DeBakey Forceps 12in",
                "reason": "Bin A was empty during emergent case",
            },
        )
        assert resp.status_code == 200
        card = resp.json()
        assert card["item"] == "DeBakey Forceps 12in"
        assert card["verification_score"] == 0.5
        assert card["status"] == "needs_reverification"


class TestUnansweredQuestionsLifecycle:
    """Verify Layer 3 Passive Unanswered Dept Questions Feed & orientation.md promotion."""

    def test_questions_list_create_answer_and_verify(self, client):
        # 1. List seeded questions
        r_list = client.get("/api/questions?tenant_id=general_memorial_cvor")
        assert r_list.status_code == 200
        initial_data = r_list.json()
        assert initial_data["open_count"] >= 2

        # 2. Create a new orientee question
        r_create = client.post(
            "/api/questions",
            json={
                "tenant_id": "general_memorial_cvor",
                "question_text": "Where are the extra sterile Mayo stand covers kept on weekends?",
                "asked_by_role": "CVOR Orientee RN",
            },
        )
        assert r_create.status_code == 200
        q_id = r_create.json()["id"]
        assert r_create.json()["status"] == "open"

        # 3. Peer submits a tentative ("I think so / Unsure") answer
        r_tent = client.post(
            f"/api/questions/{q_id}/answer",
            json={
                "tenant_id": "general_memorial_cvor",
                "answer_text": "I think they are on the bottom shelf of Core Supply Rack E.",
                "confidence": "tentative_unsure",
                "responder_role": "Circulating RN",
            },
        )
        assert r_tent.status_code == 200
        assert r_tent.json()["status"] == "answered_tentative"
        assert r_tent.json()["answers"][-1]["confidence"] == "tentative_unsure"

        # 4. Preceptor/peer confirms with [Worked — Verify] -> promotes into orientation.md
        r_ver = client.post(
            f"/api/questions/{q_id}/answer",
            json={
                "tenant_id": "general_memorial_cvor",
                "promote_to_verified": True,
            },
        )
        assert r_ver.status_code == 200
        assert r_ver.json()["status"] == "verified"
        assert r_ver.json()["verified_at"] is not None

        # Verify orientation.md now contains the promoted Q&A
        orient_text = get_tenant("general_memorial_cvor").orientation_path.read_text(encoding="utf-8")
        assert "Mayo stand covers" in orient_text
        assert "Core Supply Rack E" in orient_text


class TestGlobalEducationalBaselineAndOfflineSync:
    """Verify GLOBAL_BASELINE fallback badge and Layer 1 Offline PWA sync payload."""

    def test_global_baseline_carotid_cranial_nerve_check(self, client, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        reset_rag_services()

        resp = client.post(
            "/api/chat",
            json={
                "message": "What are the cranial nerve checks after carotid endarterectomy?",
                "tenant_id": "general_memorial_cvor",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["routing_tier"] == "TIER_2_GEMINI_RAG"
        assert data["is_educational_baseline"] is True
        assert "Hypoglossal" in data["reply_text"] or "Cranial Nerve" in data["reply_text"]

    def test_inventory_sync_endpoint_returns_enriched_items(self, client):
        resp = client.get("/api/inventory/sync?tenant_id=general_memorial_cvor")
        assert resp.status_code == 200
        data = resp.json()
        assert data["tenant_id"] == "general_memorial_cvor"
        assert data["count"] >= 20
        first = data["items"][0]
        assert "human_alias" in first
        assert "verification_score" in first
        assert "status" in first
        assert "phonetic_code" in first
