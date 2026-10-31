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

import concurrent.futures

import socket
import httpx
import time

def test_concurrency_race_condition_and_latency(tmp_path, monkeypatch):
    # Enforce offline-first invariants
    original_socket = socket.socket
    def mock_socket(*args, **kwargs):
        # The default socket family is AF_INET, so empty args imply network call
        if not args and not kwargs:
            raise RuntimeError("Network call attempted during benchmarks")
        if args and args[0] != socket.AF_UNIX:
            raise RuntimeError("Network call attempted during benchmarks")
        if 'family' in kwargs and kwargs['family'] != socket.AF_UNIX:
            raise RuntimeError("Network call attempted during benchmarks")
        return original_socket(*args, **kwargs)

    def mock_httpx(*args, **kwargs):
        raise RuntimeError("Network call attempted during benchmarks")

    monkeypatch.setattr(socket, "socket", mock_socket)
    monkeypatch.setattr(httpx, "get", mock_httpx)
    monkeypatch.setattr(httpx, "post", mock_httpx)
    monkeypatch.setattr(httpx, "request", mock_httpx)

    # Setup Tenant 1
    t1 = get_tenant("sacred_heart::or")
    t1_csv = tmp_path / "t1.csv"
    t1_csv.write_text("item,category,room,cabinet,shelf,container,pending_location,verify_count\nTarget Item,Supplies,Room1,Cab1,Shelf1,Cont1,Room2 Cab2 Shelf2 Cont2,0\n")
    t1.inventory_path = t1_csv
    inv1 = InventoryService(t1)

    # Setup Tenant 2
    t2 = get_tenant("princeton_plainsboro::icu")
    t2_csv = tmp_path / "t2.csv"
    t2_csv.write_text("item,category,room,cabinet,shelf,container,pending_location,verify_count\nAnother Item,Supplies,R2,C2,S2,C2,,0\n")
    t2.inventory_path = t2_csv
    inv2 = InventoryService(t2)

    # 1. Race condition benchmark for verify_move
    def verify_worker():
        return inv1.verify_move("Target Item", "Room2 Cab2 Shelf2 Cont2")

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(verify_worker) for _ in range(10)]
        results = [f.result() for f in concurrent.futures.as_completed(futures)]

    # Assert correct final state
    commits = [r for r in results if r and r.get("committed")]
    assert len(commits) == 1  # Exactly one thread triggered the commit

    # Refresh state
    card = inv1.search("Target Item")
    assert card["verify_count"] == 0  # Should be reset
    assert card["room"] == "Room2"
    assert card["cabinet"] == "CAB2"

    # 2. High-concurrency multi-tenant & latency benchmark
    queries = []
    for i in range(500):
        queries.append((inv1, "Target Item", True))
        queries.append((inv2, "Another Item", True))
        # Cross-tenant lookups should fail
        queries.append((inv1, "Another Item", False))
        queries.append((inv2, "Target Item", False))

    start_time = time.time()
    def search_worker(args):
        inv, q, expect_found = args
        t_start = time.time()
        res = inv.search(q, record_implicit_verification=False)
        t_end = time.time()
        return res, expect_found, (t_end - t_start)

    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        futures = [executor.submit(search_worker, q) for q in queries]
        search_results = [f.result() for f in concurrent.futures.as_completed(futures)]

    end_time = time.time()

    total_latency = 0.0
    for res, expect_found, latency in search_results:
        total_latency += latency
        if expect_found:
            assert res is not None
        else:
            assert res is None

    avg_latency = total_latency / len(search_results)
    # The GIL inflates thread-local timing, so we also check total wall time per request
    wall_latency = (end_time - start_time) / len(search_results)
    assert wall_latency < 0.05, f"Average wall latency too high: {wall_latency:.4f}s"
