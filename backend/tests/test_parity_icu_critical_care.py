import csv
import json
from pathlib import Path

HOSPITALS_DIR = Path(__file__).resolve().parent.parent.parent / "hospitals"
ICU_DIR = HOSPITALS_DIR / "icu_critical_care"

def test_icu_critical_care_parity():
    """Assert all items referenced in preference cards exist in inventory.csv."""
    inventory_path = ICU_DIR / "inventory.csv"
    pref_cards_path = ICU_DIR / "preference_cards.json"

    assert inventory_path.exists(), f"Missing {inventory_path}"
    assert pref_cards_path.exists(), f"Missing {pref_cards_path}"

    with inventory_path.open("r", encoding="utf-8") as f:
        inventory_items = {row["item"].strip() for row in csv.DictReader(f)}

    with pref_cards_path.open("r", encoding="utf-8") as f:
        pref_cards = json.load(f)

    missing_items = []
    for card in pref_cards:
        for supply in card.get("supplies", []):
            if supply not in inventory_items:
                missing_items.append((card.get("id"), supply))

    assert not missing_items, f"Items in preference cards missing from inventory: {missing_items}"
