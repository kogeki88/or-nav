"""
Phase 19 Automated Test Suite: Third-Order Clinical Reality, Voice Self-Correction & Governance.

Covers:
    - Vector 1: Spoken Phonetic Coordinates in Move Reports ("or twenty one bee two see")
    - Vector 2: Voice Self-Correction & Negation Handling ("3-0 silk—wait no, 4-0 prolene")
    - Vector 3: Partial Compound Query Resolution ("1 Known Item + 1 Missing Item")
    - Vector 4: Generic Family Multi-Match ("Where is prolene?")
    - Vector 8: Idempotent Q&A Promotion & Deduplication
"""

import shutil
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.config import get_tenant
from app.services.inventory_search import (
    normalize_location_coordinate,
    preprocess_voice_query,
    split_compound_query,
    InventoryService,
    reset_inventory_services,
)
from app.services.governance import get_governance_service, reset_governance_services
from app.services.rag_fallback import reset_rag_services


@pytest.fixture(autouse=True)
def isolate_tenant_data():
    """Isolate and restore tenant inventory, orientation, and questions data."""
    tenant = get_tenant("general_memorial_cvor")
    inv_path = tenant.inventory_path
    orient_path = tenant.orientation_path
    q_path = inv_path.parent / "unanswered_questions.json"

    inv_bak = inv_path.with_suffix(".csv.phase19.bak")
    orient_bak = orient_path.with_suffix(".md.phase19.bak")
    q_bak = q_path.with_suffix(".json.phase19.bak")

    shutil.copyfile(inv_path, inv_bak)
    shutil.copyfile(orient_path, orient_bak)
    if q_path.exists():
        shutil.copyfile(q_path, q_bak)

    reset_inventory_services()
    reset_governance_services()
    reset_rag_services()
    yield
    shutil.copyfile(inv_bak, inv_path)
    shutil.copyfile(orient_bak, orient_path)
    if q_bak.exists():
        shutil.copyfile(q_bak, q_path)
        q_bak.unlink(missing_ok=True)
    inv_bak.unlink(missing_ok=True)
    orient_bak.unlink(missing_ok=True)
    reset_inventory_services()
    reset_governance_services()
    reset_rag_services()


# ===========================================================================
# Vector 1: Spoken Phonetic Coordinates in Move Reports
# ===========================================================================

def test_v1_spoken_phonetic_coordinates_normalization():
    # 1. Spoken room numbers and letter homophones
    assert normalize_location_coordinate("the 3-0 silk moved to or twenty one bee two see") == "OR 21 B 2 C"
    assert normalize_location_coordinate("or twenty one bee two see") == "OR 21 B 2 C"

    # 2. Natural phrasing with words
    assert normalize_location_coordinate("room twenty one cab dee shelf three bin eh") == "OR 21 D 3 A"

    # 3. Homophones in standard slots
    assert normalize_location_coordinate("or 21 be 1 sea") == "OR 21 B 1 C"

    # 4. Command parser integration
    cmd = InventoryService.parse_move_command("the 3-0 silk moved to or twenty one bee two see")
    assert cmd is not None
    assert cmd[0] == "3-0 silk"
    assert cmd[1] == "OR 21 B 2 C"


# ===========================================================================
# Vector 2: Voice Self-Correction & Negation Handling
# ===========================================================================

def test_v2_voice_self_correction_preprocessor():
    # 1. Mid-sentence correction pivots
    assert preprocess_voice_query("Where is 3-0 silk wait no 4-0 prolene") == "4-0 prolene"
    assert preprocess_voice_query("Find 2-0 prolene sorry I meant 3-0 silk") == "3-0 silk"
    assert preprocess_voice_query("Where is 2-0 silk actually no 10 blade") == "10 blade"
    assert preprocess_voice_query("need 3-0 silk scratch that 4-0 prolene") == "4-0 prolene"

    # 2. Trailing negation stripping
    assert preprocess_voice_query("Where is 4-0 prolene not 3-0") == "Where is 4-0 prolene"
    assert preprocess_voice_query("Find 3-0 silk instead of 2-0") == "Find 3-0 silk"
    assert preprocess_voice_query("Find 2-0 prolene rather than silk") == "Find 2-0 prolene"


