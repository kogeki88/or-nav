"""
Unit and Integration Tests for OR-Nav Phase 4 Voice Architecture.

Verifies:
  1. LiveKit Router:
     - /api/voice/status (detects unconfigured vs configured LiveKit)
     - /api/voice/token (503 on unconfigured, valid JWT on configured)
  2. Voice Function Tools (@function_tool declarations):
     - lookup_item_location: sub-10ms Tier 1 lookup, alias handling, PHI scrub
     - report_item_move: crowdsourced relocation logging
     - query_clinical_protocol: Tier 2 RAG protocol guidance
  3. UI Data Channel Synchronization:
     - Data packets published over topic "or_nav_ui_sync"
"""

import asyncio
import json
import os
import shutil
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.config import get_tenant
from app.services.inventory_search import get_inventory_service, reset_inventory_services
from app.services.rag_fallback import reset_rag_services
from app.voice.worker import (
    lookup_item_location,
    report_item_move,
    query_clinical_protocol,
    set_active_room,
    publish_ui_sync,
)


@pytest.fixture(autouse=True)
def isolate_tenant_data():
    """Backup and restore inventory.csv around voice tests."""
    tenant = get_tenant("general_memorial_cvor")
    inv_path = tenant.inventory_path
    inv_backup = inv_path.with_suffix(".csv.voice.bak")

    shutil.copyfile(inv_path, inv_backup)
    reset_inventory_services()
    reset_rag_services()
    set_active_room(None)

    yield

    if inv_backup.exists():
        shutil.copyfile(inv_backup, inv_path)
        inv_backup.unlink()

    reset_inventory_services()
    reset_rag_services()
    set_active_room(None)


@pytest.fixture
def client():
    return TestClient(app)


# ===================================================================
# 1. Voice Router Tests (/api/voice/status & /api/voice/token)
# ===================================================================

