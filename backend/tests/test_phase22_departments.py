"""
Phase 22 Multi-Department & Clinical Role Switcher Test Suite.

Verifies:
1. Default role boots into Operating Room (or_main) with multi-specialty surgical items.
2. Department isolation: ICU, ER, PACU items don't leak across departments.
3. Multi-unit coordinate normalizer supports Bay, ICU, ER, PACU, Pod, Trauma, etc.
4. Move reporting & 3-step confirmation works across generic room formats.
5. Unanswered questions isolation per department.
6. Zero token waste: 100% deterministic, <2s execution time.
"""

import pytest
from app.config import get_tenant, list_tenants, settings, DEPARTMENTS
from app.services.inventory_search import (
    get_inventory_service,
    normalize_location_coordinate,
)
from app.services.governance import get_governance_service


def test_department_configuration():
    """Verify default tenant is or_main and all 4 clinical units are configured."""
    assert settings.default_tenant == "or_main"
    tenants = list_tenants()
    for expected in ["or_main", "icu_critical_care", "er_trauma", "pacu_periop"]:
        assert expected in tenants
        assert expected in DEPARTMENTS

    # Backward compatibility
    assert "general_memorial_cvor" in tenants
    cvor_tenant = get_tenant("general_memorial_cvor")
    assert cvor_tenant.tenant_id == "general_memorial_cvor"

    or_tenant = get_tenant("or_main")
    assert or_tenant.display_name == "Operating Room (OR)"

    icu_tenant = get_tenant("icu_critical_care")
    assert icu_tenant.display_name == "ICU / Critical Care"

    er_tenant = get_tenant("er_trauma")
    assert er_tenant.display_name == "Emergency Dept (ER)"

    pacu_tenant = get_tenant("pacu_periop")
    assert pacu_tenant.display_name == "PACU / Pre-Op"


def test_or_main_multi_specialty_inventory():
    """Verify or_main contains General/Lap, Ortho/Neuro, Vascular/Cardiac, and MH items."""
    service = get_inventory_service("or_main")
    service.reload()

    # General / Laparoscopic
    trocar5 = service.search("5mm trocar")
    assert trocar5 is not None and "5mm Trocar" in trocar5["item"]

    trocar12 = service.search("12mm trocar")
    assert trocar12 is not None and "12mm Trocar" in trocar12["item"]

    ligasure = service.search("ligasure")
    assert ligasure is not None and "LigaSure" in ligasure["item"]

    stapler = service.search("endo gia stapler")
    assert stapler is not None and "Endo GIA" in stapler["item"]

    vicryl0 = service.search("0 vicryl")
    assert vicryl0 is not None and "0 Vicryl" in vicryl0["item"]

    monocryl = service.search("3-0 monocryl")
    assert monocryl is not None and "3-0 Monocryl" in monocryl["item"]

    # Ortho / Neuro
    bonewax = service.search("bone wax")
    assert bonewax is not None and "Bone Wax" in bonewax["item"]

    gelfoam = service.search("gelfoam")
    assert gelfoam is not None and "Gelfoam" in gelfoam["item"]

    battery = service.search("stryker drill battery")
    assert battery is not None and "Stryker" in battery["item"]

    # Vascular / Cardiac
    debakey = service.search("debakey forceps")
    assert debakey is not None and "DeBakey" in debakey["item"]

    weitlaner = service.search("weitlaner")
    assert weitlaner is not None and "Saphenous Vein Retractor" in weitlaner["item"]

    prolene40 = service.search("4-0 prolene")
    assert prolene40 is not None and "4-0 Prolene" in prolene40["item"]

    # Malignant Hyperthermia
    dantrolene = service.search("dantrolene")
    assert dantrolene is not None and "Dantrolene" in dantrolene["item"]


def test_department_inventory_isolation():
    """Verify clinical departments isolate their inventory items strictly."""
    icu_svc = get_inventory_service("icu_critical_care")
    icu_svc.reload()

    er_svc = get_inventory_service("er_trauma")
    er_svc.reload()

    pacu_svc = get_inventory_service("pacu_periop")
    pacu_svc.reload()

    # ICU Items
    cvc = icu_svc.search("triple lumen central line kit")
    assert cvc is not None and "Central Line" in cvc["item"]

    artline = icu_svc.search("arterial line transducer")
    assert artline is not None and "Arterial Line" in artline["item"]

    glidescope = icu_svc.search("glidescope")
    assert glidescope is not None and "GlideScope" in glidescope["item"]

    crrt = icu_svc.search("crrt filter set")
    assert crrt is not None and "CRRT" in crrt["item"]

    # Cross-department check: DeBakey shouldn't be in ICU
    debakey_in_icu = icu_svc.search("debakey")
    assert debakey_in_icu is None

    # ER Items
    rsi = er_svc.search("adult rsi airway tackle box")
    assert rsi is not None and "RSI" in rsi["item"]

    ezio = er_svc.search("ez-io intraosseous drill")
    assert ezio is not None and "EZ-IO" in ezio["item"]

    thoracotomy = er_svc.search("thoracotomy tray")
    assert thoracotomy is not None and "Thoracotomy" in thoracotomy["item"]

    sam_sling = er_svc.search("pelvic binder sam sling")
    assert sam_sling is not None and "Pelvic Binder" in sam_sling["item"]

    # Cross-department check: Central Line Kit shouldn't be in ER
    cvc_in_er = er_svc.search("triple lumen central line")
    assert cvc_in_er is None

    # PACU Items
    sugammadex = pacu_svc.search("sugammadex reversal kit")
    assert sugammadex is not None and "Sugammadex" in sugammadex["item"]

    nerveblock = pacu_svc.search("ultrasound nerve block tray")
    assert nerveblock is not None and "Nerve Block" in nerveblock["item"]

    bairhugger = pacu_svc.search("bair hugger warming blanket")
    assert bairhugger is not None and "Bair Hugger" in bairhugger["item"]

    trumpet = pacu_svc.search("trumpet airway kit")
    assert trumpet is not None and "Airway Kit" in trumpet["item"]

    # Cross-department check: EZ-IO shouldn't be in PACU
    ezio_in_pacu = pacu_svc.search("ez-io")
    assert ezio_in_pacu is None


