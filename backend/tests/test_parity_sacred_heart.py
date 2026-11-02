import csv
import json
import pytest
from pathlib import Path

HOSPITALS_DIR = Path(__file__).resolve().parent.parent.parent / "hospitals"

def test_sacred_heart_preference_cards_parity():
    """Verify that every item referenced in sacred_heart preference cards exists in inventory.csv."""
    inv_csv = HOSPITALS_DIR / "sacred_heart" / "or" / "inventory.csv"
    pref_json = HOSPITALS_DIR / "sacred_heart" / "or" / "preference_cards.json"

    with inv_csv.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        inventory_items = set()
        for row in reader:
            inventory_items.add(row["item"].strip().lower())
            if row["aliases"]:
                for alias in row["aliases"].split("|"):
                    if alias.strip():
                        inventory_items.add(alias.strip().lower())

    with pref_json.open("r", encoding="utf-8") as f:
        cards = json.load(f)

    missing_items = set()
    categories_to_check = ["instrumentation", "sutures", "equipment", "supplies", "drapes", "trays"]

    for card in cards:
        items_to_check = []
        for cat in categories_to_check:
            items_to_check.extend(card.get(cat, []))

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

            # Prefix match or substring match
            found = False
            for inv_item in inventory_items:
                if inv_item in item_lower:
                    found = True
                    break

            if not found:
                missing_items.add(item)

    # If missing items, fail test and print them
    assert not missing_items, f"Missing items from inventory.csv: {missing_items}"
