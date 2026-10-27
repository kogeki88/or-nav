"""
Phase 18 Automated Test Suite: Second-Order Interaction, Race Condition & State Consistency Gauntlet.

Covers:
    - Vector 1: Elliptical Shared-Noun Compound Queries ("Where is 2-0 and 3-0 prolene?")
    - Vector 2: Voice/Lowercase Coordinate Normalization & Clean human_alias
    - Vector 3: Split-Brain Competing Move Reports & expected_location Guard
    - Vector 4: Stale RAG Cache Invalidation on Peer Q&A Promotion & 3/3 Move Commit
    - Vector 5: CSV Formula Sanitization 5-Cycle Round-Trip Integrity
    - Vector 8: 2,000 Character Query Length Boundary Enforcement
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.config import get_tenant
import shutil
from pathlib import Path
from app.services.inventory_search import (
    split_compound_query,
    normalize_location_coordinate,
    InventoryService,
    get_inventory_service,
    reset_inventory_services,
    sanitize_csv_cell,
    unescape_csv_cell,
)
from app.services.governance import get_governance_service, reset_governance_services
from app.services.rag_fallback import get_rag_service, reset_rag_services


@pytest.fixture(autouse=True)
def isolate_tenant_data():
    tenant = get_tenant("general_memorial_cvor")
    inv_path = tenant.inventory_path
    orient_path = tenant.orientation_path
    inv_backup = inv_path.with_suffix(".csv.phase18.bak")
    orient_backup = orient_path.with_suffix(".md.phase18.bak")
    shutil.copyfile(inv_path, inv_backup)
    shutil.copyfile(orient_path, orient_backup)
    reset_inventory_services()
    reset_governance_services()
    reset_rag_services()
    yield
    shutil.copyfile(inv_backup, inv_path)
    shutil.copyfile(orient_backup, orient_path)
    inv_backup.unlink(missing_ok=True)
    orient_backup.unlink(missing_ok=True)
    reset_inventory_services()
    reset_governance_services()
    reset_rag_services()


# ===========================================================================
# Vector 1: Elliptical Shared-Noun Compound Queries
# ===========================================================================

def test_v1_elliptical_shared_noun_expansion():
    # 1. Bare suture gauge inherits trailing head noun from chunk 2
    r1 = split_compound_query("Where is 2-0 and 3-0 prolene?")
    assert r1 == ["2-0 prolene", "3-0 prolene"]

    r2 = split_compound_query("Find 3-0 and 4-0 silk")
    assert r2 == ["3-0 silk", "4-0 silk"]

    # 2. Bare blade numbers inherit trailing "blade"
    r3 = split_compound_query("where is 10 and 11 blade")
    assert r3 == ["10 blade", "11 blade"]

    # 3. Medical acronyms like I&D / D&C are preserved and NOT split
    r4 = split_compound_query("where is the I&D tray")
    assert r4 == ["where is the I&D tray"]

    r5 = split_compound_query("find D&C set")
    assert r5 == ["find D&C set"]

    # 4. Multi-item non-elliptical queries split cleanly
    r6 = split_compound_query("where is 3-0 silk and #10 blade")
    assert r6 == ["3-0 silk", "#10 blade"]


def test_v1_elliptical_query_routes_to_both_items_in_chat():
    client = TestClient(app)
    # Query: "where is 2-0 and 4-0 prolene" -> should resolve both 2-0 Prolene and 4-0 Prolene
    resp = client.post(
        "/api/chat",
        json={"message": "where is 2-0 and 4-0 prolene", "tenant_id": "general_memorial_cvor"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["routing_tier"] == "TIER_1_LOCAL_CSV"
    assert "coordinate_cards" in data
    items = [c["item"] for c in data["coordinate_cards"]]
    assert "2-0 Prolene Suture" in items
    assert "4-0 Prolene Suture" in items


# ===========================================================================
# Vector 2: Voice/Lowercase Coordinate Normalization & Clean human_alias
# ===========================================================================

def test_v2_voice_lowercase_coordinate_normalization():
    # 1. Lowercase standard format: "or 21 b 1 a" -> "OR 21 B 1 A"
    assert normalize_location_coordinate("or 21 b 1 a") == "OR 21 B 1 A"

    # 2. Natural phrasing with room/cabinet/shelf/bin words:
    # "room 21 cabinet b shelf 1 bin a" -> "OR 21 B 1 A"
    assert normalize_location_coordinate("room 21 cabinet b shelf 1 bin a") == "OR 21 B 1 A"
    assert normalize_location_coordinate("room 21 cab b shelf 1 bin a") == "OR 21 B 1 A"
    assert normalize_location_coordinate("or 21 cart b shelf 1 bin a") == "OR 21 B 1 A"

    # 3. Core Supply & Pump Room
    assert normalize_location_coordinate("core supply d 1 a") == "Core Supply D 1 A"
    assert normalize_location_coordinate("core supply rack d shelf 1 bin a") == "Core Supply D 1 A"
    assert normalize_location_coordinate("pump room h 2 a") == "Pump Room H 2 A"

    # 4. Test natural language move reporting with voice lowercase
    p1 = InventoryService.parse_move_command("the 3-0 silk moved to or 21 b 1 a")
    assert p1 is not None
    assert p1[1] == "OR 21 B 1 A"

    p2 = InventoryService.parse_move_command("3-0 silk was moved to room 21 cabinet b shelf 1 bin a")
    assert p2 is not None
    assert p2[1] == "OR 21 B 1 A"


def test_v2_committed_move_regenerates_clean_human_alias():
    tenant = get_tenant("general_memorial_cvor")
    inv = InventoryService(tenant)

    # Report move for 3-0 silk to OR 21 B 1 A
    inv.report_move("3-0 silk", "OR 21 B 1 A")
    # Confirm twice to reach 3/3
    inv.verify_move("3-0 Silk Suture")
    c3 = inv.verify_move("3-0 Silk Suture")
    assert c3["committed"] is True
    assert c3["full_code"] == "OR 21 B 1 A"
    # human_alias MUST reflect new room and cabinet B, not old cart A!
    assert "Cart B" in c3["human_alias"]
    assert "OR 21" in c3["human_alias"]


# ===========================================================================
# Vector 3: Split-Brain Competing Move Reports & expected_location Guard
# ===========================================================================

def test_v3_competing_move_reports_reset_consensus():
    tenant = get_tenant("general_memorial_cvor")
    inv = InventoryService(tenant)

    # 1. Nurse A reports move to OR 21 B 1 A (1/3)
    c1 = inv.report_move("3-0 silk", "OR 21 B 1 A")
    assert c1["pending_location"] == "OR 21 B 1 A"
    assert c1["verify_count"] == 1

    # 2. Nurse B confirms (2/3)
    c2 = inv.verify_move("3-0 Silk Suture", expected_location="OR 21 B 1 A")
    assert c2["verify_count"] == 2

    # 3. Nurse C reports a DIFFERENT target: OR 21 D 4 C
    c3 = inv.report_move("3-0 silk", "OR 21 D 4 C")
    assert c3["pending_location"] == "OR 21 D 4 C"
    # Must reset verify_count to 1 rather than inheriting 2/3!
    assert c3["verify_count"] == 1

    # 4. Nurse B clicks an old widget confirming "OR 21 B 1 A" -> MUST BE REJECTED
    c_stale = inv.verify_move("3-0 Silk Suture", expected_location="OR 21 B 1 A")
    assert c_stale.get("superseded") is True
    assert c_stale["committed"] is False
    assert c_stale["verify_count"] == 1  # Did NOT increment!


# ===========================================================================
# Vector 4: Stale RAG Cache Invalidation on Peer Q&A & Move Commits
# ===========================================================================

def test_v4_rag_cache_invalidates_on_governance_promotion():
    rag = get_rag_service("general_memorial_cvor")
    rag._cache["test_cache_key"] = ("Cached old response", False)
    assert len(rag._cache) == 1

    gov = get_governance_service("general_memorial_cvor")
    q = gov.create_question("Where do we keep the backup cryo nerve probe?")
    gov.answer_question(
        question_id=q["id"],
        answer_text="Cryo probe is in Core Supply Pyxis D Bin 3.",
        promote_to_verified=True,
    )

    # Verified promotion triggers rag.reload(), clearing _cache
    assert len(rag._cache) == 0


def test_v4_rag_cache_invalidates_on_committed_move():
    rag = get_rag_service("general_memorial_cvor")
    rag._cache["test_move_key"] = ("Cached move response", False)
    assert len(rag._cache) == 1

    inv = get_inventory_service("general_memorial_cvor")
    inv.report_move("3-0 silk", "OR 21 B 1 A")
    inv.verify_move("3-0 Silk Suture")
    inv.verify_move("3-0 Silk Suture")  # Reaches 3/3 commit

    # 3/3 commit triggers rag.reload(), clearing _cache
    assert len(rag._cache) == 0


# ===========================================================================
# Vector 5: CSV Formula Sanitization 5-Cycle Round-Trip Integrity
# ===========================================================================

def test_v5_csv_formula_sanitization_5_cycle_round_trip():
    # Test clinical notes with leading bullet / hyphen and negative temperature
    note_bullet = "- Use on redo sternotomy only; check with Dr. Patel"
    note_temp = "-20C graft freezer storage"
    note_plus = "+4C blood refrigerator"
    formula_bad = "+cmd|' /C calc'!A0"

    # 1. Normal clinical bullets and temperatures must NOT be corrupted
    assert sanitize_csv_cell(note_bullet) == note_bullet
    assert sanitize_csv_cell(note_temp) == note_temp
    assert sanitize_csv_cell(note_plus) == note_plus

    # 2. Formula malicious code MUST be neutralized with single quote
    sanitized_bad = sanitize_csv_cell(formula_bad)
    assert sanitized_bad == "'+cmd|' /C calc'!A0"

    # 3. 5-cycle save/load idempotency: string must NEVER accumulate multiple quotes
    curr = sanitized_bad
    for _ in range(5):
        curr = sanitize_csv_cell(curr)
        assert curr == "'+cmd|' /C calc'!A0"
        assert not curr.startswith("''")

    # 4. Unescape restores exact original payload
    assert unescape_csv_cell(curr) == formula_bad
    assert unescape_csv_cell(note_bullet) == note_bullet


# ===========================================================================
# Vector 8: 2,000 Character Query Length Boundary Enforcement
# ===========================================================================

def test_v8_query_length_boundary_2000_chars():
    client = TestClient(app)

    # 1. 2,000 character query is accepted
    valid_query = "where is 3-0 silk " + ("x" * (2000 - len("where is 3-0 silk ")))
    resp_valid = client.post(
        "/api/chat",
        json={"message": valid_query, "tenant_id": "general_memorial_cvor"},
    )
    assert resp_valid.status_code == 200

    # 2. 2,001 character query is rejected with HTTP 422 Unprocessable Entity
    oversized_query = "where is 3-0 silk " + ("x" * (2001 - len("where is 3-0 silk ")))
    resp_oversized = client.post(
        "/api/chat",
        json={"message": oversized_query, "tenant_id": "general_memorial_cvor"},
    )
    assert resp_oversized.status_code == 422
