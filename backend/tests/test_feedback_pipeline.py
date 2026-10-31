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

def test_concurrent_burst_execution_and_latency():
    """Test race condition resistance and latency during a concurrent burst."""
    import time
    import concurrent.futures
    import random
    import string
    start_time = time.time()

    def worker(i):
        # Generate completely random words to defeat similarity deduplication
        rand_words = " ".join("".join(random.choices(string.ascii_lowercase, k=8)) for _ in range(5))
        payload = {
            "tenantId": f"burst_tenant_{i % 2}::or",
            "userName": f"User {i}",
            "userRole": "Nurse",
            "source": "manual_submission",
            "rawText": f"Unique {rand_words} {i}",
            "aiRecommendation": "Rec",
            "suggestedFixPrompt": "Prompt"
        }
        res = client.post("/api/feedback", json=payload)
        return res.status_code

    num_requests = 20
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        results = list(executor.map(worker, range(num_requests)))

    end_time = time.time()

    assert all(r == 200 for r in results)

    res_0 = client.get("/api/feedback?tenantId=burst_tenant_0::or")
    res_1 = client.get("/api/feedback?tenantId=burst_tenant_1::or")

    items_0 = res_0.json()["items"]
    items_1 = res_1.json()["items"]

    added_0 = [it for it in items_0 if "Unique" in it.get("rawText", "")]
    added_1 = [it for it in items_1 if "Unique" in it.get("rawText", "")]

    assert len(added_0) == 10
    assert len(added_1) == 10

    avg_latency = (end_time - start_time) / num_requests
    assert avg_latency < 0.05
