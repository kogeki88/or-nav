"""
Phase 40 Test Suite: Multi-Clause Discourse Decomposer, Spoken Disfluency Filter & Packed Coordinate Parser.

Guarantees:
1. Spoken Disfluency Immunity: Natural hesitation words ('um', 'umm', 'uhh', 'like', 'er')
   are scrubbed and never trigger candidate vetoes.
2. Packed Coordinate Unpacking: 'or21c1f' -> 'OR 21 C 1 F', 'icu2b1' -> 'ICU 2 B 1', etc.
3. Multi-Clause Decomposition: Utterances with secondary clauses (e.g. ', theyre also called ribbon')
   cleanly decompose into clean item, unpacked coordinate, and learned aliases.
4. Compound Execution: POST /api/chat adds inventory item AND learns facility alias simultaneously.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.intent_parser import (
    parse_clinical_intent,
    extract_and_normalize_coordinate,
    ClinicalIntent,
)
from app.services.surgical_ontology import strip_spoken_disfluencies
from app.services.inventory_search import (
    get_inventory_service,
    reset_inventory_services,
    normalize_location_coordinate,
)
from app.services.lexicon_learning import (
    reset_facility_lexicons,
    get_facility_id_from_tenant,
    resolve_spoken_alias,
)


TEST_TENANT = "sacred_heart::or"


@pytest.fixture(autouse=True)
def clean_state():
    from app.config import get_tenant
    tenant = get_tenant(TEST_TENANT)
    original_csv = tenant.inventory_path.read_bytes() if tenant.inventory_path.exists() else b""
    reset_inventory_services()
    reset_facility_lexicons()
    yield
    if original_csv:
        tenant.inventory_path.write_bytes(original_csv)
    reset_inventory_services()
    reset_facility_lexicons()


client = TestClient(app)


# ---------------------------------------------------------------------------
# 1. Spoken Disfluency Filter Tests
# ---------------------------------------------------------------------------

def test_strip_spoken_disfluencies():
    assert strip_spoken_disfluencies("where is umm malleable") == "where is malleable"
    assert strip_spoken_disfluencies("uhh do we have a malleable") == "do we have a malleable"
    assert strip_spoken_disfluencies("find umm debakey") == "find debakey"
    assert strip_spoken_disfluencies("um uhh like where is umm malleable retractor") == "where is malleable retractor"
    assert strip_spoken_disfluencies("wait where is the debakey") == "where is the debakey"
    assert strip_spoken_disfluencies("so do we have malleable") == "do we have malleable"


def test_disfluency_search_immunity():
    inv = get_inventory_service(TEST_TENANT)

    # "where is umm malleable" previously failed because "umm" was treated as a required modifier
    res1 = inv.search("where is umm malleable")
    assert res1 is not None, "Failed to find malleable with disfluency 'umm'"
    assert "Malleable" in res1["item"]

    res2 = inv.search("uhh do we have a malleable")
    assert res2 is not None, "Failed to find malleable with disfluency 'uhh'"
    assert "Malleable" in res2["item"]

    res3 = inv.search("find umm debakey")
    assert res3 is not None
    assert "DeBakey" in res3["item"]


# ---------------------------------------------------------------------------
# 2. Packed Coordinate Parser Tests
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "raw_input,expected_loc",
    [
        ("or21c1f", "OR 21 C 1 F"),
        ("or4b2a", "OR 4 B 2 A"),
        ("icu2b1", "ICU 2 B 1"),
        ("er1c4", "ER 1 C 4"),
        ("pacu3a2", "PACU 3 A 2"),
        ("core1b2c", "Core Supply 1 B 2 C"),
        ("pump2a1", "Pump Room 2 A 1"),
        ("OR 21 C 1 F", "OR 21 C 1 F"),
    ],
)
def test_extract_and_normalize_coordinate(raw_input, expected_loc):
    loc, _ = extract_and_normalize_coordinate(raw_input)
    assert loc == expected_loc


def test_normalize_location_coordinate_packed():
    assert normalize_location_coordinate("or21c1f") == "OR 21 C 1 F"
    assert normalize_location_coordinate("or4b2a") == "OR 4 B 2 A"
    assert normalize_location_coordinate("icu2b1") == "ICU 2 B 1"


# ---------------------------------------------------------------------------
# 3. Multi-Clause Utterance Decomposition Tests
# ---------------------------------------------------------------------------

def test_multi_clause_add_exact_user_failure():
    # User failure utterance: "add malleable retractor to or21c1f, theyre also called ribbon"
    raw = "add malleable retractor to or21c1f, theyre also called ribbon"
    parsed = parse_clinical_intent(raw)

    assert parsed.intent == ClinicalIntent.MUTATE_INVENTORY
    assert parsed.entities.action == "add"
    assert parsed.entities.item.lower() == "malleable retractor"
    assert parsed.entities.location == "OR 21 C 1 F"
    assert parsed.entities.learned_aliases == ["ribbon"]


def test_multi_clause_add_with_period():
    raw = "add malleable retractor to or21c1f. theyre also called ribbon"
    parsed = parse_clinical_intent(raw)

    assert parsed.intent == ClinicalIntent.MUTATE_INVENTORY
    assert parsed.entities.action == "add"
    assert parsed.entities.item.lower() == "malleable retractor"
    assert parsed.entities.location == "OR 21 C 1 F"
    assert parsed.entities.learned_aliases == ["ribbon"]


def test_multi_clause_clause_order_independence():
    # Clause order inverted: alias clause first, then location
    raw = "add malleable retractor, also called ribbon, to or21c1f"
    parsed = parse_clinical_intent(raw)

    assert parsed.intent == ClinicalIntent.MUTATE_INVENTORY
    assert parsed.entities.action == "add"
    assert parsed.entities.item.lower() == "malleable retractor"
    assert parsed.entities.location == "OR 21 C 1 F"
    assert parsed.entities.learned_aliases == ["ribbon"]


def test_multi_clause_with_notes():
    raw = "add vascular clamps to OR 21 B 1 A, notes: Dr House preferred"
    parsed = parse_clinical_intent(raw)

    assert parsed.intent == ClinicalIntent.MUTATE_INVENTORY
    assert parsed.entities.action == "add"
    assert parsed.entities.item.lower() == "vascular clamps"
    assert parsed.entities.location == "OR 21 B 1 A"
    assert parsed.entities.notes == "Dr House preferred"


# ---------------------------------------------------------------------------
# 4. Compound Execution via /api/chat End-to-End
# ---------------------------------------------------------------------------

def test_compound_add_and_learn_alias_chat_endpoint():
    payload = {
        "tenant_id": TEST_TENANT,
        "message": "add malleable copper retractor to or21c1f, theyre also called ribbon copper",
        "clinical_role": "Surgical Technologist",
    }
    resp = client.post("/api/chat", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    assert data["routing_tier"] == "TIER_1_LOCAL_CSV"
    assert "✓ Added Malleable Copper Retractor to inventory at OR 21 C 1 F." in data["reply_text"]
    assert "Also learned facility alias" in data["reply_text"]
    assert "Ribbon Copper" in data["reply_text"]
    assert data["coordinate_card"]["full_code"] == "OR 21 C 1 F"

    # Verify inventory item exists at OR 21 C 1 F
    inv = get_inventory_service(TEST_TENANT)
    found_item = inv.search("malleable copper retractor")
    assert found_item is not None
    assert found_item["full_code"] == "OR 21 C 1 F"

    # Verify facility alias was learned and resolves to the added item
    facility_id, _ = get_facility_id_from_tenant(TEST_TENANT)
    resolved = resolve_spoken_alias(facility_id, "ribbon copper")
    assert resolved is not None
    assert resolved["canonicalItemName"] == "Malleable Copper Retractor"

    # Verify searching by the learned alias now retrieves the item!
    alias_search_resp = client.post(
        "/api/chat",
        json={"tenant_id": TEST_TENANT, "message": "where is ribbon copper"},
    )
    assert alias_search_resp.status_code == 200
    as_data = alias_search_resp.json()
    assert as_data["coordinate_card"] is not None
    assert as_data["coordinate_card"]["full_code"] == "OR 21 C 1 F"


def test_quick_add_prefills_notes_when_location_omitted():
    payload = {
        "tenant_id": TEST_TENANT,
        "message": "add malleable retractor, theyre also called ribbon",
        "clinical_role": "Surgical Technologist",
    }
    resp = client.post("/api/chat", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    assert data["quick_add_widget"] is not None
    assert data["quick_add_widget"]["item"].lower() == "malleable retractor"
    assert "Also called: ribbon" in data["quick_add_widget"]["notes"]
