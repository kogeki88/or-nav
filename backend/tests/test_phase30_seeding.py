"""
Phase 30 Test Suite: Comprehensive Clinical Data Seeding & Multi-Tier Knowledge Packs.

Verifies:
1. Tier 1 Facility Handbooks for all facilities covering emergency response, blood bank, SSI bundles, sharp injury.
2. Tier 2 Department Inventories with 50+ coordinate rows and valid CSV schema across OR, ICU, ER, PACU.
3. Tier 2 Preference Cards covering Lap Chole, TKA, CABG, Robotic, Spine, Trauma, EVAR, CRRT, Lines, RSI, etc.
4. Tier 3 Role Guides for Scrub Tech, Circulator, CRNA, ICU RN, ER RN with case-by-case setups.
5. Manifest integrity (hospitals/manifest.json) matching exact disk paths, sizes, and MD5 hashes.
6. Backend endpoints (/api/packs/manifest and /api/packs/file).
7. Role-based RAG query resolution and RBAC scoping.
"""

import csv
import hashlib
import json
from pathlib import Path
from fastapi.testclient import TestClient

from app.main import app
from app.config import HOSPITALS_DIR, get_tenant
from app.services.rag_fallback import RAGService, evaluate_rbac

client = TestClient(app)

FACILITIES = ["sacred_heart", "princeton_plainsboro", "county_general"]
DEPARTMENTS = ["or", "icu", "er", "pacu"]


def test_tier1_facility_handbooks():
    """Verify all facility handbooks exist and contain required clinical sections."""
    for fac in FACILITIES:
        hb_path = HOSPITALS_DIR / fac / "facility_handbook.md"
        assert hb_path.exists(), f"Missing handbook: {hb_path}"
        content = hb_path.read_text(encoding="utf-8")
        assert len(content) > 1500, f"Handbook too short for {fac}"

        # Emergency Response & Codes
        assert "Code Blue" in content
        assert "Code Red" in content
        assert "Code Amber" in content
        assert ("Massive Hemorrhage" in content or "Massive Transfusion" in content)

        # Blood Bank & Specimen Chain of Custody
        assert "Type & Screen" in content
        assert "Blood Bank" in content
        assert "Frozen Section" in content or "Specimen" in content
        assert "Formalin" in content or "formal" in content

        # Infection Control & SSI
        assert ("SSI" in content or "Surgical Site Infection" in content or "Infection" in content)
        assert ("ChloraPrep" in content or "CHG" in content or "Prep" in content)
        assert ("Exposure" in content or "Sharp" in content or "Needlestick" in content)


