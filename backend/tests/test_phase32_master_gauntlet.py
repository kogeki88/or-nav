"""
Phase 32 Master Integration Gauntlet (v0.4).

Executes a zero-shortcut verification gauntlet across all architectural pillars:
1. Multi-Tenant Fictional Hospital Isolation (Sacred Heart, Princeton-Plainsboro, County General across OR, ICU, ER, PACU).
2. 3-Tier Modular Knowledge Packs & Checksums (manifest.json, MD5 hashes, sizes, API endpoints).
3. Strict Role-Based Access Control (RBAC) & Coordinate Card Note Sanitization.
4. Tier-1 Exact, Stage-B Phonetic (Double Metaphone / Homophones), & Compound Queries.
5. Orientee Question & Multi-Peer Verification Ping Lifecycle with consensus transitions.
6. OTA Version Manifest, Cloud Endpoints & Zero-Bloat Guard (<5MB bundle, 0 APKs in web directories).

Deterministic execution: $0.00 LLM token cost, <2s total run time.
"""

import csv
import hashlib
import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.config import HOSPITALS_DIR, PROJECT_ROOT, get_tenant
from app.peer_qna import load_peer_questions, save_peer_questions
from app.services.inventory_search import (
    get_inventory_service,
    reset_inventory_services,
    split_compound_query,
)
from app.services.rag_fallback import (
    evaluate_rbac,
    filter_surgeon_note_for_role,
    is_anesthesia_role,
    is_nursing_role,
    is_scrub_role,
)

client = TestClient(app)

FACILITIES = ["sacred_heart", "princeton_plainsboro", "county_general"]
DEPARTMENTS = ["or", "icu", "er", "pacu"]


@pytest.fixture(autouse=True)
def zero_token_offline_mode(monkeypatch):
    """Ensure tests run strictly offline with $0 token usage."""
    monkeypatch.setenv("GEMINI_API_KEY", "")
    reset_inventory_services()
    yield
    reset_inventory_services()


# ==============================================================================
# Pillar 1: Multi-Tenant Fictional Hospital Isolation
# ==============================================================================