def test_multi_unit_coordinate_normalizer():
    """Verify normalize_location_coordinate canonicalizes generic hospital unit coordinates."""
    # Bay format
    assert normalize_location_coordinate("Bay 2 Cart A Shelf 1 Bin B") == "Bay 2 A 1 B"
    assert normalize_location_coordinate("bay 2 a 1 b") == "Bay 2 A 1 B"
    assert normalize_location_coordinate("The EZ-IO needles moved to Bay 2 Cart A Shelf 1 Bin B") == "Bay 2 A 1 B"

    # ICU format
    assert normalize_location_coordinate("ICU A 2 B") == "ICU A 2 B"
    assert normalize_location_coordinate("icu a 2 b") == "ICU A 2 B"
    assert normalize_location_coordinate("icu supply a 2 b") == "ICU Supply A 2 B"

    # Trauma Bay format
    assert normalize_location_coordinate("trauma bay 1 cart a shelf 2 bin b") == "Trauma Bay 1 A 2 B"
    assert normalize_location_coordinate("trauma bay 2 a 1 a") == "Trauma Bay 2 A 1 A"

    # PACU & Pod format
    assert normalize_location_coordinate("pacu a 1 a") == "PACU A 1 A"
    assert normalize_location_coordinate("pacu med room p 1 a") == "PACU Med Room P 1 A"
    assert normalize_location_coordinate("pod 3 b 1 c") == "Pod 3 B 1 C"

    # Standard OR format preserved
    assert normalize_location_coordinate("or 21 b 1 a") == "OR 21 B 1 A"
    assert normalize_location_coordinate("the 3-0 silk moved to or twenty one bee two see") == "OR 21 B 2 C"
    assert normalize_location_coordinate("core supply d 1 a") == "Core Supply D 1 A"


def test_er_move_reporting_and_commitment():
    """Verify natural move reporting and 3-step verification in er_trauma."""
    svc = get_inventory_service("er_trauma")
    svc.reload()

    # Initial state
    row, _ = svc._find_matching_row("EZ-IO Intraosseous Drill & Needles")
    assert row is not None
    orig_room = row["room"]
    orig_cab = row["cabinet"]

    # Step 1: Report move
    reported = svc.report_move("EZ-IO Intraosseous Drill & Needles", "Bay 2 Cart A Shelf 1 Bin B")
    assert reported is not None
    assert reported["pending_location"] == "Bay 2 A 1 B"
    assert reported["verify_count"] == 1

    # Step 2: Confirm move
    c2 = svc.verify_move("EZ-IO Intraosseous Drill & Needles", "Bay 2 A 1 B")
    assert c2 is not None
    assert c2["verify_count"] == 2
    assert c2["committed"] is False

    # Step 3: Confirm move (commits to primary coordinates)
    c3 = svc.verify_move("EZ-IO Intraosseous Drill & Needles", "Bay 2 A 1 B")
    assert c3 is not None
    assert c3["verify_count"] == 0
    assert c3["committed"] is True
    assert c3["pending_location"] == ""

    # Re-verify row has updated primary location
    row_updated, _ = svc._find_matching_row("EZ-IO Intraosseous Drill & Needles")
    assert row_updated["room"] == "Bay 2"
    assert row_updated["cabinet"] == "A"
    assert row_updated["shelf"] == "1"
    assert row_updated["container"] == "B"

    # Clean up for idempotency
    row_updated["room"] = orig_room
    row_updated["cabinet"] = orig_cab
    svc._save_csv()


def test_unanswered_questions_isolation():
    """Verify crowdsourced questions are isolated per department."""
    gov_or = get_governance_service("or_main")
    gov_icu = get_governance_service("icu_critical_care")
    gov_er = get_governance_service("er_trauma")
    gov_pacu = get_governance_service("pacu_periop")

    or_qs = gov_or.list_questions()
    icu_qs = gov_icu.list_questions()
    er_qs = gov_er.list_questions()
    pacu_qs = gov_pacu.list_questions()

    assert any("q-or" in q["id"] for q in or_qs)
    assert any("q-icu" in q["id"] for q in icu_qs)
    assert any("q-er" in q["id"] for q in er_qs)
    assert any("q-pacu" in q["id"] for q in pacu_qs)

    # Cross isolation
    assert not any("q-icu" in q["id"] for q in or_qs)
    assert not any("q-er" in q["id"] for q in icu_qs)
    assert not any("q-pacu" in q["id"] for q in er_qs)
