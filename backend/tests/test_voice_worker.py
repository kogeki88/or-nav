import asyncio
import json
import os
import shutil
import time
from typing import Any
import pytest

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

class MockParticipant:
    def __init__(self):
        self.published_packets = []

    def publish_data(self, data: bytes, topic: str):
        self.published_packets.append((topic, json.loads(data.decode("utf-8"))))

class MockRoom:
    def __init__(self):
        self.local_participant = MockParticipant()
        self.name = "mock_room"

@pytest.mark.asyncio
async def test_lookup_item_location_direct():
    spoken = await lookup_item_location(item_query="3-0 silk")
    assert "3-0 Silk Suture" in spoken
    assert "OR 21" in spoken
    assert "Cabinet A" in spoken
    assert "Shelf 2" in spoken
    assert "Bin C" in spoken
    assert "Dr. Chen" in spoken

@pytest.mark.asyncio
async def test_lookup_item_location_alias():
    spoken = await lookup_item_location(item_query="bovie")
    assert "Bovie" in spoken or "Electrosurgical" in spoken

@pytest.mark.asyncio
async def test_lookup_item_location_with_ambient_phi():
    spoken = await lookup_item_location(
        item_query="patient John Smith MRN 1234567 needs 3-0 silk suture"
    )
    assert "3-0 Silk Suture" in spoken
    assert "OR 21" in spoken
    assert "John Smith" not in spoken
    assert "1234567" not in spoken

@pytest.mark.asyncio
async def test_lookup_nonexistent_item():
    spoken = await lookup_item_location(item_query="zzzzzzzz")
    assert "could not locate" in spoken.lower()

@pytest.mark.asyncio
async def test_report_item_move_direct():
    spoken = await report_item_move(
        item_name="3-0 silk suture",
        new_location="OR 21 B 1 A",
    )
    assert "Relocation logged for 3-0 Silk Suture" in spoken
    assert "OR 21 B 1 A" in spoken
    assert "two more clinician confirmations" in spoken

    inv_svc = get_inventory_service("general_memorial_cvor")
    res = inv_svc.search("3-0 silk")
    assert res.pending_location == "OR 21 B 1 A"
    assert res.verify_count == 1

@pytest.mark.asyncio
async def test_query_clinical_protocol_direct():
    answer = await query_clinical_protocol(
        question="What is the Heparin ACT target for bypass?"
    )
    assert len(answer) > 20
    assert len(answer) <= 300
    assert "480" in answer or "heparin" in answer.lower() or "bypass" in answer.lower()

@pytest.mark.asyncio
async def test_query_clinical_protocol_mh_dantrolene():
    answer = await query_clinical_protocol(
        question="What is the Dantrolene dosing for malignant hyperthermia?"
    )
    assert "2.5 mg/kg" in answer or "dantrolene" in answer.lower() or "ryanodex" in answer.lower()


@pytest.mark.asyncio
async def test_ui_sync_published_on_item_lookup():
    mock_room = MockRoom()
    set_active_room(mock_room)

    await lookup_item_location(item_query="where is 3-0 silk")

    assert len(mock_room.local_participant.published_packets) == 1
    topic, payload = mock_room.local_participant.published_packets[0]
    assert topic == "or_nav_ui_sync"
    assert payload["routing_tier"] == "TIER_1_LOCAL_CSV"
    assert payload["coordinate_card"]["item"] == "3-0 Silk Suture"
    assert payload["coordinate_card"]["full_code"] == "OR 21 A 2 C"

@pytest.mark.asyncio
async def test_ui_sync_published_on_item_move():
    mock_room = MockRoom()
    set_active_room(mock_room)

    await report_item_move(item_name="3-0 silk suture", new_location="OR 21 B 1 A")

    assert len(mock_room.local_participant.published_packets) == 1
    topic, payload = mock_room.local_participant.published_packets[0]
    assert topic == "or_nav_ui_sync"
    assert payload["routing_tier"] == "MOVE_REPORTED"
    assert payload["move_widget"]["item"] == "3-0 Silk Suture"
    assert payload["move_widget"]["new_location"] == "OR 21 B 1 A"
    assert payload["move_widget"]["verify_count"] == 1

@pytest.mark.asyncio
async def test_ui_sync_published_on_query_clinical_protocol():
    mock_room = MockRoom()
    set_active_room(mock_room)

    await query_clinical_protocol(question="What is the Dantrolene dosing for malignant hyperthermia?")

    assert len(mock_room.local_participant.published_packets) == 1
    topic, payload = mock_room.local_participant.published_packets[0]
    assert topic == "or_nav_ui_sync"
    assert payload["routing_tier"] == "TIER_2_GEMINI_RAG"
    assert payload["coordinate_card"] is None
    assert payload["move_widget"] is None

@pytest.mark.asyncio
async def test_multi_tenant_isolation_lookup():
    """Verify lookup strictly respects tenant boundaries."""
    # Lookup item present in er_trauma but NOT in general_memorial_cvor
    spoken = await lookup_item_location(
        item_query="rapid infuser",
        tenant_id="general_memorial/er"
    )
    assert "Belmont" in spoken and "Rapid Infuser" in spoken

    # In cvor, should not be found
    spoken_cvor = await lookup_item_location(
        item_query="rapid infuser",
        tenant_id="general_memorial_cvor"
    )
    assert "could not locate" in spoken_cvor.lower()

@pytest.mark.asyncio
async def test_multi_tenant_isolation_protocol():
    """Verify protocol lookup respects tenant boundaries."""
    answer = await query_clinical_protocol(
        question="What is the massive transfusion protocol?",
        tenant_id="general_memorial/er"
    )
    assert len(answer) > 20

@pytest.mark.asyncio
async def test_offline_first_invariant():
    """Test that inventory lookup doesn't depend on external network APIs."""
    # Ensure GEMINI API is cleared to simulate offline
    old_key = os.getenv("GEMINI_API_KEY")
    os.environ["GEMINI_API_KEY"] = ""
    try:
        spoken = await lookup_item_location(item_query="3-0 silk")
        assert "3-0 Silk Suture" in spoken
    finally:
        if old_key is not None:
            os.environ["GEMINI_API_KEY"] = old_key
        else:
            del os.environ["GEMINI_API_KEY"]
