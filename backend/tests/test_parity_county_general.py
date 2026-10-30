import csv
import json
import pytest
from pathlib import Path

from app.services.inventory_search import get_inventory_service
from app.services.surgical_ontology import extract_eponyms, is_generic_class_only

HOSPITALS_DIR = Path(__file__).resolve().parent.parent.parent / "hospitals"

def test_county_general_preference_cards_parity():
    """Verify that every item referenced in county_general preference cards exists in inventory.csv."""
    inv_csv = HOSPITALS_DIR / "county_general" / "or" / "inventory.csv"
    pref_json = HOSPITALS_DIR / "county_general" / "or" / "preference_cards.json"

    with inv_csv.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        inventory_items = {row["item"].strip().lower() for row in reader}

    with pref_json.open("r", encoding="utf-8") as f:
        cards = json.load(f)

    missing_items = set()

    for card in cards:
        items_to_check = []
        items_to_check.extend(card.get("instrumentation", []))
        items_to_check.extend(card.get("sutures", []))

        implants = card.get("implants")
        if isinstance(implants, list):
            items_to_check.extend(implants)
        elif isinstance(implants, str) and implants.lower() != "none":
            items_to_check.append(implants)

        for item in items_to_check:
            item_lower = item.strip().lower()

            # Direct match
            if item_lower in inventory_items:
                continue

            # Prefix match or substring match (since pref cards often have 'for ...' appended)
            found = False
            for inv_item in inventory_items:
                if inv_item in item_lower:
                    found = True
                    break

            if not found:
                missing_items.add(item)

    # If missing items, fail test and print them
    assert not missing_items, f"Missing items from inventory.csv: {missing_items}"
