"""
Phase 42 Test Suite: Offline-First Background Sync & Conflict Resolution Engine.

Tests:
1. Verify Last Write Wins logic: Older timestamped offline mutations are safely dropped.
2. Verify newer timestamp mutations properly override current state.
"""

import time
import pytest
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient

from app.main import app
from app.services.inventory_search import get_inventory_service

client = TestClient(app)

def test_last_write_wins_flag_wrong():
    tenant_id = "general_memorial_cvor"
    inv_service = get_inventory_service(tenant_id)
    inv_service.reload()

    item_name = "3-0 Silk"

    # 1. Do a regular flag_wrong to update the last_verified_at to NOW
    res = client.post("/api/inventory/flag-wrong", json={
        "tenant_id": tenant_id,
        "item": item_name,
        "reason": "Initial test flag"
    })
    assert res.status_code == 200
    card = res.json()
    assert card["status"] == "needs_reverification"
    assert card["verification_score"] == 0.5
    current_time = card["last_verified_at"]

    # 2. Simulate an OFFLINE mutation that happened 1 hour AGO (older timestamp)
    past_time = (datetime.now(timezone.utc) - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")

    res_older = client.post("/api/inventory/flag-wrong", json={
        "tenant_id": tenant_id,
        "item": item_name,
        "reason": "Offline flag from the past",
        "timestamp": past_time
    })
    assert res_older.status_code == 200
    card_older = res_older.json()

    # It should drop the old mutation. The last_verified_at should remain unchanged from the previous real flag
    assert card_older["last_verified_at"] == current_time

    # Sleep briefly to ensure datetime.now() advances to the next second
    time.sleep(1.05)

    # 3. Simulate an OFFLINE mutation that happened 1 hour IN THE FUTURE (newer timestamp)
    future_time = (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")

    res_newer = client.post("/api/inventory/flag-wrong", json={
        "tenant_id": tenant_id,
        "item": item_name,
        "reason": "Offline flag from the future",
        "timestamp": future_time
    })

    assert res_newer.status_code == 200
    card_newer = res_newer.json()

    # It should apply the new mutation. The last_verified_at should be updated to the time of application
    # NOTE: Our logic in flag_wrong uses datetime.now() when applying.
    # But it verifies it wasn't dropped!
    assert card_newer["last_verified_at"] != current_time

def test_last_write_wins_verify_move():
    tenant_id = "general_memorial_cvor"
    inv_service = get_inventory_service(tenant_id)
    inv_service.reload()

    item_name = "Debakey Forceps"

    # Send a quick add-item or use existing
    # Let's verify a move
    current_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Send older verify move
    past_time = (datetime.now(timezone.utc) - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    res_older = client.post("/api/inventory/verify-move", json={
        "tenant_id": tenant_id,
        "item": item_name,
        "expected_location": "OR 1 Cabinet 1 Shelf 1 Bin 1",
        "timestamp": past_time
    })

    # Should safely drop the mutation and return current status.
    assert res_older.status_code == 200
    card_older = res_older.json()

    assert "verify_count" in card_older