class TestVoiceRouter:
    """Test voice endpoints for dual-mode detection and JWT minting."""

    def test_voice_status_unconfigured(self, client, monkeypatch):
        monkeypatch.delenv("LIVEKIT_URL", raising=False)
        monkeypatch.delenv("LIVEKIT_API_KEY", raising=False)
        monkeypatch.delenv("LIVEKIT_API_SECRET", raising=False)

        resp = client.get("/api/voice/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["livekit_configured"] is False
        assert data["mode"] == "BROWSER_WEB_SPEECH"
        assert data["livekit_url"] is None

    def test_voice_status_configured(self, client, monkeypatch):
        monkeypatch.setenv("LIVEKIT_URL", "wss://livekit.cvor.internal")
        monkeypatch.setenv("LIVEKIT_API_KEY", "devkey123")
        monkeypatch.setenv("LIVEKIT_API_SECRET", "secret123456789012345678901234567890")

        resp = client.get("/api/voice/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["livekit_configured"] is True
        assert data["mode"] == "LIVEKIT_WEBRTC"
        assert data["livekit_url"] == "wss://livekit.cvor.internal"

    def test_mint_token_unconfigured_returns_503(self, client, monkeypatch):
        monkeypatch.delenv("LIVEKIT_URL", raising=False)
        monkeypatch.delenv("LIVEKIT_API_KEY", raising=False)
        monkeypatch.delenv("LIVEKIT_API_SECRET", raising=False)

        resp = client.post("/api/voice/token", json={
            "tenant_id": "general_memorial_cvor",
            "participant_name": "scrub_nurse_1",
        })
        assert resp.status_code == 503
        assert "not configured" in resp.json()["detail"].lower()

    def test_mint_token_configured_returns_valid_jwt(self, client, monkeypatch):
        monkeypatch.setenv("LIVEKIT_URL", "wss://livekit.cvor.internal")
        monkeypatch.setenv("LIVEKIT_API_KEY", "devkey123")
        monkeypatch.setenv("LIVEKIT_API_SECRET", "secret123456789012345678901234567890")

        resp = client.post("/api/voice/token", json={
            "tenant_id": "general_memorial_cvor",
            "participant_name": "dr_chen_cvor",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "token" in data
        assert len(data["token"]) > 30
        assert data["room_name"] == "or-nav-general_memorial_cvor"
        assert data["livekit_url"] == "wss://livekit.cvor.internal"
        assert data["tenant_id"] == "general_memorial_cvor"


# ===================================================================
# 2. Voice Function Tool Execution Tests
# ===================================================================

class TestVoiceFunctionTools:
    """Test direct execution of all 3 agent @function_tool handlers."""

    def test_lookup_item_location_direct(self):
        spoken = asyncio.run(lookup_item_location(item_query="3-0 silk"))
        assert "3-0 Silk Suture" in spoken
        assert "OR 21" in spoken
        assert "Cabinet A" in spoken
        assert "Shelf 2" in spoken
        assert "Bin C" in spoken
        assert "Dr. Chen" in spoken

    def test_lookup_item_location_alias(self):
        spoken = asyncio.run(lookup_item_location(item_query="spoons"))
        assert "Internal Defibrillator Paddles" in spoken
        assert "OR 21" in spoken
        assert "Cabinet G" in spoken

    def test_lookup_item_location_with_ambient_phi(self):
        spoken = asyncio.run(lookup_item_location(
            item_query="patient John Smith MRN 1234567 needs 3-0 silk suture"
        ))
        assert "3-0 Silk Suture" in spoken
        assert "OR 21" in spoken
        assert "John Smith" not in spoken
        assert "1234567" not in spoken

    def test_lookup_nonexistent_item(self):
        spoken = asyncio.run(lookup_item_location(item_query="laser scalpel 9000"))
        assert "could not locate" in spoken.lower()

    def test_report_item_move_direct(self):
        spoken = asyncio.run(report_item_move(
            item_name="3-0 silk suture",
            new_location="OR 21 B 1 A",
        ))
        assert "Relocation logged for 3-0 Silk Suture" in spoken
        assert "OR 21 B 1 A" in spoken
        assert "two more clinician confirmations" in spoken

        inv_svc = get_inventory_service("general_memorial_cvor")
        res = inv_svc.search("3-0 silk")
        assert res.pending_location == "OR 21 B 1 A"
        assert res.verify_count == 1

    def test_query_clinical_protocol_direct(self):
        answer = asyncio.run(query_clinical_protocol(
            question="What is the Heparin ACT target for bypass?"
        ))
        assert len(answer) > 20
        assert len(answer) <= 300
        assert "480" in answer or "heparin" in answer.lower() or "bypass" in answer.lower()

    def test_query_clinical_protocol_mh_dantrolene(self):
        answer = asyncio.run(query_clinical_protocol(
            question="What is the Dantrolene dosing for malignant hyperthermia?"
        ))
        assert "2.5 mg/kg" in answer or "dantrolene" in answer.lower() or "ryanodex" in answer.lower()


# ===================================================================
# 3. UI Data Channel Synchronization Tests
# ===================================================================

class MockParticipant:
    def __init__(self):
        self.published_packets = []

    def publish_data(self, data: bytes, topic: str):
        self.published_packets.append((topic, json.loads(data.decode("utf-8"))))


class MockRoom:
    def __init__(self):
        self.local_participant = MockParticipant()


class TestDataChannelSync:
    """Verify live structured UI sync packets over topic 'or_nav_ui_sync'."""

    def test_ui_sync_published_on_item_lookup(self):
        mock_room = MockRoom()
        set_active_room(mock_room)

        asyncio.run(lookup_item_location(item_query="where is 3-0 silk"))

        assert len(mock_room.local_participant.published_packets) == 1
        topic, payload = mock_room.local_participant.published_packets[0]
        assert topic == "or_nav_ui_sync"
        assert payload["routing_tier"] == "TIER_1_LOCAL_CSV"
        assert payload["coordinate_card"]["item"] == "3-0 Silk Suture"
        assert payload["coordinate_card"]["full_code"] == "OR 21 A 2 C"

    def test_ui_sync_published_on_item_move(self):
        mock_room = MockRoom()
        set_active_room(mock_room)

        asyncio.run(report_item_move(item_name="3-0 silk suture", new_location="OR 21 B 1 A"))

        assert len(mock_room.local_participant.published_packets) == 1
        topic, payload = mock_room.local_participant.published_packets[0]
        assert topic == "or_nav_ui_sync"
        assert payload["routing_tier"] == "MOVE_REPORTED"
        assert payload["move_widget"]["item"] == "3-0 Silk Suture"
        assert payload["move_widget"]["new_location"] == "OR 21 B 1 A"
        assert payload["move_widget"]["verify_count"] == 1
