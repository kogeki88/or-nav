"""
Phase 17 Automated Test Suite: Deep Architectural, Clinical & Security Crack-Hunting.

Covers 8 Deep Vectors:
    - Deep Vector 1: Surgeon Name vs Patient PHI (scrubber.py)
    - Deep Vector 2: CVOR Needle Code & Cross-Unit Collisions (inventory_search.py)
    - Deep Vector 3: Question vs Command Move-Router Trap (inventory_search.py)
    - Deep Vector 4: Multi-Item Compound Lookup (chat.py)
    - Deep Vector 6: Anti-Spam Cooldown on Implicit Verification (inventory_search.py)
    - Deep Vector 7: 10 MB Upload Cap (chat.py)
    - Deep Vector 8: CSV Formula Injection Sanitization & Prompt Delimiters
"""

import io
import time
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.scrubber import scrub_phi, REDACTION
from app.services.inventory_search import (
    extract_gauge_and_specs,
    has_conflicting_specifications,
    InventoryService,
    get_inventory_service,
    reset_inventory_services,
    sanitize_csv_cell,
    unescape_csv_cell,
)
from app.config import get_tenant


@pytest.fixture(autouse=True)
def reset_services():
    reset_inventory_services()
    yield
    reset_inventory_services()


# ===========================================================================
# Deep Vector 1: Surgeon Name vs Patient PHI
# ===========================================================================

def test_v1_preserves_surgeon_names_and_eponymous_instruments():
    # 1. Surgeon names with Dr. or Doctor must NOT be scrubbed
    q1 = scrub_phi("What are Dr. Patel's suture preferences?")
    assert "Dr. Patel" in q1.text
    assert q1.redaction_count == 0

    q2 = scrub_phi("Where are Dr. Chen's cannulas?")
    assert "Dr. Chen" in q2.text
    assert q2.redaction_count == 0

    q3 = scrub_phi("Doctor Smith wants sternal wire loaded")
    assert "Doctor Smith" in q3.text
    assert q3.redaction_count == 0

    # 2. Eponymous surgical instruments must NOT be scrubbed
    q4 = scrub_phi("Find DeBakey forceps and Mayo scissors")
    assert "DeBakey" in q4.text
    assert "Mayo" in q4.text
    assert q4.redaction_count == 0

    q5 = scrub_phi("Bring Metzenbaum scissors and Weitlaner retractor to OR 21")
    assert "Metzenbaum" in q5.text
    assert "Weitlaner" in q5.text
    assert q5.redaction_count == 0


def test_v1_redacts_patient_phi_names():
    # 1. Standard patient name
    q1 = scrub_phi("Patient John Miller needs 3-0 silk")
    assert "John Miller" not in q1.text
    assert REDACTION in q1.text
    assert q1.redaction_count >= 1

    # 2. "Patient named <Name>"
    q2 = scrub_phi("Patient named Sarah Connor needs suction")
    assert "Sarah Connor" not in q2.text
    assert REDACTION in q2.text
    assert q2.redaction_count >= 1

    # 3. "pt <Name>"
    q3 = scrub_phi("pt Sarah Connor in OR 21")
    assert "Sarah Connor" not in q3.text
    assert REDACTION in q3.text
    assert q3.redaction_count >= 1


# ===========================================================================
# Deep Vector 2: CVOR Needle Code & Cross-Unit Collisions
# ===========================================================================

def test_v2_needle_code_extraction_and_conflict_guard():
    specs_rb1 = extract_gauge_and_specs("3-0 prolene rb-1")
    assert "rb-1" in specs_rb1["needle_codes"]

    specs_sh = extract_gauge_and_specs("3-0 prolene sh")
    assert "sh" in specs_sh["needle_codes"]

    row_with_sh = {
        "item": "3-0 Prolene SH Suture",
        "aliases": "prolene sh",
        "category": "Sutures",
        "surgeon_notes": "SH needle",
        "_specs": specs_sh,
    }

    # Query asking for RB-1 must conflict with row having SH needle
    assert has_conflicting_specifications(specs_rb1, row_with_sh) is True

    row_with_rb1 = {
        "item": "3-0 Prolene RB-1 Suture",
        "aliases": "prolene rb-1",
        "category": "Sutures",
        "surgeon_notes": "RB-1 needle",
        "_specs": specs_rb1,
    }
    # Query asking for RB-1 matches row with RB-1 needle
    assert has_conflicting_specifications(specs_rb1, row_with_rb1) is False


def test_v2_cross_unit_collisions():
    specs_18g = extract_gauge_and_specs("18g needle")
    assert "18g" in specs_18g["gauge_sizes"]

    specs_18fr = extract_gauge_and_specs("18fr catheter")
    assert "18fr" in specs_18fr["french_sizes"]

    specs_18in = extract_gauge_and_specs("18in tubing")
    assert "18in" in specs_18in["lengths"]

    specs_18mm = extract_gauge_and_specs("18mm clip")
    assert "18mm" in specs_18mm["mm_sizes"]

    row_18fr = {
        "item": "Foley Catheter 18Fr",
        "aliases": "18 french catheter",
        "category": "Catheters",
        "surgeon_notes": "",
        "_specs": specs_18fr,
    }

    # 18g query must conflict with 18fr row
    assert has_conflicting_specifications(specs_18g, row_18fr) is True

    # 18in query must conflict with 18fr row
    assert has_conflicting_specifications(specs_18in, row_18fr) is True

    # 18mm query must conflict with 18fr row
    assert has_conflicting_specifications(specs_18mm, row_18fr) is True


