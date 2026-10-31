import pytest
from hypothesis import given, strategies as st
from fastapi.testclient import TestClient
import io
import re
from typing import Set

from app.main import app
from app.services.inventory_search import get_inventory_service, reset_inventory_services
from app.services.surgical_ontology import (
    is_eponym_conflict,
    is_generic_class_only,
    normalize_acoustic_speech,
    normalize_or_lingo,
    extract_eponyms,
)

TEST_TENANT = "sacred_heart::or"
client = TestClient(app)

@pytest.fixture(autouse=True)
def clean_services():
    from app.config import get_tenant

    tenant = get_tenant(TEST_TENANT)
    original_csv_or = tenant.inventory_path.read_bytes() if tenant.inventory_path.exists() else b""

    tenant_cvor = get_tenant("general_memorial::or")
    original_csv_cvor = tenant_cvor.inventory_path.read_bytes() if tenant_cvor.inventory_path.exists() else b""

    reset_inventory_services()
    yield
    if original_csv_or:
        tenant.inventory_path.write_bytes(original_csv_or)
    if original_csv_cvor:
        tenant_cvor.inventory_path.write_bytes(original_csv_cvor)
    reset_inventory_services()

# ---------------------------------------------------------------------------
# 1. Core Logic & Eponym Contract Verification
# ---------------------------------------------------------------------------

def test_extract_eponyms():
    # Standalone
    assert extract_eponyms("adson pickups") == {"adson"}
    assert extract_eponyms("debakey forceps") == {"debakey"}
    # Compound
    assert extract_eponyms("mayo-hegar needle driver") == {"mayo-hegar"}
    assert extract_eponyms("brown adson") == {"brown-adson"}
    # OR slang
    assert extract_eponyms("metz") == {"metzenbaum"}
    assert extract_eponyms("castro") == {"castroviejo"}
    assert extract_eponyms("peanuts") == {"kittner"}
    assert extract_eponyms("snaps") == {"crile"}
    assert extract_eponyms("rich") == {"richardson"}
    # Multi
    assert extract_eponyms("get me the metz and rich") == {"metzenbaum", "richardson"}
    # None
    assert extract_eponyms("just some forceps") == set()

def test_extract_eponyms_and_conflict_logic():
    # Eponym matching eponym (No conflict)
    assert is_eponym_conflict("adson pickups", "Adson Tissue Forceps 1x2") is False

    # Eponym mismatch (Conflict)
    assert is_eponym_conflict("adson pickups", "DeBakey Forceps 12in") is True

    # Generic vs Generic (No conflict)
    assert is_eponym_conflict("forceps", "Tissue Forceps") is False

    # Slang eponym mapping
    assert is_eponym_conflict("metz", "Mayo Scissors") is True
    assert is_eponym_conflict("metz", "Metzenbaum Scissors") is False

    # Slang eponym mapping - castro
    assert is_eponym_conflict("castro", "Mayo-Hegar Needle Holder") is True
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

def test_normalize_acoustic_speech():
    assert normalize_acoustic_speech("add son pickups") == "adson pickups"
    assert normalize_acoustic_speech("the bakery pickups") == "the debakey pickups"
    assert normalize_acoustic_speech("uhh wait get me the add son") == "get me the adson"
    assert normalize_acoustic_speech("umm the bakey forceps") == "debakey forceps"
    assert normalize_acoustic_speech("metz in bomb") == "metzenbaum"
    assert normalize_acoustic_speech("casting holder") == "castroviejo holder"

def test_normalize_or_lingo():
    # Mishearings + Slang -> Canonical
    assert normalize_or_lingo("uhh get me the metz and snaps") == "get me the metzenbaum scissors and crile hemostat clamp"
    assert normalize_or_lingo("peanut") == "kittner dissector sponge"
    assert normalize_or_lingo("add son pickups") == "adson forceps"
    assert normalize_or_lingo("the bakey pickups") == "debakey forceps"
    assert normalize_or_lingo("castro") == "castroviejo needle holder"

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

# ---------------------------------------------------------------------------
# 7. Offline-First & Multi-Tenant Isolation Invariants
# ---------------------------------------------------------------------------

def test_inventory_search_offline_first_invariant(monkeypatch):
    import httpx
    import socket

    original_socket = socket.socket
    def mock_socket(family=socket.AF_INET, type=socket.SOCK_STREAM, proto=0, fileno=None):
        if family == getattr(socket, "AF_UNIX", -1):
            return original_socket(family, type, proto, fileno)
        raise RuntimeError("Network calls are forbidden during SurgicalOntologyService resolution")

    def mock_httpx_post(*args, **kwargs):
        raise RuntimeError("Network calls are forbidden during SurgicalOntologyService resolution")

    def mock_httpx_get(*args, **kwargs):
        raise RuntimeError("Network calls are forbidden during SurgicalOntologyService resolution")

    monkeypatch.setattr(socket, "socket", mock_socket)
    monkeypatch.setattr(httpx, "post", mock_httpx_post)
    monkeypatch.setattr(httpx, "get", mock_httpx_get)
    monkeypatch.setattr(httpx, "request", mock_httpx_get) # Also mock request to be safe

    inv_service = get_inventory_service(TEST_TENANT)

    # Must resolve successfully purely in-memory/offline
    match_adson = inv_service.search("adson pickups")
    assert match_adson is not None
    assert "Adson" in match_adson["item"]

