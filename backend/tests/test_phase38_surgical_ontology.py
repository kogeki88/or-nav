"""
Phase 38 Master Test Suite: Surgical Ontology Engine, Strict Eponym Guard (No False Positives),
Gemini Audio Listening & 120+ OR Instrument Catalog.
"""

import io
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.inventory_search import get_inventory_service, reset_inventory_services
from app.services.surgical_ontology import (
    OR_LINGO_EQUIVALENCE,
    SURGICAL_EPONYMS,
    GENERIC_INSTRUMENT_CLASSES,
    EPONYM_PHONETIC_STT_MAP,
    normalize_or_lingo,
    extract_eponyms,
    is_eponym_conflict,
    is_generic_class_only,
)

client = TestClient(app)
TEST_TENANT = "sacred_heart::or"


@pytest.fixture(autouse=True)
def clean_services():
    from app.config import get_tenant
    tenant = get_tenant(TEST_TENANT)
    original_csv = tenant.inventory_path.read_bytes() if tenant.inventory_path.exists() else None
    reset_inventory_services()
    yield
    if original_csv is not None:
        tenant.inventory_path.write_bytes(original_csv)
    reset_inventory_services()


# ---------------------------------------------------------------------------
# 1. Eponym Conflict & Strict Guard Unit Tests
# ---------------------------------------------------------------------------

def test_extract_eponyms_and_conflict_logic():
    # Eponym extraction
    assert "adson" in extract_eponyms("Adson pickups")
    assert "debakey" in extract_eponyms("DeBakey vascular forceps")
    assert "gerald" in extract_eponyms("gerald pickups")
    assert "russian" in extract_eponyms("Russian forceps 8in")
    assert "metzenbaum" in extract_eponyms("metz dissecting scissors")
    assert "castroviejo" in extract_eponyms("castro needle holder")
    assert "crile" in extract_eponyms("snaps")
    assert "kittner" in extract_eponyms("peanut sponge")

    # Conflict logic
    # Adson vs DeBakey
    assert is_eponym_conflict("adson pickups", "DeBakey Vascular Tissue Forceps 12in") is True
    assert is_eponym_conflict("adson pickups", "Adson Tissue Forceps 1x2 (Adson Pickups)") is False

    # DeBakey vs Adson
    assert is_eponym_conflict("debakey pickups", "Adson Tissue Forceps 1x2 (Adson Pickups)") is True
    assert is_eponym_conflict("debakey pickups", "DeBakey Vascular Tissue Forceps 12in") is False

    # Metz vs Mayo
    assert is_eponym_conflict("metz", "Mayo Scissors Heavy Straight") is True
    assert is_eponym_conflict("metz", "Metzenbaum Scissors 7in Curved") is False

    # Castro vs Mayo-Hegar
    assert is_eponym_conflict("castro", "Mayo-Hegar Needle Holder 6in") is True
    assert is_eponym_conflict("castro", "Castroviejo Micro Needle Holder") is False

    # Rich vs Deaver
    assert is_eponym_conflict("rich", "Deaver Retractor #2 Medium 2in") is True
    assert is_eponym_conflict("rich", "Richardson Retractor Large") is False

    # Unknown modifier + generic class vs existing instruments
    assert is_eponym_conflict("unobtanium laser forceps", "DeBakey Vascular Tissue Forceps 12in") is True
    assert is_eponym_conflict("unobtanium laser forceps", "Adson Tissue Forceps 1x2 (Adson Pickups)") is True
    assert is_eponym_conflict("klingon plasma retractor", "Army-Navy Retractor Pair") is True


def test_generic_class_only_detection():
    assert is_generic_class_only("forceps") is True
    assert is_generic_class_only("pickups") is True
    assert is_generic_class_only("scissors") is True
    assert is_generic_class_only("clamp") is True
    assert is_generic_class_only("retractor") is True
    assert is_generic_class_only("where is the forceps") is True

    # Modified / eponymous queries are NOT generic-only
    assert is_generic_class_only("adson pickups") is False
    assert is_generic_class_only("metz") is False
    assert is_generic_class_only("4-0 prolene") is False


# ---------------------------------------------------------------------------
# 2. End-to-End Inventory Search with Strict Eponym Guard
# ---------------------------------------------------------------------------

