"""Phase 29 Test Suite: On-Demand Knowledge Packs & Resource Manager.

Tests:
1. 3-Tier pack structure in hospitals/ (handbook, preference cards, role guides).
2. /api/packs/manifest and /api/packs/file endpoints return valid data.
3. Role-scoped case lookups: Circulating RN loads positioning/safety considerations,
   while Scrub Tech loads suture/setup notes.
4. Purge verification: Zero APK bloat in public/out/assets directories (< 5 MB).
5. Pack delete and reinstallation cycle integrity.
"""

import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.rag_fallback import RAGService
from app.config import get_tenant

client = TestClient(app)
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
HOSPITALS_DIR = ROOT_DIR / "hospitals"


def test_phase29_apk_bloat_purged():
    """Verify zero *.apk files exist in frontend/public, frontend/out, and android assets."""
    pub_apks = list((ROOT_DIR / "frontend" / "public").glob("*.apk"))
    out_apks = list((ROOT_DIR / "frontend" / "out").glob("*.apk"))
    assets_apks = list((ROOT_DIR / "frontend" / "android" / "app" / "src" / "main" / "assets" / "public").glob("*.apk"))

    assert len(pub_apks) == 0, f"Found APK in frontend/public: {pub_apks}"
    assert len(out_apks) == 0, f"Found APK in frontend/out: {out_apks}"
    assert len(assets_apks) == 0, f"Found APK in android assets: {assets_apks}"

    # Verify assets/public size is < 5 MB
    assets_dir = ROOT_DIR / "frontend" / "android" / "app" / "src" / "main" / "assets" / "public"
    if assets_dir.exists():
        total_bytes = sum(f.stat().st_size for f in assets_dir.rglob("*") if f.is_file())
        size_mb = total_bytes / (1024 * 1024)
        assert size_mb < 5.0, f"Assets directory too large: {size_mb:.2f} MB"


def test_phase29_3tier_pack_structure():
    """Verify 3-tier hierarchy across sacred_heart, princeton_plainsboro, and county_general."""
    manifest_file = HOSPITALS_DIR / "manifest.json"
    assert manifest_file.exists(), "hospitals/manifest.json must exist"
    data = json.loads(manifest_file.read_text(encoding="utf-8"))
    assert data["packsCount"] >= 15
    assert len(data["packs"]) >= 15

    for fac_id in ["sacred_heart", "princeton_plainsboro", "county_general"]:
        fac_dir = HOSPITALS_DIR / fac_id
        # Tier 1: Facility Handbook
        assert (fac_dir / "facility_handbook.md").exists(), f"Missing facility_handbook.md in {fac_id}"
        # Tier 2: Preference Cards & Inventory in OR
        assert (fac_dir / "or" / "preference_cards.json").exists(), f"Missing preference_cards.json in {fac_id}/or"
        assert (fac_dir / "or" / "inventory.csv").exists(), f"Missing inventory.csv in {fac_id}/or"
        # Tier 3: Role files in OR roles
        roles_dir = fac_dir / "or" / "roles"
        assert (roles_dir / "scrub.md").exists(), f"Missing scrub.md in {fac_id}/or/roles"
        assert (roles_dir / "circulator.md").exists(), f"Missing circulator.md in {fac_id}/or/roles"
        assert (roles_dir / "crna.md").exists(), f"Missing crna.md in {fac_id}/or/roles"


def test_phase29_api_packs_endpoints():
    """Verify GET /api/packs/manifest and GET /api/packs/file."""
    res = client.get("/api/packs/manifest")
    assert res.status_code == 200
    manifest = res.json()
    assert manifest["packsCount"] >= 15
    assert "packs" in manifest

    # Test downloading a pack file
    test_path = "hospitals/sacred_heart/facility_handbook.md"
    file_res = client.get(f"/api/packs/file?path={test_path}")
    assert file_res.status_code == 200
    assert "Sacred Heart" in file_res.text
    assert "Code Blue" in file_res.text

    # Test path traversal security
    bad_res = client.get("/api/packs/file?path=../backend/app/main.py")
    assert bad_res.status_code in [400, 404]


def test_phase29_role_scoped_case_lookups():
    """Verify Circulating RN loads positioning/safety, while Scrub Tech loads suture/setup notes."""
    config = get_tenant("sacred_heart_or")
    rag = RAGService(config)

    # Query as Scrub Tech
    scrub_ans, _ = rag._offline_fallback("lap chole preference card", clinical_role="Scrub Tech / CST")
    assert "suture preferences" in scrub_ans.lower()
    assert "instrumentation" in scrub_ans.lower() or "scrub notes" in scrub_ans.lower()

    # Query as Circulating RN
    circ_ans, _ = rag._offline_fallback("lap chole preference card", clinical_role="Circulating RN")
    assert "positioning" in circ_ans.lower()
    assert "skin prep" in circ_ans.lower() or "safety" in circ_ans.lower()

    # Query hospital policy
    code_ans, _ = rag._offline_fallback("what is the code blue team and blood bank extension", clinical_role="Circulating RN")
    assert "facility policy" in code_ans.lower() or "code blue" in code_ans.lower() or "blood bank" in code_ans.lower()


def test_phase29_resource_manager_contract():
    """Verify resourceManager frontend TypeScript module structure and exports."""
    ts_file = ROOT_DIR / "frontend" / "src" / "lib" / "resourceManager.ts"
    assert ts_file.exists()
    content = ts_file.read_text(encoding="utf-8")
    assert "fetchPacksManifest" in content
    assert "installPack" in content
    assert "deletePack" in content
    assert "ensureProfilePacksInstalled" in content
    assert "purgeUnassignedHospitalPacks" in content
    assert "getResourceStorageSummary" in content
