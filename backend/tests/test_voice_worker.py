from hypothesis import given, settings, strategies as st
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

    tenant_er = get_tenant("general_memorial/er")
    er_inv_path = tenant_er.inventory_path
    er_inv_backup = er_inv_path.with_suffix(".csv.voice.bak")

    lexicon_path = tenant.inventory_path.parent / "learned_lexicon.json"
    lexicon_backup = lexicon_path.with_suffix(".json.voice.bak")
    lexicon_lock = tenant.inventory_path.parent / "learned_lexicon.lock"

    er_lexicon_path = tenant_er.inventory_path.parent / "learned_lexicon.json"
    er_lexicon_backup = er_lexicon_path.with_suffix(".json.voice.bak")
    er_lexicon_lock = tenant_er.inventory_path.parent / "learned_lexicon.lock"

    shutil.copyfile(inv_path, inv_backup)
    shutil.copyfile(er_inv_path, er_inv_backup)

    if lexicon_path.exists():
        shutil.copyfile(lexicon_path, lexicon_backup)
    if er_lexicon_path.exists():
        shutil.copyfile(er_lexicon_path, er_lexicon_backup)

    reset_inventory_services()
    reset_rag_services()
    set_active_room(None)

    yield

    if inv_backup.exists():
        shutil.copyfile(inv_backup, inv_path)
        inv_backup.unlink()

    if er_inv_backup.exists():
        shutil.copyfile(er_inv_backup, er_inv_path)
        er_inv_backup.unlink()

    if lexicon_backup.exists():
        shutil.copyfile(lexicon_backup, lexicon_path)
        lexicon_backup.unlink()

    if er_lexicon_backup.exists():
        shutil.copyfile(er_lexicon_backup, er_lexicon_path)
        er_lexicon_backup.unlink()

    if lexicon_lock.exists():
        lexicon_lock.unlink()

    if er_lexicon_lock.exists():
        er_lexicon_lock.unlink()

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

@pytest.mark.asyncio
async def test_malformed_payload_resilience():
    """Verify that none inputs don't crash the worker"""
    spoken1 = await lookup_item_location(item_query=None)
    assert "could not locate" in spoken1.lower()

    spoken2 = await report_item_move(item_name=None, new_location=None)
    assert "Could not find an item matching" in spoken2

    spoken3 = await query_clinical_protocol(question=None)
    assert isinstance(spoken3, str)



@pytest.mark.asyncio
@settings(deadline=None)
@given(
    item_query=st.one_of(st.none(), st.text(min_size=0, max_size=1000)),
    tenant_id=st.sampled_from(["general_memorial_cvor", "er_trauma", "icu_critical_care"])
)
async def test_fuzz_lookup_item_location(item_query, tenant_id):
    result = await lookup_item_location(item_query=item_query, tenant_id=tenant_id)
    assert isinstance(result, str)

@pytest.mark.asyncio
@settings(deadline=None)
@given(
    item_name=st.one_of(st.none(), st.text(min_size=0, max_size=1000)),
    new_location=st.one_of(st.none(), st.text(min_size=0, max_size=1000)),
    tenant_id=st.sampled_from(["general_memorial_cvor", "er_trauma", "icu_critical_care"])
)
async def test_fuzz_report_item_move(item_name, new_location, tenant_id):
    result = await report_item_move(item_name=item_name, new_location=new_location, tenant_id=tenant_id)
    assert isinstance(result, str)

@pytest.mark.asyncio
@settings(deadline=None)
@given(
    question=st.one_of(st.none(), st.text(min_size=0, max_size=1000)),
    tenant_id=st.sampled_from(["general_memorial_cvor", "er_trauma", "icu_critical_care"])
)
async def test_fuzz_query_clinical_protocol(question, tenant_id):
    result = await query_clinical_protocol(question=question, tenant_id=tenant_id)
    assert isinstance(result, str)