def test_adson_pickups_vs_debakey_end_to_end():
    inv_service = get_inventory_service(TEST_TENANT)

    # 1. Search for "adson pickups" -> MUST return Adson, NEVER DeBakey
    match_adson = inv_service.search("adson pickups")
    assert match_adson is not None
    assert "Adson" in match_adson["item"]
    assert "DeBakey" not in match_adson["item"]

    # 2. Search for "debakey pickups" -> MUST return DeBakey, NEVER Adson
    match_debakey = inv_service.search("debakey pickups")
    assert match_debakey is not None
    assert "DeBakey" in match_debakey["item"]
    assert "Adson" not in match_debakey["item"]

    # 3. Search for "gerald pickups" -> MUST return Gerald
    match_gerald = inv_service.search("gerald pickups")
    assert match_gerald is not None
    assert "Gerald" in match_gerald["item"]

    # 4. Search for "russian pickups" -> MUST return Russian
    match_russian = inv_service.search("russian pickups")
    assert match_russian is not None
    assert "Russian" in match_russian["item"]


def test_or_lingo_slang_search_end_to_end():
    inv_service = get_inventory_service(TEST_TENANT)

    # "metz" -> Metzenbaum (never Mayo)
    match_metz = inv_service.search("metz")
    assert match_metz is not None
    assert "Metzenbaum" in match_metz["item"]
    assert "Mayo" not in match_metz["item"]

    # "snaps" -> Crile Hemostat
    match_snaps = inv_service.search("snaps")
    assert match_snaps is not None
    assert "Crile" in match_snaps["item"] or "Snap" in match_snaps["item"] or "Hemostat" in match_snaps["item"]

    # "peanut" -> Kittner
    match_peanut = inv_service.search("peanut")
    assert match_peanut is not None
    assert "Kittner" in match_peanut["item"]

    # "right angle" -> Mixter Right-Angle Clamp
    match_ra = inv_service.search("right angle")
    assert match_ra is not None
    assert "Right-Angle" in match_ra["item"] or "Mixter" in match_ra["item"]

    # "castro" -> Castroviejo Micro Needle Holder (never Mayo-Hegar)
    match_castro = inv_service.search("castro")
    assert match_castro is not None
    assert "Castroviejo" in match_castro["item"]
    assert "Mayo-Hegar" not in match_castro["item"]

    # "rich" -> Richardson Retractor
    match_rich = inv_service.search("rich")
    assert match_rich is not None
    assert "Richardson" in match_rich["item"]

    # "cat paw" -> Senn Retractor
    match_catpaw = inv_service.search("cat paw")
    assert match_catpaw is not None
    assert "Senn" in match_catpaw["item"]

    # "ray-tec" -> Ray-Tec Sponges
    match_raytec = inv_service.search("raytec")
    assert match_raytec is not None
    assert "Ray-Tec" in match_raytec["item"]


# ---------------------------------------------------------------------------
# 3. Strict Eponym Veto & Quick-Add on Missing Items
# ---------------------------------------------------------------------------

def test_unstocked_unobtanium_returns_zero_false_positives_and_quick_add():
    # Via API chat router
    resp = client.post(
        "/api/chat",
        json={"message": "Where are the unobtanium laser forceps?", "tenant_id": TEST_TENANT},
    )
    assert resp.status_code == 200
    data = resp.json()

    # Must NOT match DeBakey Forceps or any other instrument!
    assert data.get("coordinate_card") is None
    assert not data.get("coordinate_cards")

    # Must provide QuickAddWidget for "unobtanium laser forceps"
    assert data.get("quick_add_widget") is not None
    assert "unobtanium" in data["quick_add_widget"]["item"].lower()
    assert "laser" in data["quick_add_widget"]["item"].lower()


# ---------------------------------------------------------------------------
# 4. Phonetic STT Mishearing Normalization
# ---------------------------------------------------------------------------

def test_phonetic_stt_mishearing_normalization():
    # "add son pickups" -> resolves to Adson
    inv_service = get_inventory_service(TEST_TENANT)
    match = inv_service.search("add son pickups")
    assert match is not None
    assert "Adson" in match["item"]

    # "the bakey pickups" -> resolves to DeBakey
    match_deb = inv_service.search("the bakey pickups")
    assert match_deb is not None
    assert "DeBakey" in match_deb["item"]

    # "white laner" -> resolves to Weitlaner
    match_weit = inv_service.search("white laner")
    assert match_weit is not None
    assert "Weitlaner" in match_weit["item"]


