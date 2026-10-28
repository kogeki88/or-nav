"""
Phase 37 Master Verification Suite: Semantic Intent & Slot-Parsing Router + Biased Clinical Listening Normalizer.

Covers:
1. Spoken voice normalization & phonetic correction ("four oh viker" -> "4-0 vicryl", "the bakery" -> "debakey", etc.)
2. Intent & slot extraction (FIND_INVENTORY, VIEW_PREFERENCE_CARD, MUTATE_INVENTORY, PEER_BROADCAST, GENERAL_QUERY)
3. Conversational inventory addition with coordinates (auto-adds item, saves CSV, returns CoordinateCard)
4. Conversational inventory addition without coordinates (returns QuickAddWidget prompt)
5. Suture gauge disambiguation chips for unspecified gauge queries ("Where is Vicryl?")
6. Voice transcript transparency pill ("🎙️ Recognized: 4-0 Vicryl")
7. Uncut markdown guides & preference card response validation (zero [:600] / [:650] truncations)
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.intent_parser import (
    ClinicalIntent,
    parse_clinical_intent,
    normalize_clinical_speech,
)
from app.services.inventory_search import get_inventory_service, reset_inventory_services
from app.services.rag_fallback import get_rag_service, reset_rag_services

client = TestClient(app)
TEST_TENANT = "sacred_heart::or"


@pytest.fixture(autouse=True)
def clean_services():
    from app.config import get_tenant
    tenant = get_tenant(TEST_TENANT)
    original_csv = tenant.inventory_path.read_bytes() if tenant.inventory_path.exists() else None
    reset_inventory_services()
    reset_rag_services()
    yield
    if original_csv is not None:
        tenant.inventory_path.write_bytes(original_csv)
    reset_inventory_services()
    reset_rag_services()


# ---------------------------------------------------------------------------
# 1. Spoken Voice Normalization & Phonetic Biasing Tests
# ---------------------------------------------------------------------------

def test_spoken_voice_speech_biasing_normalization():
    # Suture gauge conversions
    norm1, corr1 = normalize_clinical_speech("four oh viker")
    assert "4-0" in norm1
    assert "vicryl" in norm1
    assert corr1 is not None and "4-0 vicryl" in corr1.lower()

    norm2, corr2 = normalize_clinical_speech("four zero vicryl")
    assert "4-0" in norm2
    assert "vicryl" in norm2

    norm3, corr3 = normalize_clinical_speech("two oh prolene")
    assert "2-0" in norm3
    assert "prolene" in norm3

    norm4, corr4 = normalize_clinical_speech("the bakery forceps")
    assert "debakey" in norm4

    norm5, corr5 = normalize_clinical_speech("proline thirty")
    assert "3-0 prolene" in norm5

    norm6, corr6 = normalize_clinical_speech("white laner")
    assert "weitlaner" in norm6

    norm7, corr7 = normalize_clinical_speech("heprin")
    assert "heparin" in norm7


# ---------------------------------------------------------------------------
# 2. Intent & Slot Extraction Tests
# ---------------------------------------------------------------------------

def test_intent_classification():
    # FIND_INVENTORY
    res1 = parse_clinical_intent("Where can I grab 4-0 Vicryl?")
    assert res1.intent == ClinicalIntent.FIND_INVENTORY
    assert res1.entities.gauge == "4-0"
    assert "vicryl" in (res1.entities.item or "").lower()

    # VIEW_PREFERENCE_CARD
    res2 = parse_clinical_intent("Pull up Dr. Chen's Lap Chole preferences")
    assert res2.intent == ClinicalIntent.VIEW_PREFERENCE_CARD
    assert res2.entities.surgeon == "Dr. Chen"
    assert res2.entities.procedure == "lap chole"

    # MUTATE_INVENTORY (Add with location)
    res3 = parse_clinical_intent("Add open heart tray to rack 4 shelf A")
    assert res3.intent == ClinicalIntent.MUTATE_INVENTORY
    assert res3.entities.action == "add"
    assert "open heart tray" in (res3.entities.item or "").lower()
    assert res3.entities.location is not None

    # MUTATE_INVENTORY (Add without location)
    res4 = parse_clinical_intent("can you add open heart tray to the list")
    assert res4.intent == ClinicalIntent.MUTATE_INVENTORY
    assert res4.entities.action == "add"
    assert "open heart tray" in (res4.entities.item or "").lower()
    assert res4.entities.location is None

    # MUTATE_INVENTORY (Move)
    res5 = parse_clinical_intent("The 3-0 silk moved to OR 21 B 1 A")
    assert res5.intent == ClinicalIntent.MUTATE_INVENTORY
    assert res5.entities.action == "move"
    assert "3-0 silk" in (res5.entities.item or "").lower()

    # PEER_BROADCAST
    res6 = parse_clinical_intent("Can someone tell me where the vascular clips are?")
    assert res6.intent == ClinicalIntent.PEER_BROADCAST

    # GENERAL_QUERY
    res7 = parse_clinical_intent("What is the surgical safety time out protocol?")
    assert res7.intent == ClinicalIntent.GENERAL_QUERY


# ---------------------------------------------------------------------------
# 3. Conversational Add Item with Coordinates API Test
# ---------------------------------------------------------------------------

def test_conversational_add_item_with_location_api():
    # 1. Ask chat to add item with explicit coordinate
    payload = {
        "message": "Add test aortic clamp to OR 21 B 1 A",
        "tenant_id": TEST_TENANT,
    }
    resp = client.post("/api/chat", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    assert data["routing_tier"] == "TIER_1_LOCAL_CSV"
    assert "Added" in data["reply_text"]
    assert data["coordinate_card"] is not None
    assert "Test Aortic Clamp" in data["coordinate_card"]["item"]
    assert "OR 21 B 1 A" in data["coordinate_card"]["full_code"]

    # 2. Immediately search for the added item
    search_resp = client.post("/api/chat", json={
        "message": "where is test aortic clamp",
        "tenant_id": TEST_TENANT,
    })
    assert search_resp.status_code == 200
    search_data = search_resp.json()
    assert search_data["coordinate_card"] is not None
    assert "Test Aortic Clamp" in search_data["coordinate_card"]["item"]


# ---------------------------------------------------------------------------
# 4. Conversational Add Item without Coordinates API Test
# ---------------------------------------------------------------------------

def test_conversational_add_item_without_location_api():
    payload = {
        "message": "can you add vascular clip applier to the list",
        "tenant_id": TEST_TENANT,
    }
    resp = client.post("/api/chat", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    assert data["routing_tier"] == "TIER_1_LOCAL_CSV"
    assert "What location" in data["reply_text"] or "specify where" in data["reply_text"]
    assert data["quick_add_widget"] is not None
    assert "vascular clip applier" in data["quick_add_widget"]["item"].lower()


# ---------------------------------------------------------------------------
# 5. Suture Gauge Disambiguation Chips Test
# ---------------------------------------------------------------------------

def test_suture_gauge_disambiguation_chips():
    payload = {
        "message": "Where is Vicryl?",
        "tenant_id": TEST_TENANT,
    }
    resp = client.post("/api/chat", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    chips = data.get("disambiguation_chips", [])
    assert len(chips) >= 4
    assert "0" in chips
    assert "2-0" in chips
    assert "3-0" in chips
    assert "4-0" in chips


# ---------------------------------------------------------------------------
# 6. Voice Transcript Normalization Pill Test
# ---------------------------------------------------------------------------

def test_voice_normalization_pill_returned():
    payload = {
        "message": "where is four oh viker",
        "tenant_id": TEST_TENANT,
    }
    resp = client.post("/api/chat", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    correction = data.get("spoken_transcript_correction")
    assert correction is not None
    assert "4-0 vicryl" in correction.lower()


# ---------------------------------------------------------------------------
# 7. Uncut Markdown Guides & Preference Card Response Test
# ---------------------------------------------------------------------------

def test_uncut_markdown_responses():
    payload = {
        "message": "What is the surgical safety time out protocol?",
        "tenant_id": TEST_TENANT,
    }
    resp = client.post("/api/chat", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    reply = data["reply_text"]
    assert len(reply) > 50
    # Ensure artificial [:600] / [:650] truncations with trailing '...' were removed
    assert not reply.endswith("...")
