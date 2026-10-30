import json
import pytest
from pathlib import Path
from app.config import get_tenant, DEPARTMENTS

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
HOSPITALS_DIR = PROJECT_ROOT / "hospitals"

def test_manifest_parsing():
    manifest_path = HOSPITALS_DIR / "manifest.json"
    assert manifest_path.exists(), "manifest.json should exist"

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    assert "version" in manifest
    assert "packs" in manifest
    assert isinstance(manifest["packs"], list)

    for pack in manifest["packs"]:
        assert "packId" in pack
        assert "facilityId" in pack
        assert "filePath" in pack
        assert "sizeBytes" in pack
        assert "versionHash" in pack

def test_department_schema_integrity():
    for dept_id, dept_info in DEPARTMENTS.items():
        assert "id" in dept_info
        assert "name" in dept_info
        assert "short_name" in dept_info
        assert "category" in dept_info
        assert "placeholder" in dept_info
        assert "notes_label" in dept_info
        assert "role_prompt" in dept_info
        assert "vocab_hint" in dept_info

def test_loading_all_configured_hospitals():
    hospitals = [
        "county_general",
        "duke_regional",
        "general_memorial",
        "general_memorial_cvor",
        "metro_medical",
        "princeton_plainsboro",
        "sacred_heart"
    ]
    departments = ["or", "icu", "er", "pacu"]

    for hospital in hospitals:
        if hospital == "general_memorial_cvor":
            tenant = get_tenant(hospital)
            assert tenant.tenant_id == hospital
            continue

        for dept in departments:
            tenant_id = f"{hospital}::{dept}"
            try:
                tenant = get_tenant(tenant_id)
                assert tenant.tenant_id == f"{hospital}/{dept}"
                assert hasattr(tenant, "display_name")
                assert hasattr(tenant, "inventory_path")
                assert hasattr(tenant, "orientation_path")
            except Exception as e:
                pytest.fail(f"Failed to load tenant {tenant_id} without missing key errors: {e}")