def test_tier2_department_inventories():
    """Verify each department inventory has 50+ items and required clinical categories."""
    for fac in FACILITIES:
        for dept in DEPARTMENTS:
            inv_path = HOSPITALS_DIR / fac / dept / "inventory.csv"
            assert inv_path.exists(), f"Missing inventory: {inv_path}"

            with open(inv_path, mode="r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                rows = list(reader)

            assert len(rows) >= 50, f"Expected 50+ items in {inv_path}, found {len(rows)}"

            # Column verification
            expected_headers = [
                "item", "category", "room", "cabinet", "shelf",
                "container", "aliases", "pending_location", "verify_count",
                "surgeon_notes", "human_alias", "verification_score", "status", "last_verified_at"
            ]
            for h in expected_headers:
                assert h in rows[0], f"Header {h} missing in {inv_path}"

            item_names = [r["item"].lower() for r in rows]

            if dept == "or":
                # Verify surgical instruments, energy devices, sutures, hemostatics, medications
                assert any("debakey" in n for n in item_names)
                assert any("bovie" in n or "ligasure" in n or "harmonic" in n for n in item_names)
                assert any("prolene" in n or "silk" in n or "vicryl" in n for n in item_names)
                assert any("heparin" in n or "dantrolene" in n or "marcaine" in n for n in item_names)
            elif dept == "icu":
                # Verify lines, crrt, airway, pressors
                assert any("artery" in n or "transducer" in n for n in item_names)
                assert any("glidescope" in n or "endotracheal" in n for n in item_names)
                assert any("norepinephrine" in n or "vasopressin" in n for n in item_names)
            elif dept == "er":
                # Verify trauma, rsi, thoracostomy, pelvic binder
                assert any("pelvic" in n or "tourniquet" in n for n in item_names)
                assert any("etomidate" in n or "rocuronium" in n or "rsi" in n for n in item_names)
                assert any("chest tube" in n or "thoracostomy" in n or "belmont" in n for n in item_names)
            elif dept == "pacu":
                # Verify emergence, warmers, antiemetics, reversals
                assert any("bair hugger" in n or "warming" in n for n in item_names)
                assert any("zofran" in n or "ondansetron" in n for n in item_names)
                assert any("sugammadex" in n or "narcan" in n or "naloxone" in n for n in item_names)


def test_tier2_preference_cards():
    """Verify preference cards are valid JSON and contain high-frequency procedures."""
    for fac in FACILITIES:
        for dept in DEPARTMENTS:
            cards_path = HOSPITALS_DIR / fac / dept / "preference_cards.json"
            assert cards_path.exists(), f"Missing preference cards: {cards_path}"
            data = json.loads(cards_path.read_text(encoding="utf-8"))
            assert isinstance(data, list)
            assert len(data) >= 4

            procs = [c["procedure"].lower() for c in data]
            if dept == "or":
                assert any("chole" in p for p in procs)
                assert any("knee" in p for p in procs)
                assert any("cabg" in p for p in procs)
                assert any("prostate" in p for p in procs)
                assert any("discectomy" in p for p in procs)
                assert any("laparotomy" in p for p in procs)
                assert any("aneurysm" in p or "evar" in p for p in procs)
            elif dept == "icu":
                assert any("crrt" in p for p in procs)
                assert any("arterial" in p for p in procs)
                assert any("central" in p or "cvc" in p for p in procs)
                assert any("icp" in p for p in procs)
            elif dept == "er":
                assert any("rsi" in p for p in procs)
                assert any("chest tube" in p or "thoracostomy" in p for p in procs)
                assert any("transfusion" in p or "mtp" in p for p in procs)
                assert any("pelvic" in p for p in procs)
            elif dept == "pacu":
                assert any("aldrete" in p for p in procs)
                assert any("laryngospasm" in p for p in procs)
                assert any("pca" in p for p in procs)
                assert any("nausea" in p or "shivering" in p for p in procs)


def test_tier3_role_guides():
    """Verify role guides cover Mayo stands, positioning, drug dosing, and emergency workflows."""
    for fac in FACILITIES:
        or_roles = HOSPITALS_DIR / fac / "or" / "roles"
        assert (or_roles / "scrub.md").exists()
        assert (or_roles / "circulator.md").exists()
        assert (or_roles / "crna.md").exists()

        scrub_content = (or_roles / "scrub.md").read_text(encoding="utf-8")
        assert "Mayo Stand" in scrub_content
        assert "Passing Order" in scrub_content
        assert "Count" in scrub_content
        assert "Lap Chole" in scrub_content or "Cholecystectomy" in scrub_content

        circ_content = (or_roles / "circulator.md").read_text(encoding="utf-8")
        assert "Timeout" in circ_content or "Time-Out" in circ_content
        assert "Positioning" in circ_content
        assert "Grounding Pad" in circ_content or "ESU" in circ_content

        crna_content = (or_roles / "crna.md").read_text(encoding="utf-8")
        assert "Airway" in crna_content
        assert "Malignant Hyperthermia" in crna_content or "Dantrolene" in crna_content
        assert "Norepinephrine" in crna_content or "Levophed" in crna_content
        assert "ACT" in crna_content or "Heparin" in crna_content


def test_hospitals_manifest_integrity():
    """Verify hospitals/manifest.json matches disk files, exact byte sizes, and MD5 hashes."""
    manifest_path = HOSPITALS_DIR / "manifest.json"
    assert manifest_path.exists()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    assert manifest["version"] == "1.1"
    assert manifest["packsCount"] >= 45
    assert len(manifest["packs"]) == manifest["packsCount"]

    root = HOSPITALS_DIR.parent
    for pack in manifest["packs"]:
        fpath = root / pack["filePath"]
        assert fpath.exists(), f"Pack file not on disk: {pack['filePath']}"
        raw = fpath.read_bytes()
        assert len(raw) == pack["sizeBytes"], f"Size mismatch on {pack['filePath']}"
        expected_hash = hashlib.md5(raw).hexdigest()[:12]
        assert expected_hash == pack["versionHash"], f"Hash mismatch on {pack['filePath']}"


def test_backend_packs_api_endpoints():
    """Verify backend endpoints /api/packs/manifest and /api/packs/file return valid payloads."""
    r_man = client.get("/api/packs/manifest")
    assert r_man.status_code == 200
    data = r_man.json()
    assert data["packsCount"] >= 45

    # Fetch a sample pack file
    r_file = client.get("/api/packs/file?path=hospitals/sacred_heart/facility_handbook.md")
    assert r_file.status_code == 200
    assert "Sacred Heart Hospital" in r_file.text
    assert "Code Blue" in r_file.text

    # Path traversal rejection
    r_bad = client.get("/api/packs/file?path=../backend/app/main.py")
    assert r_bad.status_code in (400, 404)


def test_role_based_rag_resolution():
    """Verify RAGService offline fallback resolves seeded packs according to clinical role."""
    tenant = get_tenant("or_main")
    rag = RAGService(tenant)

    # 1. Scrub Tech asks about Lap Chole
    reply_scrub, _ = rag._offline_fallback("What are the suture preferences for Lap Chole?", clinical_role="Scrub Tech")
    assert "Preference Card: Laparoscopic Cholecystectomy" in reply_scrub
    assert "Suture Preferences" in reply_scrub

    # 2. Circulator asks about Lap Chole
    reply_circ, _ = rag._offline_fallback(
        "What is the patient positioning for Lap Chole?", clinical_role="Circulating RN")
    assert "Preference Card: Laparoscopic Cholecystectomy" in reply_circ
    assert "Reverse Trendelenburg" in reply_circ or "Positioning" in reply_circ

    # 3. CRNA asks about Malignant Hyperthermia
    reply_crna, _ = rag._offline_fallback(
        "What is the dose for Dantrolene in Malignant Hyperthermia?", clinical_role="CRNA")
    assert "Dantrolene" in reply_crna or "Ryanodex" in reply_crna
    assert "2.5 mg/kg" in reply_crna or "MHAUS" in reply_crna

    # 4. RBAC restriction: Scrub Tech asking about drug dosing
    is_allowed, denial = evaluate_rbac("What is the dose for heparin?", clinical_role="Scrub Tech")
    assert not is_allowed
    assert "restricted" in denial.lower() or "nursing" in denial.lower()

    # 5. RBAC restriction: CRNA asking about instrument setup
    is_allowed, denial = evaluate_rbac("What is the tray setup for lap chole?", clinical_role="CRNA")
    assert not is_allowed
    assert "filtered" in denial.lower() or "anesthesia" in denial.lower()