# ===========================================================================
# Deep Vector 3: Question vs Command Move-Router Trap
# ===========================================================================

def test_v3_question_vs_move_command_routing():
    # Declarative move report -> MUST parse as move
    res1 = InventoryService.parse_move_command("The 3-0 silk was moved to OR 21 B 1 A")
    assert res1 is not None
    assert "3-0 silk" in res1[0]
    assert res1[1] == "OR 21 B 1 A"

    res2 = InventoryService.parse_move_command("3-0 silk moved to OR 21 B 1 A")
    assert res2 is not None

    # Questions and interrogatives -> MUST NOT parse as move
    assert InventoryService.parse_move_command("Why was 3-0 silk moved to OR 21 B 1 A?") is None
    assert InventoryService.parse_move_command("Did anyone move bone wax to Sub-sterile 4?") is None
    assert InventoryService.parse_move_command("Is 3-0 silk moved to OR 21 B 1 A?") is None
    assert InventoryService.parse_move_command("Where was 3-0 silk moved to?") is None
    assert InventoryService.parse_move_command("Check if 3-0 silk moved to OR 21 B 1 A") is None


# ===========================================================================
# Deep Vector 4: Multi-Item Compound Lookup
# ===========================================================================

def test_v4_multi_item_compound_lookup():
    client = TestClient(app)

    # Query asking for two known items with "and"
    resp = client.post(
        "/api/chat",
        json={"message": "where is 3-0 silk and #10 blade", "tenant_id": "general_memorial_cvor"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["routing_tier"] == "TIER_1_LOCAL_CSV"
    assert "coordinate_cards" in data
    assert len(data["coordinate_cards"]) == 2
    items = [c["item"] for c in data["coordinate_cards"]]
    assert "3-0 Silk Suture" in items
    assert "#10 Blade" in items
    # Backwards compatibility check
    assert data["coordinate_card"]["item"] == items[0]

    # Query with "&"
    resp_amp = client.post(
        "/api/chat",
        json={"message": "find 2-0 prolene & bovie", "tenant_id": "general_memorial_cvor"},
    )
    assert resp_amp.status_code == 200
    data_amp = resp_amp.json()
    assert len(data_amp["coordinate_cards"]) == 2


# ===========================================================================
# Deep Vector 6: Anti-Spam Cooldown on Implicit Verification
# ===========================================================================

def test_v6_anti_spam_cooldown_on_implicit_verification():
    tenant = get_tenant("general_memorial_cvor")
    inv = InventoryService(tenant, cooldown_seconds=60.0)

    # Reset in-memory test item to provisional score 2.0 for isolated test run
    for row in inv._rows:
        if row["item"] == "#15 Blade":
            row["verification_score"] = 2.0
            row["status"] = "provisional"
            break

    initial_card = inv.search("#15 blade", record_implicit_verification=False)
    assert initial_card is not None
    init_score = initial_card["verification_score"]

    # First search -> increments score by +0.5 (from 2.0 to 2.5)
    c1 = inv.search("#15 blade", record_implicit_verification=True, cooldown_seconds=60.0)
    assert c1 is not None
    assert c1["verification_score"] == round(init_score + 0.5, 2)

    # Immediate second search within 60s cooldown -> score must NOT increment again
    c2 = inv.search("#15 blade", record_implicit_verification=True, cooldown_seconds=60.0)
    assert c2 is not None
    assert c2["verification_score"] == c1["verification_score"]


# ===========================================================================
# Deep Vector 7: 10 MB Upload Cap
# ===========================================================================

def test_v7_10mb_upload_cap():
    client = TestClient(app)

    # Construct > 10 MB dummy payload
    oversized_bytes = b"0" * (10 * 1024 * 1024 + 1024)

    # 1. Voice query upload cap
    voice_resp = client.post(
        "/api/v1/voice-query",
        data={"tenant_id": "general_memorial_cvor"},
        files={"file": ("test.webm", oversized_bytes, "audio/webm")},
    )
    assert voice_resp.status_code == 413
    assert "Payload too large" in voice_resp.text

    # 2. Ingest upload cap
    ingest_resp = client.post(
        "/api/ingest",
        data={"tenant_id": "general_memorial_cvor"},
        files={"file": ("inventory.csv", oversized_bytes, "text/csv")},
    )
    assert ingest_resp.status_code == 413
    assert "Payload too large" in ingest_resp.text


# ===========================================================================
# Deep Vector 8: CSV Formula Injection Sanitization
# ===========================================================================

def test_v8_csv_formula_injection_sanitization():
    # Dangerous formula prefixes are neutralized with a leading single quote
    assert sanitize_csv_cell("=SUM(A1:A10)") == "'=SUM(A1:A10)"
    assert sanitize_csv_cell("@alert(1)") == "'@alert(1)"
    assert sanitize_csv_cell("+cmd|' /C calc'!A0") == "'+cmd|' /C calc'!A0"
    assert sanitize_csv_cell("-2+3+cmd|' /C calc'!A0") == "'-2+3+cmd|' /C calc'!A0"
    assert sanitize_csv_cell("\tmalicious") == "'\tmalicious"

    # Normal strings remain untouched
    assert sanitize_csv_cell("3-0 Silk Suture") == "3-0 Silk Suture"
    assert sanitize_csv_cell("DeBakey Forceps 12in") == "DeBakey Forceps 12in"

    # Unescape reverses the single quote prefix
    assert unescape_csv_cell("'=SUM(A1:A10)") == "=SUM(A1:A10)"
    assert unescape_csv_cell("3-0 Silk Suture") == "3-0 Silk Suture"
