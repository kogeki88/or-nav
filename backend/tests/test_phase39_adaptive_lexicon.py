"""
Phase 39 Test Suite: 2-Tier Adaptive Facility Lexicon & Implicit Learning Engine.

Verifies:
1. Personal term preservation: Querying "adson pickups" preserves "Adson Pickups"
   as the user's preferred term (does NOT rewrite voice badge to "adson forceps")
   and returns the exact Adson coordinate card.
2. Cross-user facility slang propagation: Teaching "Here we call Mixter clamps Geminis"
   allows User B at Sacred Heart to query "where is the gemini" and immediately find Mixter clamp.
3. Multi-alias mapping: "Gemini", "Right Angle", and "Mixter" all map to the exact same item.
4. Facility isolation: Slang taught at Sacred Heart does NOT leak to County General.
5. Automatic confidence upgrade: Promotes to "facility_consensus" when count >= 2 or users >= 2.
6. REST API: GET /api/lexicon and POST /api/lexicon/learn.
7. $0 LLM cost, deterministic execution.
"""

import uuid
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.inventory_search import get_inventory_service
from app.services.lexicon_learning import (
    load_facility_lexicon,
    learn_alias,
    resolve_spoken_alias,
    get_all_aliases_for_item,
    detect_teaching_intent,
)
from app.intent_parser import parse_clinical_intent, ClinicalIntent

client = TestClient(app)


def test_personal_term_preservation_adson_pickups():
    """
    Verify querying 'adson pickups' returns the Adson card titled with
    user preferred term 'Adson Pickups', and does not overwrite voice badge.
    """
    res = client.post(
        "/api/chat",
        json={
            "message": "where are the adson pickups",
            "tenant_id": "sacred_heart::or",
            "facility_name": "Sacred Heart Hospital",
            "clinical_role": "Scrub Tech",
            "user_id": "sean@sacredheart.org",
        },
    )
    assert res.status_code == 200
    data = res.json()

    card = data.get("coordinate_card")
    assert card is not None, "Must return coordinate card for adson pickups"
    assert "Adson" in card["item"]
    assert card["user_preferred_term"] == "Adson Pickups"
    assert "Adson Pickups" in data["reply_text"]
    # Verify voice badge is NOT forced to "forceps"
    assert data.get(
        "spoken_transcript_correction") is None or "forceps" not in data["spoken_transcript_correction"].lower()


def test_conversational_teaching_intent_detection():
    """Verify teaching phrases are parsed as ClinicalIntent.TEACH_ALIAS."""
    intent1 = parse_clinical_intent("We call Adson forceps Adson pickups")
    assert intent1.intent == ClinicalIntent.TEACH_ALIAS
    assert intent1.entities.target_item.lower() == "adson forceps"
    assert intent1.entities.alias_term.lower() == "adson pickups"

    intent2 = parse_clinical_intent("Here we call Mixter clamps Geminis")
    assert intent2.intent == ClinicalIntent.TEACH_ALIAS
    assert "mixter" in intent2.entities.target_item.lower()
    assert "gemini" in intent2.entities.alias_term.lower()


