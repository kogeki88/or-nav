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

    # Fuzzing and malformed payload resilience
    assert normalize_location_coordinate(None) is None
    assert normalize_location_coordinate("") is None
    assert normalize_location_coordinate("   \n\t  ") is None

    long_input = "room " * 1000 + "1"
    assert normalize_location_coordinate(long_input) is None

def test_split_compound_query():
    assert split_compound_query("where is 2-0 and 4-0 prolene") == ["2-0 prolene", "4-0 prolene"]
    assert split_compound_query("I&D tray") == ["I&D tray"]
    assert split_compound_query("") == []
    assert split_compound_query(None) == []

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
    assert inv1.tenant.tenant_id == "sacred_heart/or"
    assert inv2.tenant.tenant_id == "princeton_plainsboro/icu"

    mock_csv1 = tmp_path / "inventory1.csv"
    mock_csv1.write_text("item,category,room,cabinet,shelf,container\nUnique Item One,Supplies,R1,C1,S1,C1\n")
    inv1.tenant.inventory_path = mock_csv1
    inv1._load_csv()

    mock_csv2 = tmp_path / "inventory2.csv"
    mock_csv2.write_text("item,category,room,cabinet,shelf,container\nDifferent Thing Two,Supplies,R2,C2,S2,C2\n")
    inv2.tenant.inventory_path = mock_csv2
    inv2._load_csv()

    assert inv1.search("Unique Item One") is not None
    assert inv1.search("Different Thing Two") is None

    assert inv2.search("Different Thing Two") is not None
    assert inv2.search("Unique Item One") is None

import socket
import httpx

def test_offline_first_invariants(tmp_path, monkeypatch):
    tenant = get_tenant("sacred_heart::or")

    mock_csv = tmp_path / "inventory.csv"
    mock_csv.write_text("item,category,room,cabinet,shelf,container\nOffline Item,Supplies,R1,C1,S1,C1\n")
    tenant.inventory_path = mock_csv

    # Enforce offline-first invariants dynamically
    original_socket = socket.socket
    def mock_socket(*args, **kwargs):
        if args and args[0] != socket.AF_UNIX:
            raise RuntimeError("Network call attempted")
        if 'family' in kwargs and kwargs['family'] != socket.AF_UNIX:
            raise RuntimeError("Network call attempted")
        return original_socket(*args, **kwargs)

    def mock_httpx(*args, **kwargs):
        raise RuntimeError("Network call attempted")

    monkeypatch.setattr(socket, "socket", mock_socket)
    monkeypatch.setattr(httpx, "get", mock_httpx)
    monkeypatch.setattr(httpx, "post", mock_httpx)
    monkeypatch.setattr(httpx, "request", mock_httpx)

    inv = InventoryService(tenant)
    # Search should work offline relying solely on CSV
    res = inv.search("Offline Item")
    assert res is not None
    assert res["item"] == "Offline Item"

def test_fuzzing_malformed_inputs(tmp_path):
    tenant = get_tenant("sacred_heart::or")
    mock_csv = tmp_path / "inventory.csv"
    mock_csv.write_text("item,category,room,cabinet,shelf,container\nItem,Supplies,R,C,S,C\n")
    tenant.inventory_path = mock_csv
    inv = InventoryService(tenant)

    with pytest.raises(TypeError):
        inv.search(123)

    with pytest.raises(TypeError):
        inv.search({"foo": "bar"})

    with pytest.raises(TypeError):
        inv.search(["list", "of", "items"])

    with pytest.raises(TypeError):
        inv.search(None)

    # The following should handle missing/invalid gracefully per application design
    assert inv.report_move(None, None) is None
    assert inv.report_move("", "") is None
    assert inv.report_move("Item", None) is None
    assert inv.report_move(None, "Room 1") is None

    assert inv.verify_move(None) is None
    assert inv.verify_move("") is None
    assert inv.verify_move(123) is None

    # Check add_inventory_item
    with pytest.raises(TypeError):
        inv.add_inventory_item(None, None)
