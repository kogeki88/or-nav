import json
import pytest
import httpx
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
    initial_sh_count = len(res_sh.json()["items"])
    for item in res_sh.json()["items"]:
        assert item["tenantId"].startswith("sacred_heart")

    res_pp = client.get("/api/feedback?tenantId=princeton_plainsboro::or")
    assert res_pp.status_code == 200
    initial_pp_count = len(res_pp.json()["items"])
    for item in res_pp.json()["items"]:
        assert item["tenantId"].startswith("princeton_plainsboro")

    # Create a new item for Sacred Heart to ensure it doesn't leak
    payload = {
        "tenantId": "sacred_heart::or",
        "rawText": "Isolated test complaint"
    }
    client.post("/api/feedback", json=payload)

    # Assert Sacred Heart count increased, PP count remained same
    res_sh_new = client.get("/api/feedback?tenantId=sacred_heart::or")
    assert len(res_sh_new.json()["items"]) == initial_sh_count + 1

    res_pp_new = client.get("/api/feedback?tenantId=princeton_plainsboro::or")
    assert len(res_pp_new.json()["items"]) == initial_pp_count

    res_cg = client.get("/api/feedback?tenantId=county_general::er")
    assert res_cg.status_code == 200
    for item in res_cg.json()["items"]:
        assert item["tenantId"].startswith("county_general")

    # Add a new item to sacred_heart::icu
    payload_icu = {
        "tenantId": "sacred_heart::icu",
        "rawText": "Isolated test complaint for ICU"
    }
    client.post("/api/feedback", json=payload_icu)

    # Assert Sacred Heart ICU item doesn't leak into Sacred Heart OR
    res_sh_or_final = client.get("/api/feedback?tenantId=sacred_heart::or")
    assert len(res_sh_or_final.json()["items"]) == initial_sh_count + 1

    res_sh_icu_final = client.get("/api/feedback?tenantId=sacred_heart::icu")
    # Only items with tenantId starting with sacred_heart::icu
    icu_items = [it for it in res_sh_icu_final.json()["items"] if it["tenantId"] == "sacred_heart::icu"]
    assert len(icu_items) == 1
    assert icu_items[0]["rawText"] == "Isolated test complaint for ICU"


def test_offline_first_invariants(monkeypatch):
    """Ensure that the feedback pipeline operations maintain the offline-first data structure and constraints."""
    def block_network(*args, **kwargs):
        raise RuntimeError("Network access is strictly forbidden in offline-first mode")

    monkeypatch.setattr(httpx, "get", block_network)
    monkeypatch.setattr(httpx, "post", block_network)
    monkeypatch.setattr(httpx, "request", block_network)

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

def test_fuzzing_and_boundary_conditions():
    """Fuzzing and boundary tests for malformed payload resilience and strict schema validation."""

    # 1. Missing required field 'rawText'
    res = client.post("/api/feedback", json={"tenantId": "sacred_heart::or"})
    assert res.status_code in [400, 422]

    # 2. Empty rawText
    res = client.post("/api/feedback", json={"rawText": "   "})
    assert res.status_code == 400

    # 3. Malformed payload type for rawText
    res = client.post("/api/feedback", json={"rawText": {"object": "instead_of_string"}})
    assert res.status_code == 422

    # 4. Very long rawText (boundary)
    long_text = "A" * 10000
    res = client.post("/api/feedback", json={"rawText": long_text})
    assert res.status_code == 200
    assert res.json()["rawText"] == long_text

    # 5. Invalid status transition
    res = client.patch(f"/api/feedback/{res.json()['id']}/status", json={"status": "invalid_status"})
    assert res.status_code == 400

    # 6. Random non-existent endpoint or malformed id
    res = client.patch("/api/feedback/non_existent_id_123/status", json={"status": "resolved"})
    assert res.status_code == 404

def test_offline_mutation_replay_idempotency(monkeypatch):
    """Ensure offline mutation replay idempotency."""
    def block_network(*args, **kwargs):
        raise RuntimeError("Network access is strictly forbidden in offline-first mode")

    monkeypatch.setattr(httpx, "get", block_network)
    monkeypatch.setattr(httpx, "post", block_network)
    monkeypatch.setattr(httpx, "request", block_network)

    payload = {
        "tenantId": "sacred_heart::or",
        "userName": "Sean",
        "userRole": "Nurse",
        "source": "manual_submission",
        "rawText": "Need a timer idempotency check",
    }

    # 1. First execution
    res1 = client.post("/api/feedback", json=payload)
    assert res1.status_code == 200

    # Get total count after first execution
    items_after_first = client.get("/api/feedback").json()["items"]
    count_after_first = len(items_after_first)

    # 2. Second execution (replay)
    res2 = client.post("/api/feedback", json=payload)
    assert res2.status_code == 200

    # Check that deduplication happened: count stays the same
    items_after_second = client.get("/api/feedback").json()["items"]
    assert len(items_after_second) == count_after_first

    # 3. Third execution (replay)
    res3 = client.post("/api/feedback", json=payload)
    assert res3.status_code == 200

    items_after_third = client.get("/api/feedback").json()["items"]
    assert len(items_after_third) == count_after_first

    # Assert upvotes incremented correctly because of is_similar merging
    target_item = next(it for it in items_after_third if it["rawText"] == "Need a timer idempotency check")
    assert target_item["upvotes"] >= 3