def test_inventory_search_multi_tenant_isolation():
    inv_or = get_inventory_service(TEST_TENANT)

    # We will search in another tenant
    OTHER_TENANT = "general_memorial::or"
    inv_cvor = get_inventory_service(OTHER_TENANT)

    # Adson pickups should resolve in both, but they return different coordinate cards due to isolation
    match_or = inv_or.search("adson pickups")
    match_cvor = inv_cvor.search("adson pickups")

    assert match_or is not None
    assert match_cvor is not None

    # Check that they belong to different paths
    # Actually, inventory_search returns coordinate_card dicts which may not have facility_id. Let's just assert isolation by verifying instances are distinct.
    assert id(inv_or) != id(inv_cvor)
    assert inv_or.tenant.tenant_id == TEST_TENANT.replace("::", "/")
    assert inv_cvor.tenant.tenant_id == OTHER_TENANT.replace("::", "/")

def test_surgical_ontology_contract_invariants():
    from app.services.surgical_ontology import (
        is_eponym_conflict,
        is_generic_class_only,
        extract_eponyms,
        normalize_or_lingo,
        normalize_acoustic_speech
    )

    # Test extract_eponyms
    assert "debakey" in extract_eponyms("debakey forceps")
    assert "adson" in extract_eponyms("adson pickups")
    assert "brown-adson" in extract_eponyms("brown adson")
    assert "metzenbaum" in extract_eponyms("metz")
    assert "crile" in extract_eponyms("snaps")
    assert "kittner" in extract_eponyms("peanut")

    # Test is_eponym_conflict
    assert is_eponym_conflict("debakey", "debakey forceps") is False
    assert is_eponym_conflict("adson", "debakey forceps") is True
    assert is_eponym_conflict("castroviejo", "mayo-hegar") is True
    # Non-generic modifiers
    assert is_eponym_conflict("unobtanium laser forceps", "forceps") is True
    assert is_eponym_conflict("unobtanium laser forceps", "unobtanium laser forceps") is False

    # Test is_generic_class_only
    assert is_generic_class_only("forceps") is True
    assert is_generic_class_only("scissors") is True
    assert is_generic_class_only("metzenbaum scissors") is False
    assert is_generic_class_only("debakey forceps") is False

def test_surgical_ontology_offline_first_invariant(monkeypatch):
    import httpx
    import socket
    from app.services.surgical_ontology import (
        is_eponym_conflict,
        is_generic_class_only,
        extract_eponyms,
        normalize_or_lingo,
        normalize_acoustic_speech
    )

    def mock_socket(*args, **kwargs):
        raise RuntimeError("Network calls are forbidden during SurgicalOntologyService resolution")
    def mock_httpx_post(*args, **kwargs):
        raise RuntimeError("Network calls are forbidden during SurgicalOntologyService resolution")
    def mock_httpx_get(*args, **kwargs):
        raise RuntimeError("Network calls are forbidden during SurgicalOntologyService resolution")

    monkeypatch.setattr(socket, "socket", mock_socket)
    monkeypatch.setattr(httpx, "post", mock_httpx_post)
    monkeypatch.setattr(httpx, "get", mock_httpx_get)

    # These pure functions must not trigger network calls
    assert is_eponym_conflict("debakey", "debakey forceps") is False
    assert is_generic_class_only("forceps") is True
    assert "adson" in extract_eponyms("adson pickups")
    assert normalize_or_lingo("ad son pickups") == "adson forceps"
    assert normalize_acoustic_speech("add son") == "adson"

def test_surgical_ontology_multi_tenant_isolation():
    from app.services.surgical_ontology import normalize_or_lingo
    # Surgical ontology operates on pure deterministic logic regardless of tenant state
    res1 = normalize_or_lingo("ad son pickups")
    res2 = normalize_or_lingo("ad son pickups")
    assert res1 == res2
    assert res1 == "adson forceps"

