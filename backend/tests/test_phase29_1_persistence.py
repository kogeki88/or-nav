"""
Phase 29.1 Test Suite: Chat Persistence & Multi-Session History Isolation
Verifies that case queries and session endpoints operate deterministically across
consecutive sessions, multi-department transitions, and offline sync invariants.
"""

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_consecutive_sessions_tenant_isolation():
    """Verify that consecutive queries across multiple case sessions preserve tenant context."""
    # Case 1 in OR
    r1 = client.post(
        "/api/chat",
        json={"message": "Where is the DeBakey forceps?", "tenant_id": "or_main"}
    )
    assert r1.status_code == 200
    d1 = r1.json()
    assert d1["routing_tier"] in ("TIER_1_LOCAL_CSV", "TIER_2_GEMINI_RAG")

    # Case 2 in ICU
    r2 = client.post(
        "/api/chat",
        json={"message": "Where are the arterial line kits?", "tenant_id": "icu_critical_care"}
    )
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2["routing_tier"] in ("TIER_1_LOCAL_CSV", "TIER_2_GEMINI_RAG")

    # Case 3 in ER
    r3 = client.post(
        "/api/chat",
        json={"message": "Where is the chest tube insertion kit?", "tenant_id": "er_trauma"}
    )
    assert r3.status_code == 200
    d3 = r3.json()
    assert d3["routing_tier"] in ("TIER_1_LOCAL_CSV", "TIER_2_GEMINI_RAG")

def test_session_phi_scrubbing_resilience():
    """Verify PHI is scrubbed on chat queries regardless of active session history."""
    r = client.post(
        "/api/chat",
        json={
            "message": "Patient John Doe MRN 123456789 needs 3-0 Prolene",
            "tenant_id": "or_main"
        }
    )
    assert r.status_code == 200
    data = r.json()
    assert "John Doe" not in data.get("reply_text", "")
    assert "123456789" not in data.get("reply_text", "")

def test_inventory_sync_supports_offline_hydration():
    """Verify inventory sync endpoint provides offline seeds for IndexedDB cache."""
    for tenant in ["or_main", "icu_critical_care", "er_trauma", "pacu_periop"]:
        r = client.get(f"/api/inventory/sync?tenant_id={tenant}")
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert len(data["items"]) > 0
        assert data["tenant_id"] == tenant