def test_v2_voice_self_correction_in_chat():
    client = TestClient(app)
    # Query with self-correction should resolve to the corrected item (4-0 Prolene)
    resp = client.post(
        "/api/chat",
        json={"message": "Where is 3-0 silk wait no 4-0 prolene", "tenant_id": "general_memorial_cvor"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["routing_tier"] == "TIER_1_LOCAL_CSV"
    assert data["coordinate_card"]["item"] == "4-0 Prolene Suture"


# ===========================================================================
# Vector 3: Partial Compound Query Resolution
# ===========================================================================

def test_v3_partial_compound_query_resolution():
    client = TestClient(app)
    # Compound query where 3-0 silk exists, but 9-0 nylon does NOT exist in CVOR inventory
    resp = client.post(
        "/api/chat",
        json={"message": "where is 3-0 silk and 9-0 nylon", "tenant_id": "general_memorial_cvor"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["routing_tier"] == "TIER_1_LOCAL_CSV"
    assert "coordinate_cards" in data
    assert len(data["coordinate_cards"]) == 1
    assert data["coordinate_cards"][0]["item"] == "3-0 Silk Suture"
    assert "Could not find '9-0 nylon' in local inventory" in data["reply_text"]


# ===========================================================================
# Vector 4: Generic Family Multi-Match
# ===========================================================================

def test_v4_generic_family_multi_match():
    client = TestClient(app)

    # Broad family query "where is prolene" has no gauge specified
    resp = client.post(
        "/api/chat",
        json={"message": "where is prolene", "tenant_id": "general_memorial_cvor"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["routing_tier"] == "TIER_1_LOCAL_CSV"
    assert "coordinate_cards" in data
    items = [c["item"] for c in data["coordinate_cards"]]
    # Should return multiple Prolene items
    assert len(items) >= 2
    assert "2-0 Prolene Suture" in items
    assert "4-0 Prolene Suture" in items

    # Specific gauge query returns ONLY the single requested size
    resp_spec = client.post(
        "/api/chat",
        json={"message": "where is 2-0 prolene", "tenant_id": "general_memorial_cvor"},
    )
    assert resp_spec.status_code == 200
    data_spec = resp_spec.json()
    assert data_spec["coordinate_card"]["item"] == "2-0 Prolene Suture"
    assert len(data_spec.get("coordinate_cards") or [1]) == 1


# ===========================================================================
# Vector 8: Idempotent Q&A Promotion & Deduplication
# ===========================================================================

def test_v8_question_deduplication():
    gov = get_governance_service("general_memorial_cvor")
    q1 = gov.create_question("Where are the extra sternal closure wires?", "CVOR RN")
    q2 = gov.create_question("where are the extra sternal closure wires", "CVOR RN")
    assert q1["id"] == q2["id"]
    assert len([q for q in gov.list_questions() if q["id"] == q1["id"]]) == 1


def test_v8_idempotent_qna_promotion():
    gov = get_governance_service("general_memorial_cvor")
    q = gov.create_question("How is the arterial line transducer leveled for sternotomy?", "CVOR RN")
    gov.answer_question(q["id"], "Level to the phlebostatic axis (4th intercostal space, mid-axillary line).", confidence="confident")

    # Promote once
    gov.answer_question(q["id"], promote_to_verified=True)
    orient_text1 = gov.tenant.orientation_path.read_text(encoding="utf-8")
    count1 = orient_text1.count("How is the arterial line transducer leveled")
    assert count1 == 1

    # Promote second time (e.g. repeated click / another nurse clicks)
    gov.answer_question(q["id"], promote_to_verified=True)
    orient_text2 = gov.tenant.orientation_path.read_text(encoding="utf-8")
    count2 = orient_text2.count("How is the arterial line transducer leveled")
    assert count2 == 1  # Did NOT duplicate!
