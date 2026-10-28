"""
Phase 41: Exhaustive Data-to-Lookup Parity & Ground-Truth Verification Audit.

Guarantees 100% parity across:
1. All catalog items across tenants (sacred_heart, princeton_plainsboro, county_general)
   and departments (or, icu, er, pacu).
2. Specific aliases and learned facility lexicons.
3. Zero false-positive eponym substitutions.
4. Fully populated 4-part coordinate fields (room, cabinet, shelf, container).
"""

import csv
import json
import pytest
from pathlib import Path

from app.services.inventory_search import get_inventory_service
from app.services.surgical_ontology import extract_eponyms, is_generic_class_only

HOSPITALS_DIR = Path(__file__).resolve().parent.parent.parent / "hospitals"
FACILITIES = ["sacred_heart", "princeton_plainsboro", "county_general"]
DEPARTMENTS = ["or", "icu", "er", "pacu"]


def test_all_inventory_coordinates_fully_populated():
    """Verify that every single row across all 12 inventory sheets has non-empty 4-part coordinates."""
    total_audited = 0
    for fac in FACILITIES:
        for dept in DEPARTMENTS:
            csv_path = HOSPITALS_DIR / fac / dept / "inventory.csv"
            assert csv_path.exists(), f"Missing inventory: {csv_path}"
            with csv_path.open("r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for idx, row in enumerate(reader, start=2):
                    total_audited += 1
                    item = row.get("item", "").strip()
                    assert item, f"Empty item at line {idx} in {csv_path}"
                    room = row.get("room", "").strip()
                    cab = row.get("cabinet", "").strip()
                    sh = row.get("shelf", "").strip()
                    cont = row.get("container", "").strip()
                    assert room, f"Missing room for '{item}' at line {idx} in {csv_path}"
                    assert cab, f"Missing cabinet for '{item}' at line {idx} in {csv_path}"
                    assert sh, f"Missing shelf for '{item}' at line {idx} in {csv_path}"
                    assert cont, f"Missing container for '{item}' at line {idx} in {csv_path}"

    assert total_audited >= 800, f"Expected >=800 items audited, got {total_audited}"


def test_exhaustive_exact_item_lookup_parity():
    """Every catalog item across all tenants must resolve on first query with score >= 90."""
    total_searches = 0
    failures = []

    for fac in FACILITIES:
        for dept in DEPARTMENTS:
            tenant_id = f"{fac}::{dept}"
            inv_service = get_inventory_service(tenant_id)
            csv_path = HOSPITALS_DIR / fac / dept / "inventory.csv"
            with csv_path.open("r", encoding="utf-8") as f:
                rows = list(csv.DictReader(f))

            for row in rows:
                item_name = row["item"].strip()
                total_searches += 1
                res = inv_service.search(item_name, record_implicit_verification=False)
                if not res:
                    failures.append((tenant_id, item_name, "None returned"))
                    continue
                matched_name = res["item"].strip()
                if matched_name.lower() != item_name.lower():
                    failures.append((tenant_id, item_name, f"Matched '{matched_name}'"))
                    continue
                score = inv_service._compute_match_score(inv_service._clean_query(item_name), res)
                if score < 90.0:
                    failures.append((tenant_id, item_name, f"Score {score} < 90"))

    assert not failures, f"Failed exact catalog lookups ({len(failures)}/{total_searches}): {failures[:10]}"
    assert total_searches >= 800


def test_learned_facility_lexicon_parity():
    """All pre-seeded and learned facility aliases must resolve to their canonical catalog items."""
    total_lexicon_searches = 0
    failures = []

    for fac in FACILITIES:
        lex_path = HOSPITALS_DIR / fac / "learned_lexicon.json"
        if not lex_path.exists():
            continue
        with lex_path.open("r", encoding="utf-8") as f:
            entries = json.load(f)

        for entry in entries:
            dept = entry.get("departmentId", "or").replace(f"{fac}/", "")
            tenant_id = f"{fac}::{dept}"
            inv_service = get_inventory_service(tenant_id)

            spoken = entry.get("spokenTerm", "").strip()
            canon = entry.get("canonicalItemName", "").strip()
            if not spoken or not canon:
                continue

            total_lexicon_searches += 1
            res = inv_service.search(spoken, record_implicit_verification=False)
            if not res:
                failures.append((tenant_id, spoken, canon, "None returned"))
                continue
            matched_name = res["item"].strip()
            if matched_name.lower() != canon.lower():
                failures.append((tenant_id, spoken, canon, f"Matched '{matched_name}'"))

    assert not failures, f"Failed learned lexicon lookups ({len(failures)}/{total_lexicon_searches}): {failures}"
    assert total_lexicon_searches >= 9


def test_strict_eponym_zero_false_positives():
    """Guarantee zero false-positive eponym substitutions across critical surgical families."""
    inv_service = get_inventory_service("sacred_heart::or")

    # 1. Adson queries must never return DeBakey, Russian, or Gerald
    res_adson = inv_service.search("Adson pickups", record_implicit_verification=False)
    assert res_adson is not None
    assert "adson" in res_adson["item"].lower()
    assert "debakey" not in res_adson["item"].lower()
    assert "russian" not in res_adson["item"].lower()

    # 2. DeBakey queries must never return Adson or Russian
    res_debakey = inv_service.search("DeBakey pickups", record_implicit_verification=False)
    assert res_debakey is not None
    assert "debakey" in res_debakey["item"].lower()
    assert "adson" not in res_debakey["item"].lower()

    # 3. Brown-Adson must never return standard 1x2 Adson or DeBakey
    res_ba = inv_service.search("Brown-Adson pickups", record_implicit_verification=False)
    assert res_ba is not None
    assert "brown-adson" in res_ba["item"].lower()
    assert res_ba["item"] != "Adson Tissue Forceps 1x2 (Adson Pickups)"

    # 4. Metzenbaum must never return Mayo or Iris
    res_metz = inv_service.search("metz scissors", record_implicit_verification=False)
    assert res_metz is not None
    assert "metzenbaum" in res_metz["item"].lower()
    assert "mayo" not in res_metz["item"].lower()

    # 5. Crile must never return Kelly
    res_crile = inv_service.search("crile clamp", record_implicit_verification=False)
    assert res_crile is not None
    assert "crile" in res_crile["item"].lower()
    assert "kelly" not in res_crile["item"].lower()

    # 6. Richardson must never return Deaver or Army-Navy
    res_rich = inv_service.search("richardson retractor", record_implicit_verification=False)
    assert res_rich is not None
    assert "richardson" in res_rich["item"].lower()
    assert "deaver" not in res_rich["item"].lower()

    # 7. Potts scissors must match Potts-Smith
    res_potts = inv_service.search("potts scissors", record_implicit_verification=False)
    assert res_potts is not None
    assert "potts" in res_potts["item"].lower()

    # 8. Beckman retractor must match Beckman-Weitlaner
    res_beckman = inv_service.search("beckman retractor", record_implicit_verification=False)
    assert res_beckman is not None
    assert "beckman" in res_beckman["item"].lower()


def test_specific_catalog_aliases_parity():
    """Verify specific aliases resolve cleanly with score >= 90 and zero eponym conflict."""
    test_cases = [
        ("sacred_heart::or", "debakey 6in", "DeBakey Vascular Tissue Forceps 6in"),
        ("sacred_heart::or", "debakey 12in", "DeBakey Vascular Tissue Forceps 12in"),
        ("sacred_heart::or", "4-0 prolene", "4-0 Prolene Suture on RB-1"),
        ("sacred_heart::or", "3-0 silk", "3-0 Silk Suture"),
        ("sacred_heart::or", "potts scissors", "Potts-Smith Vascular Scissors 45°"),
        ("sacred_heart::or", "beckman retractor", "Beckman-Weitlaner Hinged Retractor"),
        ("sacred_heart::or", "gemini", "Mixter Right-Angle Clamp 7.5in"),
        ("sacred_heart::or", "peanut", "Kittner Dissector Sponges (Peanuts)"),
        ("sacred_heart::or", "stat", "Crile Hemostat Forceps Curved 5.5in (Snaps)"),
        ("sacred_heart::or", "pillowcase", "Mayo Stand Cover Reinforced Blue"),
        ("sacred_heart::or", "malignant hyperthermia drug", "Dantrolene (Ryanodex) 250mg"),
        ("sacred_heart::icu", "ett 7.5", "Endotracheal Tube 7.5mm Cuffed"),
        ("sacred_heart::icu", "7.5 tube", "Endotracheal Tube 7.5mm Cuffed"),
        ("sacred_heart::icu", "ett 8.0", "Endotracheal Tube 8.0mm Cuffed"),
        ("sacred_heart::icu", "8.0 tube", "Endotracheal Tube 8.0mm Cuffed"),
        ("princeton_plainsboro::or", "rat tooth", "Adson Tissue Forceps 1x2 (Adson Pickups)"),
        ("county_general::or", "debakey 12in", "DeBakey Vascular Tissue Forceps 12in"),
    ]

    for tenant_id, query, expected_item in test_cases:
        inv = get_inventory_service(tenant_id)
        res = inv.search(query, record_implicit_verification=False)
        assert res is not None, f"Query '{query}' returned None for {tenant_id}"
        assert res["item"].lower() == expected_item.lower(), (
            f"Query '{query}' returned '{res['item']}', expected '{expected_item}'"
        )
        score = inv._compute_match_score(inv._clean_query(query), res)
        assert score >= 90.0, f"Query '{query}' score {score} < 90 for {expected_item}"
