import pytest
from app.services.inventory_search import (
    InventoryService,
    get_inventory_service,
    reset_inventory_services,
    normalize_location_coordinate,
    split_compound_query
)
from app.config import get_tenant

@pytest.fixture(autouse=True)
def setup_teardown():
    reset_inventory_services()
    yield
    reset_inventory_services()

def test_normalize_location_coordinate():
    assert normalize_location_coordinate("or 21 b 1 a") == "OR 21 B 1 A"
    assert normalize_location_coordinate("room 21 cabinet b shelf 1 bin a") == "OR 21 B 1 A"
    assert normalize_location_coordinate("core supply rack d shelf 1 bin a") == "Core Supply D 1 A"
    assert normalize_location_coordinate("invalid location") is None

def test_split_compound_query():
    assert split_compound_query("where is 2-0 and 4-0 prolene") == ["2-0 prolene", "4-0 prolene"]
    assert split_compound_query("I&D tray") == ["I&D tray"]

def test_report_move_and_verify(tmp_path):
    tenant = get_tenant("sacred_heart::or")

    # Mocking inventory file to prevent modifying actual file
    mock_csv_path = tmp_path / "inventory.csv"
    mock_csv_path.write_text("item,category,room,cabinet,shelf,container,pending_location,verify_count\nTest Item,Supplies,Room1,Cab1,Shelf1,Cont1,,0\n")

    tenant.inventory_path = mock_csv_path

    inv = InventoryService(tenant)

    # Report move
    card = inv.report_move("Test Item", "Room2 Cab2 Shelf2 Cont2")
    assert card is not None
    assert card["pending_location"] == "Room2 Cab2 Shelf2 Cont2"
    assert card["verify_count"] == 1

    # Verify move (count = 2)
    card2 = inv.verify_move("Test Item", "Room2 Cab2 Shelf2 Cont2")
    assert card2["verify_count"] == 2
    assert not card2["committed"]

    # Verify move (count = 3 -> committed)
    card3 = inv.verify_move("Test Item", "Room2 Cab2 Shelf2 Cont2")
    assert card3["committed"] is True
    assert card3["room"] == "Room2"

def test_tenant_isolation(tmp_path):
    inv1 = get_inventory_service("sacred_heart::or")
    inv2 = get_inventory_service("princeton_plainsboro::icu")

    assert inv1 is not inv2

def test_offline_first_invariants(tmp_path):
    tenant = get_tenant("sacred_heart::or")

    mock_csv = tmp_path / "inventory.csv"
    mock_csv.write_text("item,category,room,cabinet,shelf,container\nOffline Item,Supplies,R1,C1,S1,C1\n")
    tenant.inventory_path = mock_csv

    inv = InventoryService(tenant)
    # Search should work offline relying solely on CSV
    res = inv.search("Offline Item")
    assert res is not None
    assert res["item"] == "Offline Item"
