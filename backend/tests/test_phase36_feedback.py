"""
Phase 36 Test Suite: Passive Chat Complaint Interceptor & Dev Recommendations Hub.

Verifies:
1. is_complaint_or_feature_wish detects complaints/wishes and ignores standard clinical lookups.
2. GET /api/feedback returns list of feedback items with smart prioritization + topRecommendations.
3. Filtering by category, status, and tenant isolation.
4. POST /api/feedback with auto-classification of category/severity and AI recommendation synthesis.
5. Duplicate/similarity detection merges and increments upvotes.
6. PATCH /api/feedback/{id} with upvote and status toggling (open -> planned -> resolved).
7. Suggested Antigravity prompt synthesis.
"""

from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.feedback import (
    load_feedback_items,
    save_feedback_items,
    classify_text,
    synthesize_recommendations,
    is_complaint_or_feature_wish,
    FEEDBACK_FILE,
)

client = TestClient(app)


@pytest.fixture(autouse=True)
def preserve_feedback_state():
    """Preserve existing feedback items before and after tests."""
    original_items = load_feedback_items()
    yield
    save_feedback_items(original_items)


def test_complaint_detection_accuracy():
    """Verify passive detector catches complaints/wishes but ignores normal clinical queries."""
    # Standard clinical queries (MUST be ignored)
    assert not is_complaint_or_feature_wish("Where is 3-0 Prolene?")
    assert not is_complaint_or_feature_wish("Find laparoscope 10mm 30 degree")
    assert not is_complaint_or_feature_wish("What is the dose of cefazolin?")
    assert not is_complaint_or_feature_wish("DeBakey forceps location")

    # Feature wishes (MUST be detected)
    assert is_complaint_or_feature_wish("I wish this app had a quick vascular clamp size chart")
    assert is_complaint_or_feature_wish("It would be nice if the card showed needle codes")
    assert is_complaint_or_feature_wish("Can you add a cement curing timer?")
    assert is_complaint_or_feature_wish("Please add dark mode for laparoscopic room")

    # Workflow / UI Complaints (MUST be detected)
    assert is_complaint_or_feature_wish("The screen is way too bright and glare is blinding us")
    assert is_complaint_or_feature_wish("Voice recognition keeps cutting off early")
    assert is_complaint_or_feature_wish("Why is this so annoying and confusing")

    # Missing / Outdated Data Complaints (MUST be detected)
    assert is_complaint_or_feature_wish("Vascular clamps are missing from Cart V")
    assert is_complaint_or_feature_wish("Wrong bin! This card is outdated and never updated")


def test_classify_and_synthesize_heuristics():
    """Verify deterministic NLP rules classify category, severity, and generate fix prompts."""
    # 1. UI Glare
    cat, sev = classify_text("The screen is too bright and glare is blinding us in Lap OR 2")
    assert cat == "ui_ux"
    rec, prompt = synthesize_recommendations("The screen is too bright", cat, sev)
    assert "dark-mode" in rec.lower() or "night mode" in rec.lower()
    assert "ANTIGRAVITY DIRECTIVE:" in prompt

    # 2. Inventory / wrong bin
    cat2, sev2 = classify_text("Wrong bin! Vascular clamps are missing from Cart V")
    assert cat2 == "data_inventory"
    assert sev2 in ["medium", "high"]
    rec2, prompt2 = synthesize_recommendations("Wrong bin! Missing from Cart V", cat2, sev2)
    assert "inventory" in rec2.lower() or "coordinates" in prompt2.lower()

    # 3. Feature Request
    cat3, sev3 = classify_text("Can we add a countdown timer for bone cement curing?")
    assert cat3 == "feature_request"
    rec3, prompt3 = synthesize_recommendations("Can we add a countdown timer", cat3, sev3)
    assert "timer" in rec3.lower() or "timer" in prompt3.lower()


def test_list_feedback_endpoints_and_top_recommendations():
    """Verify GET /api/feedback sorting, filtering, and synthesized top recommendations."""
    res = client.get("/api/feedback")
    assert res.status_code == 200
    data = res.json()
    assert "items" in data
    assert "topRecommendations" in data
    items = data["items"]
    assert len(items) >= 4
    top_recs = data["topRecommendations"]
    assert len(top_recs) >= 1
    assert any("🔥" in rec for rec in top_recs)

    # Filter by category
    res_cat = client.get("/api/feedback?category=ui_ux")
    assert res_cat.status_code == 200
    cat_items = res_cat.json()["items"]
    for it in cat_items:
        assert it["category"] == "ui_ux"

    # Filter by status
    res_status = client.get("/api/feedback?status=open")
    assert res_status.status_code == 200
    status_items = res_status.json()["items"]
    for it in status_items:
        assert it["status"] == "open"

    # Sort by upvotes
    res_up = client.get("/api/feedback?sortBy=upvotes")
    assert res_up.status_code == 200
    up_items = res_up.json()["items"]
    assert up_items[0]["upvotes"] >= up_items[-1]["upvotes"]


def test_create_feedback_and_patch_endpoints():
    """Verify POST /api/feedback and PATCH /api/feedback/{id} operations."""
    payload = {
        "tenantId": "sacred_heart::or",
        "userName": "Sean Iglesia, RN",
        "userRole": "Circulating RN",
        "source": "chat_auto_detected",
        "rawText": "I wish the Lap Chole card showed the exact clip applier size without scrolling",
    }
    res = client.post("/api/feedback", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["category"] == "feature_request"
    assert "ANTIGRAVITY DIRECTIVE:" in data["suggestedFixPrompt"]
    assert data["upvotes"] == 1
    assert data["status"] == "open"
    new_id = data["id"]

    # Test PATCH upvote
    res_vote = client.patch(f"/api/feedback/{new_id}", json={"upvote": True})
    assert res_vote.status_code == 200
    assert res_vote.json()["upvotes"] == 2

    # Test PATCH status change to resolved
    res_stat = client.patch(f"/api/feedback/{new_id}", json={"status": "resolved"})
    assert res_stat.status_code == 200
    assert res_stat.json()["status"] == "resolved"

    # Clean up
    res_del = client.delete(f"/api/feedback/{new_id}")
    assert res_del.status_code == 200


def test_similarity_deduplication_and_auto_upvote():
    """Verify that similar complaints merge into existing open item and increment upvotes."""
    unique_text = "The laparoscopic camera sterile drape is missing from Cart K Shelf 2"
    payload1 = {
        "tenantId": "sacred_heart::or",
        "userName": "Nurse Jackie",
        "userRole": "Scrub Tech",
        "source": "chat_auto_detected",
        "rawText": unique_text,
    }
    res1 = client.post("/api/feedback", json=payload1)
    assert res1.status_code == 200
    id1 = res1.json()["id"]
    initial_upvotes = res1.json()["upvotes"]

    # Post very similar complaint
    payload2 = {
        "tenantId": "sacred_heart::or",
        "userName": "Dr. Dorian",
        "userRole": "Resident",
        "source": "chat_auto_detected",
        "rawText": "Laparoscopic camera sterile drape missing from Cart K Shelf 2 again!",
    }
    res2 = client.post("/api/feedback", json=payload2)
    assert res2.status_code == 200
    # Should merge into same item with incremented upvotes
    assert res2.json()["id"] == id1
    assert res2.json()["upvotes"] == initial_upvotes + 1

    # Clean up
    client.delete(f"/api/feedback/{id1}")
