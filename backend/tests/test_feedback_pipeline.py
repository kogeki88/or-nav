import json
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.feedback import (
    load_feedback_items,
    save_feedback_items,
    is_similar,
)

client = TestClient(app)

@pytest.fixture(autouse=True)
def preserve_feedback_state(monkeypatch, tmp_path):
    """Preserve existing feedback items before and after tests."""
    test_file = tmp_path / "feedback.json"
    monkeypatch.setattr("app.feedback.FEEDBACK_FILE", test_file)

    # Load initial seed to test file
    from app.feedback import _get_default_seed
    initial_seed = _get_default_seed()
    test_file.write_text(json.dumps(initial_seed, indent=2, ensure_ascii=False), encoding="utf-8")

    yield
    # No need to restore, using tmp_path

def test_feedback_pipeline_multi_tenant_isolation():
    """Ensure multi-tenant isolation by asserting data parity with the specified tenant."""
    # List feedback for specific tenant
    res_sh = client.get("/api/feedback?tenantId=sacred_heart::or")
    assert res_sh.status_code == 200
    for item in res_sh.json()["items"]:
        assert item["tenantId"].startswith("sacred_heart")

    res_pp = client.get("/api/feedback?tenantId=princeton_plainsboro::or")
    assert res_pp.status_code == 200
    for item in res_pp.json()["items"]:
        assert item["tenantId"].startswith("princeton_plainsboro")

    res_cg = client.get("/api/feedback?tenantId=county_general::er")
    assert res_cg.status_code == 200
    for item in res_cg.json()["items"]:
        assert item["tenantId"].startswith("county_general")

def test_offline_first_invariants():
    """Ensure that the feedback pipeline operations maintain the offline-first data structure and constraints."""
    res = client.get("/api/feedback")
    assert res.status_code == 200
    data = res.json()
    assert "items" in data
    assert "topRecommendations" in data

    items = data["items"]
    assert isinstance(items, list)
    if items:
        # Check required fields
        item = items[0]
        assert "id" in item
        assert "tenantId" in item
        assert "userName" in item
        assert "userRole" in item
        assert "source" in item
        assert "category" in item
        assert "severity" in item
        assert "rawText" in item
        assert "aiRecommendation" in item
        assert "suggestedFixPrompt" in item
        assert "upvotes" in item
        assert "status" in item
        assert "createdAt" in item

    # Check that creating an item works
    payload = {
        "tenantId": "sacred_heart::or",
        "userName": "Sean",
        "userRole": "Nurse",
        "source": "manual_submission",
        "rawText": "Need a timer",
    }
    create_res = client.post("/api/feedback", json=payload)
    assert create_res.status_code == 200
    created_item = create_res.json()

    # Check it was persisted
    get_res = client.get("/api/feedback")
    assert any(it["id"] == created_item["id"] for it in get_res.json()["items"])

def test_similarity_deduplication():
    """Test duplicate similarity logic."""
    assert is_similar("This screen is too bright", "The screen is way too bright")
    assert not is_similar("This screen is too bright", "Where are the bandages")