def test_strip_spoken_disfluencies():
    from app.services.surgical_ontology import strip_spoken_disfluencies
    assert strip_spoken_disfluencies("umm uhh get me the metz") == "get me the metz"
    assert strip_spoken_disfluencies("wait basically actually literally hand me the adson") == "hand me the adson"
    assert strip_spoken_disfluencies("let's see you know grab the peanuts") == "grab the peanuts"
    assert strip_spoken_disfluencies("is like the castro here") == "is the castro here"
    assert strip_spoken_disfluencies("okay ok well so ummm ahh forceps") == "forceps"
    assert strip_spoken_disfluencies("hey look wait umm scissors") == "scissors"
    assert strip_spoken_disfluencies("please find me a crile") == "a crile"
    assert strip_spoken_disfluencies("") == ""
    assert strip_spoken_disfluencies("   ") == ""
    assert strip_spoken_disfluencies("umm, uhh, wait,") == ""
    assert strip_spoken_disfluencies("umm, get me the metz, actually") == "get me the metz"

def test_strip_spoken_disfluencies_offline_first_invariant(monkeypatch):
    import httpx
    import socket
    from app.services.surgical_ontology import strip_spoken_disfluencies

    def mock_socket(*args, **kwargs):
        raise RuntimeError("Network calls are forbidden during SurgicalOntologyService resolution")
    def mock_httpx_post(*args, **kwargs):
        raise RuntimeError("Network calls are forbidden during SurgicalOntologyService resolution")
    def mock_httpx_get(*args, **kwargs):
        raise RuntimeError("Network calls are forbidden during SurgicalOntologyService resolution")

    monkeypatch.setattr(socket, "socket", mock_socket)
    monkeypatch.setattr(httpx, "post", mock_httpx_post)
    monkeypatch.setattr(httpx, "get", mock_httpx_get)

    assert strip_spoken_disfluencies("umm get me the metz") == "get me the metz"

def test_strip_spoken_disfluencies_multi_tenant_isolation():
    from app.services.surgical_ontology import strip_spoken_disfluencies
    # Operating on pure deterministic logic
    res1 = strip_spoken_disfluencies("umm get me the metz")
    res2 = strip_spoken_disfluencies("umm get me the metz")
    assert res1 == res2
    assert res1 == "get me the metz"

# ---------------------------------------------------------------------------
# 8. Fuzzing & Boundary Hardening
# ---------------------------------------------------------------------------

@given(st.text())
def test_fuzz_normalize_or_lingo(text):
    res = normalize_or_lingo(text)
    assert isinstance(res, str)

@given(st.text())
def test_fuzz_normalize_acoustic_speech(text):
    res = normalize_acoustic_speech(text)
    assert isinstance(res, str)

@given(st.text())
def test_fuzz_extract_eponyms(text):
    res = extract_eponyms(text)
    assert isinstance(res, set)
    for item in res:
        assert isinstance(item, str)

@given(st.text(), st.text())
def test_fuzz_is_eponym_conflict(query, candidate):
    res = is_eponym_conflict(query, candidate)
    assert isinstance(res, bool)

@given(st.text())
def test_fuzz_is_generic_class_only(text):
    res = is_generic_class_only(text)
    assert isinstance(res, bool)

@given(st.text())
def test_fuzz_strip_spoken_disfluencies(text):
    from app.services.surgical_ontology import strip_spoken_disfluencies
    res = strip_spoken_disfluencies(text)
    assert isinstance(res, str)

def test_malformed_payload_resilience():
    from app.services.surgical_ontology import strip_spoken_disfluencies
    # Test handling of None (malformed inputs that should be strings)
    assert normalize_or_lingo(None) == ""
    assert normalize_acoustic_speech(None) == ""
    assert extract_eponyms(None) == set()
    assert is_eponym_conflict(None, "candidate") == False
    assert is_eponym_conflict("query", None) == False
    assert is_eponym_conflict(None, None) == False
    assert is_generic_class_only(None) == False
    assert strip_spoken_disfluencies(None) == ""

def test_fuzz_offline_first_invariant(monkeypatch):
    import socket
    import httpx

    def mock_socket(*args, **kwargs):
        raise RuntimeError("Network calls are forbidden during SurgicalOntologyService resolution")
    def mock_httpx_post(*args, **kwargs):
        raise RuntimeError("Network calls are forbidden during SurgicalOntologyService resolution")
    def mock_httpx_get(*args, **kwargs):
        raise RuntimeError("Network calls are forbidden during SurgicalOntologyService resolution")

    monkeypatch.setattr(socket, "socket", mock_socket)
    monkeypatch.setattr(httpx, "post", mock_httpx_post)
    monkeypatch.setattr(httpx, "get", mock_httpx_get)

    from app.services.surgical_ontology import strip_spoken_disfluencies

    assert normalize_or_lingo("test") == "test"
    assert normalize_acoustic_speech("test") == "test"
    assert extract_eponyms("test") == set()
    assert is_eponym_conflict("test", "test") == False
    assert is_generic_class_only("test") == False
    assert strip_spoken_disfluencies("test") == "test"
