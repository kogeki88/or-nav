import json
from pathlib import Path
from app.services.inventory_search import get_inventory_service

HOSPITALS_DIR = Path(__file__).resolve().parent.parent.parent / "hospitals"

def test_er_trauma_preference_cards_parity():
    """Verify that all items referenced in er_trauma preference cards exist in inventory.csv."""
    tenant_id = "er_trauma"
    inv_service = get_inventory_service(tenant_id)

    pref_cards_file = HOSPITALS_DIR / tenant_id / "preference_cards.json"
    with open(pref_cards_file, "r", encoding="utf-8") as f:
        cards = json.load(f)

    missing = []

    for card in cards:
        supplies = card.get("supplies", [])
        for supply in supplies:
            res = inv_service.search(supply, record_implicit_verification=False)
            if not res:
                missing.append(supply)

    assert not missing, f"Missing supplies in inventory.csv: {missing}"

def test_er_trauma_inventory_structure():
    """Verify that inventory.csv for er_trauma contains expected columns."""
    import csv

    inv_file = HOSPITALS_DIR / "er_trauma" / "inventory.csv"
    with open(inv_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames

        expected_columns = [
            "item", "category", "room", "cabinet", "shelf", "container",
            "aliases", "pending_location", "verify_count", "surgeon_notes",
            "human_alias", "verification_score", "status", "last_verified_at"
        ]
        for col in expected_columns:
            assert col in fieldnames, f"Missing expected column: {col}"

        rows = list(reader)
        assert len(rows) > 0, "Inventory CSV should contain at least one row"