def test_teach_facility_alias_chat_endpoint():
    """
    Verify teaching a local slang term via chat binds it for the whole facility,
    awards +5 XP, and returns confirmation card.
    """
    res = client.post(
        "/api/chat",
        json={
            "message": "Here we call Mixter clamps Geminis",
            "tenant_id": "sacred_heart::or",
            "facility_name": "Sacred Heart Hospital",
            "user_id": "turk@sacredheart.org",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert "Facility Lingo Learned" in data["reply_text"]
    assert "Geminis" in data["reply_text"] or "Gemini" in data["reply_text"]
    assert "Mixter" in data["reply_text"]
    assert data.get("teaching_card") is not None
    assert data["teaching_card"]["xp_awarded"] == 5


def test_cross_user_slang_propagation_and_multi_alias():
    """
    Verify that User B in the same facility can immediately query 'where is the gemini'
    and find the Mixter clamp, while another user can also query 'right angle'.
    """
    # User B queries "gemini"
    res = client.post(
        "/api/chat",
        json={
            "message": "where is the gemini",
            "tenant_id": "sacred_heart::or",
            "facility_name": "Sacred Heart Hospital",
            "user_id": "jd@sacredheart.org",
        },
    )
    assert res.status_code == 200
    data = res.json()
    card = data.get("coordinate_card")
    assert card is not None, "User B must find item using learned facility slang 'gemini'"
    assert "Mixter" in card["item"]
    assert card["user_preferred_term"] == "Gemini"
    assert "Gemini" in data["reply_text"]

    # User C queries "right angle"
    res_c = client.post(
        "/api/chat",
        json={
            "message": "where is the right angle",
            "tenant_id": "sacred_heart::or",
            "facility_name": "Sacred Heart Hospital",
            "user_id": "carla@sacredheart.org",
        },
    )
    assert res_c.status_code == 200
    data_c = res_c.json()
    card_c = data_c.get("coordinate_card")
    assert card_c is not None
    assert "Mixter" in card_c["item"]


def test_facility_isolation_no_slang_leakage():
    """
    Verify slang taught at Sacred Heart ('gemini') does NOT leak into County General.
    """
    res = client.post(
        "/api/chat",
        json={
            "message": "where is the gemini",
            "tenant_id": "county_general::or",
            "facility_name": "County General Hospital",
            "user_id": "carter@countygen.org",
        },
    )
    assert res.status_code == 200
    data = res.json()
    # At County General, 'gemini' is not a known alias, so it must NOT return Mixter clamp!
    if data.get("coordinate_card"):
        assert "Mixter" not in data["coordinate_card"]["item"]
    else:
        # Prompting quick-add or not found is expected
        assert data.get("quick_add_widget") is not None or "not currently stocked" in data["reply_text"]


def test_confidence_promotion_to_facility_consensus():
    """
    Verify alias upgrades to 'facility_consensus' when used by multiple clinicians.
    """
    unique_term = f"test ratchet clamp {uuid.uuid4().hex[:6]}"
    entry1 = learn_alias(
        facility_id="sacred_heart",
        department_id="or",
        spoken_term=unique_term,
        canonical_item="Mixter Right-Angle Clamp 7.5in",
        user_id="user_alpha@sacredheart.org",
    )
    assert entry1["confidence"] in ("personal", "facility_learned")
    assert entry1["usageCount"] == 1

    # Second user uses the term
    entry2 = learn_alias(
        facility_id="sacred_heart",
        department_id="or",
        spoken_term=unique_term,
        canonical_item="Mixter Right-Angle Clamp 7.5in",
        user_id="user_beta@sacredheart.org",
    )
    assert entry2["confidence"] == "facility_consensus"
    assert entry2["usageCount"] >= 2


def test_rest_api_lexicon_endpoints():
    """Verify GET /api/lexicon and POST /api/lexicon/learn."""
    # GET
    res = client.get("/api/lexicon?facility_id=sacred_heart")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["count"] >= 3
    assert any(a["spokenTerm"] == "adson pickups" for a in data["aliases"])

    # POST learn
    post_res = client.post(
        "/api/lexicon/learn",
        json={
            "facility_id": "sacred_heart",
            "department_id": "or",
            "spoken_term": "pillowcase",
            "canonical_item": "Mayo Stand Cover Reinforced Blue",
            "user_id": "laverne@sacredheart.org",
            "display_preferred_name": "Pillowcase",
        },
    )
    assert post_res.status_code == 200
    pdata = post_res.json()
    assert pdata["status"] == "ok"
    assert pdata["xp_awarded"] == 5
    assert pdata["entry"]["spokenTerm"] == "pillowcase"
