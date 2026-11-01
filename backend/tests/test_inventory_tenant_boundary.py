import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.config import get_tenant

client = TestClient(app)

def test_inventory_tenant_boundary_prevents_cross_tenant_injection():
    """
    Test uploading CSV records with cross-facility IDs and assert rejection.
    Ensure they do not overwrite or inject records into other hospital facility tenants.
    """

    tenant_1 = "or_main"
    tenant_2 = "er_trauma"

    tenant_1_config = get_tenant(tenant_1)
    tenant_2_config = get_tenant(tenant_2)

    # original state
    t1_inv = tenant_1_config.inventory_path.read_text()
    t2_inv = tenant_2_config.inventory_path.read_text()

    try:
        csv_content = """item,category,room,cabinet,shelf,container
MaliciousItem,Instruments,Room1,Cab1,Shelf1,Cont1
"""

        # Test 1: Try path traversal in tenant_id field
        r = client.post(
            "/api/ingest",
            data={"tenant_id": f"or_main/../../hospitals/{tenant_2}"},
            files={"file": ("inventory.csv", csv_content, "text/csv")}
        )
        assert r.status_code == 400

        # Verify both tenants were NOT modified
        assert tenant_1_config.inventory_path.read_text() == t1_inv
        assert tenant_2_config.inventory_path.read_text() == t2_inv

        # Test 2: Upload CSV that contains records belonging to a different tenant/facility
        malicious_cross_tenant_csv = """item,category,room,cabinet,shelf,container,tenant_id
CrossTenantItem,Instruments,Room1,Cab1,Shelf1,Cont1,er_trauma
CrossFacilityItem,Instruments,Room1,Cab1,Shelf1,Cont1,county_general::er_trauma
"""

        r = client.post(
            "/api/ingest",
            data={"tenant_id": tenant_1},
            files={"file": ("inventory.csv", malicious_cross_tenant_csv, "text/csv")}
        )
        # Should be rejected with 400 because CSV contains items with cross-facility or cross-tenant IDs
        assert r.status_code == 400

        # Verify both tenants were NOT modified
        assert tenant_1_config.inventory_path.read_text() == t1_inv
        assert tenant_2_config.inventory_path.read_text() == t2_inv

        # Test 3: Upload correctly to tenant 1
        r = client.post(
            "/api/ingest",
            data={"tenant_id": tenant_1},
            files={"file": ("inventory.csv", csv_content, "text/csv")}
        )
        assert r.status_code == 200

        # Verify tenant 2 was NOT modified
        assert tenant_2_config.inventory_path.read_text() == t2_inv

        # Verify tenant 1 WAS modified
        assert "MaliciousItem" in tenant_1_config.inventory_path.read_text()
        assert "MaliciousItem" not in tenant_2_config.inventory_path.read_text()

    finally:
        tenant_1_config.inventory_path.write_text(t1_inv)
        tenant_2_config.inventory_path.write_text(t2_inv)
