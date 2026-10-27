import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from app.main import app
from app.services.inventory_search import (
    InventoryService,
    extract_gauge_and_specs,
    has_conflicting_specifications,
    split_compound_query,
)
from app.routers.chat import extract_surgeon_name, highlight_surgeon_note

client = TestClient(app)


def test_crack_a_metric_millimeter_vs_suture_gauge():
    """
    Crack A: Ensure decimal millimeter specs (e.g. 2.0mm) are extracted cleanly
    and NEVER confused with suture gauges (e.g. 2-0), and conflicting specs reject sutures.
    """
    mm_specs = extract_gauge_and_specs("2.0mm pruitt shunt")
    assert "2.0mm" in mm_specs["mm_sizes"]
    assert "2-0" not in mm_specs["suture_gauges"]
    assert len(mm_specs["suture_gauges"]) == 0

    suture_specs = extract_gauge_and_specs("2-0 prolene suture")
    assert "2-0" in suture_specs["suture_gauges"]
    assert len(suture_specs["mm_sizes"]) == 0

    # Shunt querying should conflict with suture inventory row
    suture_row = {
        "item": "2-0 Prolene Suture",
        "category": "Sutures",
        "aliases": "prolene",
        "surgeon_notes": "",
    }
    assert has_conflicting_specifications(mm_specs, suture_row) is True

    # Real inventory search lookup
    inv = InventoryService("general_memorial_cvor")
    card = inv.search("2.0mm shunt")
    assert card is not None
    assert "Pruitt" in card["item"] or "2.0mm" in card["item"]
    assert card["item"] != "2-0 Prolene Suture"


def test_crack_c_zero_suture_recognition():
    """
    Crack C: Ensure bare size 0 sutures ('0 silk', 'zero silk', 'aught silk')
    are extracted as size '0' and conflict with size 2-0 or 3-0 sutures.
    """
    for query in ("0 silk", "zero silk", "aught silk", "size 0 silk suture"):
        specs = extract_gauge_and_specs(query)
        assert "0" in specs["suture_gauges"], f"Failed on query: {query}"
        assert "3-0" not in specs["suture_gauges"]
        assert "2-0" not in specs["suture_gauges"]

    # Verify conflict with 3-0 Silk
    silk_30_row = {
        "item": "3-0 Silk Suture",
        "category": "Sutures",
        "aliases": "30 silk",
        "surgeon_notes": "",
    }
    zero_specs = extract_gauge_and_specs("where is zero silk")
    assert has_conflicting_specifications(zero_specs, silk_30_row) is True

    # Verify lookup finds 0 Silk Suture and NOT 3-0 Silk Suture
    inv = InventoryService("general_memorial_cvor")
    card = inv.search("0 silk")
    assert card is not None
    assert card["item"] == "0 Silk Suture"
    assert card["item"] != "3-0 Silk Suture"


def test_crack_d_surgeon_specific_note_highlighting():
    """
    Crack D: Extract surgeon mention from query, filter specific surgeon note,
    and attach highlighted callout to CoordinateCard response.
    """
    # 1. Regex & parsing helpers
    surgeon = extract_surgeon_name("Where is 3-0 silk for Dr. Patel?")
    assert surgeon == "Dr. Patel"

    notes = "Dr. Chen uses for venous cannulation tie-down; Dr. Patel prefers loaded on Debakey"
    highlighted = highlight_surgeon_note(surgeon, notes)
    assert highlighted is not None
    assert "Dr. Patel prefers loaded on Debakey" in highlighted
    assert "Dr. Chen" not in highlighted

    # 2. Integration via /api/chat
    resp = client.post(
        "/api/chat",
        json={"message": "Where is 3-0 silk for Dr. Patel?", "tenant_id": "general_memorial_cvor"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["routing_tier"] == "TIER_1_LOCAL_CSV"
    card = data["coordinate_card"]
    assert card is not None
    assert card["surgeon_filter"] == "Dr. Patel"
    assert "loaded on Debakey" in card["highlighted_surgeon_note"]
    assert "Dr. Patel" in data["reply_text"]


def test_crack_b_hybrid_compound_query_with_mocked_rag():
    """
    Crack B: Query with 1 inventory item + 1 clinical protocol question
    e.g. 'Where is 3-0 silk and what is our heparin ACT target?'
    returns the physical CoordinateCard AND the clinical protocol guidance in reply_text.
    """
    parts = split_compound_query("Where is 3-0 silk and what is our heparin ACT target?")
    assert len(parts) == 2
    assert "3-0 silk" in parts[0]
    assert "heparin" in parts[1]

    # Mock RAG call to guarantee $0 token cost and instant execution
    mock_rag_reply = "Per institutional CVOR protocol, heparin ACT must exceed 480 seconds prior to cannulation."
    with patch(
        "app.services.rag_fallback.RAGService.query_with_meta",
        new=AsyncMock(return_value=(mock_rag_reply, False)),
    ):
        resp = client.post(
            "/api/chat",
            json={
                "message": "Where is 3-0 silk and what is our heparin ACT target?",
                "tenant_id": "general_memorial_cvor",
            },
        )
        assert resp.status_code == 200
        data = resp.json()

        # Must return local CSV routing with CoordinateCard for 3-0 silk
        assert data["routing_tier"] == "TIER_1_LOCAL_CSV"
        assert data["coordinate_card"] is not None
        assert data["coordinate_card"]["item"] == "3-0 Silk Suture"

        # Must also contain clinical guidance in reply_text
        reply = data["reply_text"]
        assert "Found 3-0 Silk Suture" in reply
        assert "Clinical Guidance" in reply or "Protocol Guidance" in reply
        assert "ACT must exceed 480" in reply