@pytest.mark.asyncio
async def test_concurrent_burst_execution_and_latency(monkeypatch):
    def raise_offline_error(*args, **kwargs):
        raise RuntimeError("Network calls are forbidden (offline-first invariant violated)")

    monkeypatch.setattr("socket.socket", raise_offline_error)
    monkeypatch.setattr("httpx.get", raise_offline_error)
    monkeypatch.setattr("httpx.post", raise_offline_error)
    monkeypatch.setattr("httpx.request", raise_offline_error)

    num_requests = 100
    tasks = []
    for i in range(num_requests):
        if i % 2 == 0:
            tasks.append(lookup_item_location(item_query="rapid infuser", tenant_id="general_memorial/er"))
        else:
            tasks.append(lookup_item_location(item_query="3-0 silk", tenant_id="general_memorial_cvor"))

    start_time = time.time()
    results = await asyncio.gather(*tasks)
    end_time = time.time()

    avg_latency = (end_time - start_time)  # Makespan of concurrent execution

    for i, result in enumerate(results):
        if i % 2 == 0:
            assert "Belmont" in result and "Rapid Infuser" in result
        else:
            assert "3-0 Silk Suture" in result

    assert avg_latency < 2.0, f"Total execution time too high: {avg_latency}s"

@pytest.mark.asyncio
async def test_concurrent_burst_write_race_condition(monkeypatch):
    """Test race condition resistance under high concurrent writes."""
    def raise_offline_error(*args, **kwargs):
        raise RuntimeError("Network calls are forbidden (offline-first invariant violated)")

    monkeypatch.setattr("socket.socket", raise_offline_error)
    monkeypatch.setattr("httpx.get", raise_offline_error)
    monkeypatch.setattr("httpx.post", raise_offline_error)
    monkeypatch.setattr("httpx.request", raise_offline_error)

    num_requests = 50
    tasks = []

    # We will concurrently report the same item moving to different locations
    # and different items moving to the same location across tenants.
    for i in range(num_requests):
        if i % 2 == 0:
            tasks.append(report_item_move(item_name="3-0 silk suture", new_location=f"OR 21 B {i}", tenant_id="general_memorial_cvor"))
        else:
            tasks.append(report_item_move(item_name="rapid infuser", new_location="OR 10", tenant_id="general_memorial/er"))

    start_time = time.time()
    results = await asyncio.gather(*tasks)
    end_time = time.time()

    for i, result in enumerate(results):
        if i % 2 == 0:
            assert "Relocation logged" in result
        else:
            assert "Relocation logged" in result

    # Verify the final state is consistent for one of the updates
    inv_svc = get_inventory_service("general_memorial_cvor")
    res = inv_svc.search("3-0 silk")
    assert res.pending_location.startswith("OR 21 B ")
    assert res.verify_count > 0

@pytest.mark.asyncio
async def test_offline_mutation_replay_idempotency(monkeypatch):
    """Verify offline mutation replay idempotency for VoiceWorker."""
    import socket
    original_socket = socket.socket
    def mock_socket(*args, **kwargs):
        family = kwargs.get('family') or (args[0] if len(args) > 0 else -1)
        if family != getattr(socket, 'AF_UNIX', -1):
            raise RuntimeError("Network calls are forbidden (offline-first invariant violated)")
        return original_socket(*args, **kwargs)

    def raise_offline_error(*args, **kwargs):
        raise RuntimeError("Network calls are forbidden (offline-first invariant violated)")

    monkeypatch.setattr("socket.socket", mock_socket)
    monkeypatch.setattr("httpx.get", raise_offline_error)
    monkeypatch.setattr("httpx.post", raise_offline_error)
    monkeypatch.setattr("httpx.request", raise_offline_error)

    # Move item once
    res1 = await report_item_move(
        item_name="3-0 silk suture",
        new_location="OR 21 B 1 A",
        tenant_id="general_memorial_cvor"
    )

    # Replay same mutation
    res2 = await report_item_move(
        item_name="3-0 silk suture",
        new_location="OR 21 B 1 A",
        tenant_id="general_memorial_cvor"
    )

    assert res1 == res2

@pytest.mark.asyncio
async def test_multi_tenant_isolation_move():
    """Verify item relocation respects tenant boundaries."""
    # Attempt to move an item only present in cvor from er_trauma
    spoken_er = await report_item_move(
        item_name="3-0 silk suture",
        new_location="OR 10",
        tenant_id="general_memorial::er"
    )
    assert "Could not find" in spoken_er

    # Move item in cvor
    spoken_cvor = await report_item_move(
        item_name="3-0 silk suture",
        new_location="OR 21 B 1 A",
        tenant_id="general_memorial_cvor"
    )
    assert "Relocation logged" in spoken_cvor