# ---------------------------------------------------------------------------
# 5. POST /api/voice/transcribe Endpoint
# ---------------------------------------------------------------------------

def test_voice_transcribe_endpoint():
    # 1. Tiny/silent audio blob returns silence=True
    tiny_blob = b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80>\x00\x00\x00}\x00\x00\x02\x00\x10\x00data\x00\x00\x00\x00"
    resp_silent = client.post(
        "/api/voice/transcribe",
        data={"tenant_id": TEST_TENANT},
        files={"file": ("test.wav", io.BytesIO(tiny_blob), "audio/wav")},
    )
    assert resp_silent.status_code == 200
    data_silent = resp_silent.json()
    assert data_silent["silence"] is True
    assert data_silent["transcript"] == ""

    # 2. Valid payload with transcript hint normalizes OR lingo
    mock_audio = b"\x1a\x45\xdf\xa3" + b"\x00" * 500  # Valid webm header > 400 bytes
    resp_hint = client.post(
        "/api/voice/transcribe",
        data={"tenant_id": TEST_TENANT, "transcript_hint": "hand me the metz and ad son pickups"},
        files={"file": ("speech.webm", io.BytesIO(mock_audio), "audio/webm")},
    )
    assert resp_hint.status_code == 200
    data_hint = resp_hint.json()
    assert data_hint["silence"] is False
    # In Phase 39, acoustic normalization preserves clinician slang 'metz' while fixing 'ad son' -> 'adson'
    assert "metz" in data_hint["transcript"] or "metzenbaum" in data_hint["transcript"]
    assert "adson" in data_hint["transcript"]


# ---------------------------------------------------------------------------
# 6. Master 120+ Item Catalog Verification
# ---------------------------------------------------------------------------

def test_120_plus_item_catalog_completeness():
    inv_service = get_inventory_service(TEST_TENANT)
    rows = inv_service.get_sync_payload()

    # Must contain at least 120 distinct items
    assert len(rows) >= 120, f"Expected >= 120 items, got {len(rows)}"

    item_names = [r["item"].lower() for r in rows]

    # Verify presence of all major instrument families
    # Forceps
    assert any("adson" in name for name in item_names)
    assert any("debakey" in name for name in item_names)
    assert any("gerald" in name for name in item_names)
    assert any("russian" in name for name in item_names)

    # Scissors
    assert any("metzenbaum" in name for name in item_names)
    assert any("mayo" in name and "scissors" in name for name in item_names)
    assert any("iris" in name for name in item_names)
    assert any("tenotomy" in name for name in item_names)

    # Clamps
    assert any("crile" in name for name in item_names)
    assert any("kelly" in name for name in item_names)
    assert any("kocher" in name for name in item_names)
    assert any("mixter" in name or "right-angle" in name for name in item_names)
    assert any("satinsky" in name for name in item_names)

    # Needle holders
    assert any("castroviejo" in name for name in item_names)
    assert any("mayo-hegar" in name for name in item_names)
    assert any("crile-wood" in name for name in item_names)
    assert any("ryder" in name for name in item_names)

    # Retractors
    assert any("army-navy" in name for name in item_names)
    assert any("senn" in name for name in item_names)
    assert any("richardson" in name for name in item_names)
    assert any("deaver" in name for name in item_names)
    assert any("weitlaner" in name for name in item_names)
    assert any("bookwalter" in name for name in item_names)

    # Rongeurs & Elevators
    assert any("kerrison" in name for name in item_names)
    assert any("leksell" in name for name in item_names)
    assert any("pituitary" in name for name in item_names)
    assert any("cobb" in name for name in item_names)
    assert any("freer" in name for name in item_names)

    # Sponges & Suctions
    assert any("kittner" in name for name in item_names)
    assert any("ray-tec" in name for name in item_names)
    assert any("yankauer" in name for name in item_names)
    assert any("frazier" in name for name in item_names)
    assert any("poole" in name for name in item_names)
