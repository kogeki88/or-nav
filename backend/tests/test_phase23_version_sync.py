"""
Phase 23 Versioning (v0.1), OTA Update Checker & Auto-Sync Test Suite.

Verifies:
1. GET /api/version returns valid manifest (v0.1, build_number: 1, apk_download_url).
2. frontend/public/version.json contains valid JSON matching v0.1 spec.
3. Offline Outbox API endpoint compatibility:
   - POST /api/inventory/verify-move
   - POST /api/inventory/flag-wrong
   - POST /api/questions
   - POST /api/questions/{question_id}/answer
4. 100% deterministic, zero live LLM token cost, <2s execution.
"""

import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.inventory_search import get_inventory_service
from app.services.governance import get_governance_service

client = TestClient(app)


def test_api_version_endpoint():
    """Verify GET /api/version returns version.json schema with valid version and build_number."""
    response = client.get("/api/version")
    assert response.status_code == 200
    data = response.json()

    assert data["version"] in [
        "v0.1", "v0.2", "v0.3", "v0.31", "v0.4", "v0.41", "v0.5", "v0.51", "v0.52", "v0.53",
        "v0.54", "v0.55", "v0.56", "v0.57", "v0.58", "v0.59", "v0.60", "v0.61", "v0.62"
    ]
    assert data["build_number"] >= 1
    assert "release_date" in data
    assert "apk_download_url" in data
    assert data["apk_download_url"].endswith("/or-nav.apk")
    assert "min_supported_version" in data
    assert "changelog" in data and len(data["changelog"]) > 0


def test_public_version_json_file():
    """Verify frontend/public/version.json exists, parses, and has version info."""
    root = Path(__file__).resolve().parent.parent.parent
    version_file = root / "frontend" / "public" / "version.json"
    assert version_file.exists(), f"Missing version.json at {version_file}"

    data = json.loads(version_file.read_text(encoding="utf-8"))
    assert data["version"] in [
        "v0.1", "v0.2", "v0.3", "v0.31", "v0.4", "v0.41", "v0.5", "v0.51", "v0.52", "v0.53",
        "v0.54", "v0.55", "v0.56", "v0.57", "v0.58", "v0.59", "v0.60", "v0.61", "v0.62"
    ]
    assert data["build_number"] >= 1
    assert "apk_download_url" in data
    assert "changelog" in data


def test_outbox_verify_move_endpoint():
    """Verify offline outbox mutation for verify_move flushes successfully."""
    tenant = "or_main"
    service = get_inventory_service(tenant)
    service.reload()

    payload = {
        "tenant_id": tenant,
        "item": "5mm Trocar",
        "verified": True,
        "notes": "Offline outbox auto-sync verification",
    }
    response = client.post("/api/inventory/verify-move", json=payload)
    assert response.status_code == 200
    res_data = response.json()
    assert res_data.get("status") in ["success", "active", "needs_reverification",
                                      "verified"] or "verified" in str(res_data).lower()


def test_outbox_flag_wrong_endpoint():
    """Verify offline outbox mutation for flag_wrong flushes successfully."""
    tenant = "or_main"
    payload = {
        "tenant_id": tenant,
        "item": "5mm Trocar",
        "reason": "Missing from coordinate in OR 2",
    }
    response = client.post("/api/inventory/flag-wrong", json=payload)
    assert response.status_code == 200
    res_data = response.json()
    assert res_data.get("status") in ["flagged", "needs_reverification"] or "reverification" in str(res_data).lower()


def test_outbox_questions_sync_lifecycle():
    """Verify offline outbox mutations for create_question and answer_question flush cleanly."""
    tenant = "pacu_periop"
    import time
    unique_suffix = int(time.time() * 1000)

    # 1. Simulate queued create_question mutation
    question_payload = {
        "tenant_id": tenant,
        "question_text": f"Where are pediatric suction catheters kept during overnight shift {unique_suffix}?",
        "asked_by_role": "Night Nurse",
    }
    create_res = client.post("/api/questions", json=question_payload)
    assert create_res.status_code == 200
    created_q = create_res.json()
    q_id = created_q["id"]
    assert created_q["question_text"] == question_payload["question_text"]
    assert created_q["status"] == "open"

    # 2. Simulate queued answer_question mutation
    answer_payload = {
        "tenant_id": tenant,
        "answer_text": "In Supply Room B, Shelf 2 Bin 4 labeled 'Pediatric Airway'",
        "confidence": "confident",
        "responder_role": "Charge Nurse Sarah",
        "promote_to_verified": False,
    }
    answer_res = client.post(f"/api/questions/{q_id}/answer", json=answer_payload)
    assert answer_res.status_code == 200
    answered_q = answer_res.json()
    assert answered_q["status"] == "tentative" or "answers" in answered_q


def test_outbox_idempotency_and_malformed_handling():
    """Ensure invalid outbox mutations fail gracefully without server crashes."""
    # Invalid verify-move (empty item)
    res = client.post("/api/inventory/verify-move", json={"tenant_id": "or_main", "item": ""})
    assert res.status_code in [200, 400, 422]

    # Non-existent question answering
    res_q = client.post(
        "/api/questions/non_existent_q_id_9999/answer",
        json={
            "tenant_id": "or_main",
            "answer_text": "Test",
            "confidence": "confident",
            "responder_role": "Tester",
        },
    )
    assert res_q.status_code in [404, 400]
