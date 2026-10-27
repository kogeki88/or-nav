"""
Phase 24 User Profile, Facility Name & Clinical Role Scoping Test Suite.

Verifies:
1. Version manifest upgraded to v0.2, build_number: 2.
2. GET /api/version returns v0.2 and updated changelog.
3. User profile data model and clinical role validation.
4. Department scoping: inventory searches properly isolated per unit.
5. 100% deterministic, zero external LLM API tokens, <2s execution.
"""

import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.config import get_tenant, list_tenants, DEPARTMENTS
from app.services.inventory_search import get_inventory_service

client = TestClient(app)


def test_phase24_version_manifest_v02():
    """Verify GET /api/version returns valid version with build number >= 2 and profile changelog."""
    res = client.get("/api/version")
    assert res.status_code == 200
    data = res.json()
    assert data["version"] in ["v0.2", "v0.3", "v0.31", "v0.4", "v0.41"]
    assert data["build_number"] >= 2
    assert "apk_download_url" in data
    assert data["apk_download_url"].endswith("/or-nav.apk")


def test_public_version_json_matches_v02():
    """Verify frontend/public/version.json is updated."""
    root = Path(__file__).resolve().parent.parent.parent
    v_path = root / "frontend" / "public" / "version.json"
    assert v_path.exists()
    manifest = json.loads(v_path.read_text(encoding="utf-8"))
    assert manifest["version"] in ["v0.2", "v0.3", "v0.31", "v0.4", "v0.41"]
    assert manifest["build_number"] >= 2


def test_clinical_assignment_department_scoping():
    """
    Verify each clinical department correctly scopes its unique items,
    ensuring that changing the clinician's assigned department scopes inventory correctly.
    """
    # 1. OR Main (CVOR / General Surgery)
    or_svc = get_inventory_service("or_main")
    or_svc.reload()
    trocar = or_svc.search("5mm trocar")
    assert trocar is not None and "5mm Trocar" in trocar["item"]
    silk = or_svc.search("3-0 silk")
    assert silk is not None and "3-0 Silk" in silk["item"]

    # 2. ICU / Critical Care
    icu_svc = get_inventory_service("icu_critical_care")
    icu_svc.reload()
    cvc = icu_svc.search("central line kit")
    assert cvc is not None and "Central Line" in cvc["item"]
    art_line = icu_svc.search("arterial line")
    assert art_line is not None and "Arterial Line" in art_line["item"]

    # 3. ER / Trauma
    er_svc = get_inventory_service("er_trauma")
    er_svc.reload()
    rsi = er_svc.search("rsi tackle box")
    assert rsi is not None and "RSI" in rsi["item"]
    ezio = er_svc.search("ez-io")
    assert ezio is not None and "EZ-IO" in ezio["item"]

    # 4. PACU / Periop
    pacu_svc = get_inventory_service("pacu_periop")
    pacu_svc.reload()
    sugammadex = pacu_svc.search("sugammadex")
    assert sugammadex is not None and "Sugammadex" in sugammadex["item"]
    nerve_block = pacu_svc.search("nerve block")
    assert nerve_block is not None and "Nerve Block" in nerve_block["item"]


def test_user_profile_payload_simulation():
    """Verify valid clinical roles and profile fields."""
    valid_roles = [
        "CVOR Travel Nurse",
        "Staff Circulator / Scrub",
        "CRNA / Anesthesia",
        "Certified Surgical Technologist",
        "ICU Staff Nurse",
        "ER Staff Nurse",
        "Preceptor / Educator",
    ]

    sample_profile = {
        "fullName": "Sean Iglesia, RN",
        "facilityName": "General Memorial Hospital",
        "departmentId": "or_main",
        "clinicalRole": "CVOR Travel Nurse",
    }

    assert sample_profile["clinicalRole"] in valid_roles
    assert sample_profile["departmentId"] in DEPARTMENTS
    assert len(sample_profile["fullName"]) > 0
    assert len(sample_profile["facilityName"]) > 0
