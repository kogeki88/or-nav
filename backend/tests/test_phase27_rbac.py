"""
Phase 27.1 Role-Based Access Control (RBAC) & Note Filtering Test Suite.

Verifies:
1. Overall inventory coordinate lookups are accessible to ALL clinical roles.
2. Drug/medication/dosing protocols are restricted for Scrub Tech and accessible to RN & CRNA.
3. Surgical tray, instrument setups, and suture loading preferences are filtered for CRNA and accessible to Scrub Tech & Circulator.
4. Surgeon notes on coordinate cards dynamically strip suture loading notes for CRNA and drug dosing notes for Scrub Tech.
5. Compound queries respect RBAC on the procedural segment while returning item coordinates.
6. Orientation guide sections with [ROLE: ...] tags are correctly filtered per role.

Fast execution: 100% deterministic, zero external live LLM calls, <1s execution.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.rag_fallback import (
    filter_orientation_by_role,
    filter_surgeon_note_for_role,
    evaluate_rbac,
    is_anesthesia_role,
    is_scrub_role,
    is_nursing_role,
)

client = TestClient(app)


@pytest.fixture(autouse=True)
def zero_token_offline_mode(monkeypatch):
    """Ensure tests run strictly offline with $0 token usage in <1s."""
    monkeypatch.setenv("GEMINI_API_KEY", "")
    yield


def test_role_classification_helpers():
    """Verify role classifiers accurately identify role families."""
    assert is_anesthesia_role("CRNA") is True
    assert is_anesthesia_role("Anesthesia Provider") is True
    assert is_anesthesia_role("Circulating RN") is False
    assert is_anesthesia_role("Scrub Tech") is False

    assert is_scrub_role("Scrub Tech") is True
    assert is_scrub_role("Scrub Nurse / CST") is True
    assert is_scrub_role("CRNA") is False
    assert is_scrub_role("Circulating RN") is False

    assert is_nursing_role("Circulating RN") is True
    assert is_nursing_role("ICU RN") is True
    assert is_nursing_role("ER RN") is True
    assert is_nursing_role("PACU RN") is True
    assert is_nursing_role("Charge RN") is True
    assert is_nursing_role("Scrub Tech") is False


def test_inventory_locations_accessible_to_all_roles():
    """Rule 1: Overall Inventory Locations are accessible to ALL roles."""
    roles = ["Circulating RN", "Scrub Tech", "CRNA", "ICU RN", "ER RN", "PACU RN"]
    queries = ["Where is 3-0 silk?", "Where is heparin?", "Where is debakey forceps?"]

    for role in roles:
        for q in queries:
            res = client.post(
                "/api/chat",
                json={
                    "message": q,
                    "tenant_id": "or_main",
                    "facility_name": "General Memorial Hospital",
                    "clinical_role": role,
                },
            )
            assert res.status_code == 200, f"Failed for {role} on {q}"
            data = res.json()
            assert data["routing_tier"] == "TIER_1_LOCAL_CSV"
            assert data["coordinate_card"] is not None
            assert data["coordinate_card"]["full_code"] != ""


def test_drug_dosing_protocols_restricted_for_scrub_tech():
    """Rule 2: Drug dosing / mixing / drips restricted for Scrub Tech."""
    drug_queries = [
        "What is the heparin dose for bypass?",
        "How do you mix Dantrolene?",
        "What is the protamine dose ratio?",
        "What is the levophed drip titration protocol?",
    ]

    # Scrub Tech must be blocked
    for q in drug_queries:
        res = client.post(
            "/api/chat",
            json={
                "message": q,
                "tenant_id": "or_main",
                "facility_name": "General Memorial Hospital",
                "clinical_role": "Scrub Tech",
            },
        )
        assert res.status_code == 200
        data = res.json()
        assert data["routing_tier"] == "RBAC_RESTRICTED"
        assert (
            data["reply_text"]
            == "Medication & dosing protocols are restricted to Nursing / Anesthesia roles."
        )

    # Nursing and Anesthesia must be allowed
    allowed_roles = ["Circulating RN", "CRNA", "ICU RN", "ER RN"]
    for role in allowed_roles:
        res = client.post(
            "/api/chat",
            json={
                "message": "What is the heparin dose for bypass?",
                "tenant_id": "or_main",
                "facility_name": "General Memorial Hospital",
                "clinical_role": role,
            },
        )
        assert res.status_code == 200
        data = res.json()
        assert data["routing_tier"] != "RBAC_RESTRICTED"
        assert "restricted" not in data["reply_text"].lower()


def test_instrument_and_suture_setups_filtered_for_crna():
    """Rule 3: Surgical tray & suture loading preferences filtered for Anesthesia."""
    tray_queries = [
        "What is the tray breakdown for vascular surgery?",
        "What is Dr. Patel's suture loading preference?",
        "What is the Mayo stand setup for laparoscopy?",
    ]

    # CRNA must be blocked
    for q in tray_queries:
        res = client.post(
            "/api/chat",
            json={
                "message": q,
                "tenant_id": "or_main",
                "facility_name": "General Memorial Hospital",
                "clinical_role": "CRNA",
            },
        )
        assert res.status_code == 200
        data = res.json()
        assert data["routing_tier"] == "RBAC_RESTRICTED"
        assert (
            data["reply_text"]
            == "Surgical tray and instrument setups are filtered for Anesthesia roles."
        )

    # Scrub Tech and Circulating RN must be allowed
    for role in ["Scrub Tech", "Circulating RN"]:
        res = client.post(
            "/api/chat",
            json={
                "message": "What is Dr. Patel's suture loading preference?",
                "tenant_id": "or_main",
                "facility_name": "General Memorial Hospital",
                "clinical_role": role,
            },
        )
        assert res.status_code == 200
        data = res.json()
        assert data["routing_tier"] != "RBAC_RESTRICTED"
        assert "filtered" not in data["reply_text"].lower()


def test_surgeon_note_filtering_on_coordinate_cards():
    """Rule 4: Suture loading notes stripped for CRNA; Drug dosing notes stripped for Scrub Tech."""
    # 1. 3-0 Silk has note: "Dr. Chen uses for venous cannulation tie-down; Dr. Patel prefers loaded on Debakey"
    res_crna = client.post(
        "/api/chat",
        json={
            "message": "Where is 3-0 silk for Dr. Patel?",
            "tenant_id": "or_main",
            "clinical_role": "CRNA",
        },
    )
    data_crna = res_crna.json()
    card_crna = data_crna["coordinate_card"]
    # CRNA must NOT see suture loading instructions ("loaded on Debakey")
    assert "loaded on" not in (card_crna["surgeon_notes"] or "").lower()
    assert card_crna.get("highlighted_surgeon_note") is None
    assert "loaded on" not in data_crna["reply_text"].lower()
    assert "Dr. Chen" in card_crna["surgeon_notes"]

    # Scrub Tech DOES see suture loading note
    res_scrub = client.post(
        "/api/chat",
        json={
            "message": "Where is 3-0 silk for Dr. Patel?",
            "tenant_id": "or_main",
            "clinical_role": "Scrub Tech",
        },
    )
    data_scrub = res_scrub.json()
    card_scrub = data_scrub["coordinate_card"]
    assert "loaded on debakey" in (card_scrub["highlighted_surgeon_note"] or "").lower()
    assert "loaded on debakey" in data_scrub["reply_text"].lower()

    # 2. Heparin has note: "Anesthesia draws; perfusion confirms ACT > 480 before cannulation. Refrigerated overflow in Pharmacy"
    res_scrub_hep = client.post(
        "/api/chat",
        json={
            "message": "Where is heparin?",
            "tenant_id": "or_main",
            "clinical_role": "Scrub Tech",
        },
    )
    data_scrub_hep = res_scrub_hep.json()
    card_scrub_hep = data_scrub_hep["coordinate_card"]
    # Scrub Tech must NOT see dosing / ACT target instructions
    assert "act > 480" not in (card_scrub_hep["surgeon_notes"] or "").lower()
    assert "anesthesia draws" not in (card_scrub_hep["surgeon_notes"] or "").lower()
    assert "Refrigerated overflow in Pharmacy" in card_scrub_hep["surgeon_notes"]

    # CRNA DOES see anesthesia administration / ACT notes
    res_crna_hep = client.post(
        "/api/chat",
        json={
            "message": "Where is heparin?",
            "tenant_id": "or_main",
            "clinical_role": "CRNA",
        },
    )
    data_crna_hep = res_crna_hep.json()
    card_crna_hep = data_crna_hep["coordinate_card"]
    assert "act > 480" in card_crna_hep["surgeon_notes"].lower()


def test_compound_query_with_rbac_enforcement():
    """Rule 5: Compound item + procedural query returns item card but restricts procedural portion."""
    # Scrub Tech queries item + drug dose
    res_scrub = client.post(
        "/api/chat",
        json={
            "message": "Where is bovie and what is the heparin dose?",
            "tenant_id": "or_main",
            "clinical_role": "Scrub Tech",
        },
    )
    assert res_scrub.status_code == 200
    data_scrub = res_scrub.json()
    assert data_scrub["routing_tier"] == "TIER_1_LOCAL_CSV"
    assert "Bovie" in data_scrub["coordinate_card"]["item"]
    # Procedural part must report RBAC restriction
    assert (
        "Medication & dosing protocols are restricted to Nursing / Anesthesia roles."
        in data_scrub["reply_text"]
    )

    # Circulating RN queries item + drug dose -> allowed
    res_rn = client.post(
        "/api/chat",
        json={
            "message": "Where is bovie and what is the heparin dose?",
            "tenant_id": "or_main",
            "clinical_role": "Circulating RN",
        },
    )
    assert res_rn.status_code == 200
    data_rn = res_rn.json()
    assert data_rn["routing_tier"] == "TIER_1_LOCAL_CSV"
    assert "Bovie" in data_rn["coordinate_card"]["item"]
    assert "restricted" not in data_rn["reply_text"].lower()


def test_orientation_sections_role_tag_filtering():
    """Rule 6: Orientation guide sections with [ROLE: ...] tags filtered by clinical role."""
    doc = (
        "# Unit Guide\n\n"
        "## General Rules\nGeneral info for all.\n\n"
        "## MH Crisis Protocol [ROLE: RN, CRNA]\nDantrolene 2.5mg/kg STAT.\n\n"
        "## Tray Setup & Mayo Stand [ROLE: CIRCULATOR, SCRUB]\nOrganize retractors.\n\n"
        "## Documentation & Specimen Count [ROLE: CIRCULATOR]\nDual RN signoff.\n"
    )

    # 1. Scrub Tech view: Excludes MH Crisis and Documentation
    scrub_view = filter_orientation_by_role(doc, "Scrub Tech")
    assert "General Rules" in scrub_view
    assert "Tray Setup & Mayo Stand" in scrub_view
    assert "MH Crisis Protocol" not in scrub_view
    assert "Documentation & Specimen Count" not in scrub_view

    # 2. CRNA view: Excludes Tray Setup and Documentation
    crna_view = filter_orientation_by_role(doc, "CRNA")
    assert "General Rules" in crna_view
    assert "MH Crisis Protocol" in crna_view
    assert "Tray Setup & Mayo Stand" not in crna_view
    assert "Documentation & Specimen Count" not in crna_view

    # 3. Circulating RN view: Includes everything
    circ_view = filter_orientation_by_role(doc, "Circulating RN")
    assert "General Rules" in circ_view
    assert "MH Crisis Protocol" in circ_view
    assert "Tray Setup & Mayo Stand" in circ_view
    assert "Documentation & Specimen Count" in circ_view