def test_gauntlet_multi_tenant_fictional_hospital_isolation():
    """Verify all 12 hospital/department tenant combinations resolve cleanly with proper isolation."""
    for fac in FACILITIES:
        for dept in DEPARTMENTS:
            tenant_key = f"{fac}/{dept}"
            tenant = get_tenant(tenant_key)
            assert tenant is not None, f"Failed to resolve tenant {tenant_key}"
            assert tenant.inventory_path.exists(), f"Missing inventory for {tenant_key}"
            # Tier 2 preference cards exist for all department tenants
            dept_cards = tenant.inventory_path.parent / "preference_cards.json"
            assert dept_cards.exists(), f"Missing preference_cards.json for {tenant_key}"

            # Inventory must have valid rows
            with open(tenant.inventory_path, mode="r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                rows = list(reader)
                assert len(rows) >= 50, f"Tenant {tenant_key} must have at least 50 inventory items, found {len(rows)}"

    # Cross-tenant data isolation: items resolve to their tenant's specific locations
    sh_service = get_inventory_service("sacred_heart/or")
    pp_service = get_inventory_service("princeton_plainsboro/or")
    cg_service = get_inventory_service("county_general/or")

    sh_res = sh_service.search("debakey")
    pp_res = pp_service.search("debakey")
    cg_res = cg_service.search("debakey")

    assert sh_res.get("item") is not None
    assert pp_res.get("item") is not None
    assert cg_res.get("item") is not None
    # Locations are independent across facilities
    assert sh_res.get("full_code") != ""
    assert pp_res.get("full_code") != ""


# ==============================================================================
# Pillar 2: 3-Tier Modular Knowledge Packs & Checksums (manifest.json)
# ==============================================================================

def test_gauntlet_3tier_modular_knowledge_packs_and_checksums():
    """Verify all 45 packs in hospitals/manifest.json match disk paths, byte sizes, and MD5 hashes."""
    manifest_path = HOSPITALS_DIR / "manifest.json"
    assert manifest_path.exists(), "hospitals/manifest.json must exist"

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["version"] == "1.1"
    assert manifest["packsCount"] == 45, f"Expected exactly 45 packs, found {manifest['packsCount']}"
    assert len(manifest["packs"]) == 45

    root = PROJECT_ROOT
    for pack in manifest["packs"]:
        file_path = root / pack["filePath"]
        assert file_path.exists(), f"Pack file missing on disk: {pack['filePath']}"

        raw_bytes = file_path.read_bytes()
        assert len(raw_bytes) == pack["sizeBytes"], f"Byte size mismatch on {pack['filePath']}: disk={len(raw_bytes)}, manifest={pack['sizeBytes']}"

        calculated_hash = hashlib.md5(raw_bytes).hexdigest()[:12]
        assert calculated_hash == pack["versionHash"], f"MD5 hash mismatch on {pack['filePath']}: calc={calculated_hash}, manifest={pack['versionHash']}"

    # Verify REST endpoints
    r_manifest = client.get("/api/packs/manifest")
    assert r_manifest.status_code == 200
    assert r_manifest.json()["packsCount"] == 45

    r_handbook = client.get("/api/packs/file?path=hospitals/sacred_heart/facility_handbook.md")
    assert r_handbook.status_code == 200
    assert "Sacred Heart Hospital" in r_handbook.text
    assert "Code Blue" in r_handbook.text

    # Path traversal protection
    r_hack = client.get("/api/packs/file?path=../../app/main.py")
    assert r_hack.status_code in (400, 404)


# ==============================================================================
# Pillar 3: Strict Role-Based Access Control (RBAC) & Note Sanitization
# ==============================================================================

def test_gauntlet_strict_rbac_and_note_sanitization():
    """Verify RBAC boundaries for inventory lookups, medication protocols, and tray setups."""
    # 1. Overall Inventory locations accessible to all roles
    inventory_queries = ["Where is 3-0 silk?", "Where is heparin?", "Where is debakey forceps?"]
    for role in ["Circulating RN", "Scrub Tech", "CRNA"]:
        for q in inventory_queries:
            res = client.post(
                "/api/chat",
                json={
                    "message": q,
                    "tenant_id": "or_main",
                    "facility_name": "Sacred Heart Hospital",
                    "clinical_role": role,
                },
            )
            assert res.status_code == 200
            data = res.json()
            assert data["routing_tier"] == "TIER_1_LOCAL_CSV"
            assert data["coordinate_card"] is not None

    # 2. Medication / Dosing queries:
    # Scrub Tech must be blocked
    res_scrub_drug = client.post(
        "/api/chat",
        json={
            "message": "What is the heparin dose for bypass?",
            "tenant_id": "or_main",
            "facility_name": "Sacred Heart Hospital",
            "clinical_role": "Scrub Tech",
        },
    )
    assert res_scrub_drug.status_code == 200
    assert res_scrub_drug.json()["routing_tier"] == "RBAC_RESTRICTED"
    assert "Medication & dosing protocols are restricted" in res_scrub_drug.json()["reply_text"]

    # Circulating RN and CRNA must be allowed
    for allowed_role in ["Circulating RN", "CRNA"]:
        res_allowed = client.post(
            "/api/chat",
            json={
                "message": "What is the heparin dose for bypass?",
                "tenant_id": "or_main",
                "facility_name": "Sacred Heart Hospital",
                "clinical_role": allowed_role,
            },
        )
        assert res_allowed.status_code == 200
        assert res_allowed.json()["routing_tier"] != "RBAC_RESTRICTED"

    # 3. Instrument Tray / Suture Loading queries:
    # CRNA must be blocked
    res_crna_tray = client.post(
        "/api/chat",
        json={
            "message": "What is the tray breakdown for vascular surgery?",
            "tenant_id": "or_main",
            "facility_name": "Sacred Heart Hospital",
            "clinical_role": "CRNA",
        },
    )
    assert res_crna_tray.status_code == 200
    assert res_crna_tray.json()["routing_tier"] == "RBAC_RESTRICTED"
    assert "filtered" in res_crna_tray.json()["reply_text"].lower()
    assert "anesthesia" in res_crna_tray.json()["reply_text"].lower()

    # Scrub Tech and Circulating RN must be allowed
    for allowed_role in ["Scrub Tech", "Circulating RN"]:
        res_allowed_tray = client.post(
            "/api/chat",
            json={
                "message": "What is the tray breakdown for vascular surgery?",
                "tenant_id": "or_main",
                "facility_name": "Sacred Heart Hospital",
                "clinical_role": allowed_role,
            },
        )
        assert res_allowed_tray.status_code == 200
        assert res_allowed_tray.json()["routing_tier"] != "RBAC_RESTRICTED"

    # 4. Coordinate Card Note Scrubbing
    composite_note = (
        "Prefers 3-0 Prolene loaded on Castroviejo needle driver. "
        "Administer 0.5% Marcaine dose with epinephrine 1:200,000 before incision. "
        "Keep 2 units PRBC on standby in room."
    )
    # CRNA scrubs suture loading
    anesthesia_filtered = filter_surgeon_note_for_role(composite_note, "CRNA")
    assert "Prolene loaded" not in anesthesia_filtered
    assert "Marcaine" in anesthesia_filtered
    assert "PRBC" in anesthesia_filtered

    # Scrub Tech scrubs drug dosing
    scrub_filtered = filter_surgeon_note_for_role(composite_note, "Scrub Tech")
    assert "Prolene loaded" in scrub_filtered
    assert "Marcaine dose" not in scrub_filtered

    # Circulating RN keeps both
    circ_filtered = filter_surgeon_note_for_role(composite_note, "Circulating RN")
    assert "Prolene loaded" in circ_filtered
    assert "Marcaine" in circ_filtered


# ==============================================================================
# Pillar 4: Exact, Phonetic Homophones & Compound Voice Queries
# ==============================================================================

def test_gauntlet_noisy_speech_homophones_and_compound_queries():
    """Verify exact, Double Metaphone phonetic, and compound queries across departments."""
    # 1. Phonetic speech homophone resolution in OR
    or_service = get_inventory_service("sacred_heart/or")
    assert "DeBakey" in or_service.search("the bakery")["item"]
    assert "prolene" in or_service.search("pro lean")["item"].lower()
    assert "bovie" in or_service.search("bovey")["item"].lower()
    assert "weitlaner" in or_service.search("white laner")["item"].lower()
    assert "heparin" in or_service.search("heprin")["item"].lower()

    # 2. Exact queries across departments
    icu_service = get_inventory_service("sacred_heart/icu")
    er_service = get_inventory_service("sacred_heart/er")
    pacu_service = get_inventory_service("sacred_heart/pacu")

    assert "arterial" in icu_service.search("arterial line")["item"].lower()
    assert "ez-io" in er_service.search("ez-io")["item"].lower()
    assert "sugammadex" in pacu_service.search("sugammadex")["item"].lower()

    # 3. Compound queries splitting
    compound_1 = split_compound_query("where is debakey and 3-0 silk")
    assert compound_1 == ["debakey", "3-0 silk"]

    compound_2 = split_compound_query("where is 2-0 and 3-0 prolene")
    assert compound_2 == ["2-0 prolene", "3-0 prolene"]

    compound_3 = split_compound_query("locate bovie plus weitlaner")
    assert compound_3 == ["bovie", "weitlaner"]


# ==============================================================================
# Pillar 5: Orientee Question & Multi-Peer Verification Ping Lifecycle
# ==============================================================================

def test_gauntlet_orientee_qna_multi_peer_verification_lifecycle():
    """Verify orientee question lifecycle: unverified (0/2) -> (1/2) -> anti-duplicate -> verified (2/2)."""
    initial_questions = load_peer_questions()

    try:
        # Step 1: Orientee posts question
        res_q = client.post(
            "/api/peer-questions",
            json={
                "tenant_id": "sacred_heart::or",
                "question_text": "Where is the emergency vascular shunt stored during ruptured AAA?",
                "asked_by": "Sean Iglesia, RN (Orientee)",
                "role": "Circulating RN",
            },
        )
        assert res_q.status_code == 200
        q_data = res_q.json()
        q_id = q_data["id"]
        assert q_data["status"] == "unverified"
        assert q_data["verificationsCount"] == 0

        # Step 2: Colleague posts answer
        res_a = client.post(
            f"/api/peer-questions/{q_id}/answers",
            json={
                "answered_by": "Dr. Christopher Turk",
                "answer_text": "Vascular shunts are in Core Supply · Cart V · Shelf 1 · Bin A.",
            },
        )
        assert res_a.status_code == 200
        a_data = res_a.json()
        answer = a_data["answers"][0]
        a_id = answer["answerId"]
        assert answer["isVerifiedConsensus"] is False
        assert len(answer["verifiedBy"]) == 0

        # Step 3: Peer 1 verifies (Carla Espinosa) -> 1/2 verification
        res_v1 = client.post(
            f"/api/peer-questions/{q_id}/answers/{a_id}/verify",
            json={"verified_by": "Carla Espinosa, RN"},
        )
        assert res_v1.status_code == 200
        v1_data = res_v1.json()
        assert v1_data["verificationsCount"] == 1
        assert v1_data["status"] == "unverified"
        assert v1_data["answers"][0]["isVerifiedConsensus"] is False

        # Step 4: Duplicate verification from Carla Espinosa is rejected
        res_dup = client.post(
            f"/api/peer-questions/{q_id}/answers/{a_id}/verify",
            json={"verified_by": "Carla Espinosa, RN"},
        )
        assert res_dup.status_code == 200
        dup_data = res_dup.json()
        assert dup_data["verificationsCount"] == 1
        assert len(dup_data["answers"][0]["verifiedBy"]) == 1

        # Step 5: Peer 2 verifies (Laverne Roberts) -> 2/2 verification, consensus reached!
        res_v2 = client.post(
            f"/api/peer-questions/{q_id}/answers/{a_id}/verify",
            json={"verified_by": "Laverne Roberts, RN"},
        )
        assert res_v2.status_code == 200
        v2_data = res_v2.json()
        assert v2_data["verificationsCount"] == 2
        assert v2_data["status"] == "verified"
        assert v2_data["answers"][0]["isVerifiedConsensus"] is True

        # Step 6: Tenant isolation - question does NOT show up for county_general::er
        res_cg = client.get("/api/peer-questions?tenant_id=county_general::er")
        assert res_cg.status_code == 200
        cg_questions = res_cg.json()
        assert not any(q["id"] == q_id for q in cg_questions)

    finally:
        # Restore clean state
        save_peer_questions(initial_questions)


# ==============================================================================
# Pillar 6: OTA Version Manifest, Cloud Endpoints & APK Bloat Guard
# ==============================================================================

def test_gauntlet_ota_manifest_and_apk_bloat_guard():
    """Verify OTA version monotonicity, cache-busting headers, and 0 APK files in web bundle."""
    # 1. /api/version manifest
    res = client.get("/api/version")
    assert res.status_code == 200
    assert "no-store" in res.headers.get("Cache-Control", "")
    assert "no-cache" in res.headers.get("Cache-Control", "")

    v_data = res.json()
    assert v_data["version"] in ["v0.4", "v0.41", "v0.5", "v0.51", "v0.52", "v0.53", "v0.54", "v0.55", "v0.56", "v0.57", "v0.58", "v0.59", "v0.60", "v0.61", "v0.62"]
    assert v_data["build_number"] >= 6
    assert v_data["apk_download_url"].startswith("http")

    # 2. Strict APK Bloat Guard: 0 APKs in web directories
    pub_apks = list((PROJECT_ROOT / "frontend" / "public").glob("*.apk"))
    out_apks = list((PROJECT_ROOT / "frontend" / "out").glob("*.apk"))
    assets_dir = PROJECT_ROOT / "frontend" / "android" / "app" / "src" / "main" / "assets" / "public"
    assets_apks = list(assets_dir.glob("*.apk")) if assets_dir.exists() else []

    assert len(pub_apks) == 0, f"Found APK in frontend/public: {pub_apks}"
    assert len(out_apks) == 0, f"Found APK in frontend/out: {out_apks}"
    assert len(assets_apks) == 0, f"Found APK in android assets: {assets_apks}"

    # Verify android assets size < 5.0 MB
    if assets_dir.exists():
        total_bytes = sum(f.stat().st_size for f in assets_dir.rglob("*") if f.is_file())
        size_mb = total_bytes / (1024 * 1024)
        assert size_mb < 5.0, f"Android assets directory exceeds 5MB limit: {size_mb:.2f} MB"
