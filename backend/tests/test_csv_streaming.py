import pytest
import io
import time
import tracemalloc
from pathlib import Path
from app.services.inventory_search import InventoryService
from app.config import TenantConfig

def test_csv_streaming_performance():
    """
    Benchmark memory footprint and parse speed when loading multi-megabyte hospital inventory files.
    Verify parsing executes with minimal allocations and constant memory usage.
    """
    test_tenant = TenantConfig(
        tenant_id="test_perf",
        display_name="Test Perf",
        orientation_path=Path("/tmp/test_perf_orientation.md"),
        inventory_path=Path("/tmp/test_perf_inventory.csv")
    )
    service = InventoryService(test_tenant)

    num_rows_small = 5000
    csv_lines_small = ["item,category,room,cabinet,shelf,container,aliases,pending_location,surgeon_notes,human_alias,status,last_verified_at,verification_score\n"]
    for i in range(num_rows_small):
        csv_lines_small.append(f"Item {i},Cat A,OR 1,Cab 1,Shelf 1,Bin 1,,,,,verified,2023-01-01T00:00:00Z,3.0\n")
    csv_text_small = "".join(csv_lines_small)

    num_rows_large = 10000
    csv_lines_large = ["item,category,room,cabinet,shelf,container,aliases,pending_location,surgeon_notes,human_alias,status,last_verified_at,verification_score\n"]
    for i in range(num_rows_large):
        csv_lines_large.append(f"Item {i},Cat A,OR 1,Cab 1,Shelf 1,Bin 1,,,,,verified,2023-01-01T00:00:00Z,3.0\n")
    csv_text_large = "".join(csv_lines_large)

    def benchmark_ingest(csv_text: str):
        tracemalloc.start()
        mem_before, _ = tracemalloc.get_traced_memory()
        start_time = time.time()

        service.ingest_csv(csv_text)

        end_time = time.time()
        mem_after, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()

        overhead_mb = (peak - mem_after) / (1024 * 1024)
        total_mem_mb = (mem_after - mem_before) / (1024 * 1024)
        duration = end_time - start_time

        return duration, overhead_mb, total_mem_mb

    duration_small, overhead_small, total_mem_small = benchmark_ingest(csv_text_small)

    # clear state between runs
    service._rows = []

    duration_large, overhead_large, total_mem_large = benchmark_ingest(csv_text_large)

    print(f"Small (5000): time {duration_small:.2f}s, overhead {overhead_small:.2f}MB, data size {total_mem_small:.2f}MB")
    print(f"Large (10000): time {duration_large:.2f}s, overhead {overhead_large:.2f}MB, data size {total_mem_large:.2f}MB")

    # Time scale should be relatively linear or slightly worse but definitely better than exponential
    assert duration_large < duration_small * 3.0  # Linear time scale

    # Allocation overhead scale should be linear too
    assert overhead_large < overhead_small * 3.0  # Linear memory overhead scale

    # We enforce reasonable bounds on absolute memory footprint as well.
    assert total_mem_large < 50.0 # Under 50MB retained
    assert overhead_large < 10.0 # Under 10MB temporary parsing overhead
