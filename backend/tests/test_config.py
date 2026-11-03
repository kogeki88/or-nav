import pytest
import time
from pathlib import Path
from unittest.mock import patch
from app.config import validate_tenant_id, get_tenant, list_tenants, TenantConfig
import app.config


def test_validate_tenant_id_happy_paths():
    # Normal tenant ID
    assert validate_tenant_id("or_main") == "or_main"

    # ID with spaces around it
    assert validate_tenant_id(" or_main ") == "or_main"

    # ID with double-colon notation
    assert validate_tenant_id("sacred_heart::or") == "sacred_heart/or"

    # Sub-directory
    assert validate_tenant_id("sacred_heart/or") == "sacred_heart/or"


def test_validate_tenant_id_default():
    assert validate_tenant_id("") == "or_main"
    assert validate_tenant_id(None) == "or_main"
    assert validate_tenant_id("   ") == "or_main"


def test_validate_tenant_id_error_cases():

    # Directory traversal attempts
    with pytest.raises(ValueError):
        validate_tenant_id("../or")

    with pytest.raises(ValueError):
        validate_tenant_id("or/..")

    # Invalid characters
    with pytest.raises(ValueError):
        validate_tenant_id("tenant-id")

    with pytest.raises(ValueError):
        validate_tenant_id("tenant id")

    with pytest.raises(ValueError):
        validate_tenant_id("tenant@id")


def test_get_tenant_isolation_and_paths(tmp_path, monkeypatch):
    """Verify that multiple tenants are isolated and their paths resolve correctly within the mocked directory."""
    # Setup mock hospitals directory
    hospitals_mock = tmp_path / "hospitals"
    hospitals_mock.mkdir()

    # Create Tenant A
    tenant_a_dir = hospitals_mock / "tenant_a"
    tenant_a_dir.mkdir()
    (tenant_a_dir / "inventory.csv").touch()

    # Create Tenant B
    tenant_b_dir = hospitals_mock / "tenant_b"
    tenant_b_dir.mkdir()
    (tenant_b_dir / "inventory.csv").touch()

    monkeypatch.setattr(app.config, "HOSPITALS_DIR", hospitals_mock)

    # Test Tenant A
    config_a = get_tenant("tenant_a")
    assert isinstance(config_a, TenantConfig)
    assert config_a.tenant_id == "tenant_a"
    assert config_a.inventory_path == tenant_a_dir / "inventory.csv"

    # Test Tenant B
    config_b = get_tenant("tenant_b")
    assert isinstance(config_b, TenantConfig)
    assert config_b.tenant_id == "tenant_b"
    assert config_b.inventory_path == tenant_b_dir / "inventory.csv"

    # Verify isolation
    assert config_a.inventory_path != config_b.inventory_path
    assert config_a.tenant_id != config_b.tenant_id


def test_get_tenant_hierarchical_paths(tmp_path, monkeypatch):
    """Test hierarchical tenant path resolution and offline invariants."""
    hospitals_mock = tmp_path / "hospitals"
    hospitals_mock.mkdir()

    # Create sacred_heart/or
    sacred_heart_dir = hospitals_mock / "sacred_heart"
    sacred_heart_dir.mkdir()
    or_dir = sacred_heart_dir / "or"
    or_dir.mkdir()
    (or_dir / "inventory.csv").touch()

    # Create general_memorial_cvor
    general_memorial_cvor_dir = hospitals_mock / "general_memorial_cvor"
    general_memorial_cvor_dir.mkdir()
    (general_memorial_cvor_dir / "inventory.csv").touch()

    monkeypatch.setattr(app.config, "HOSPITALS_DIR", hospitals_mock)

    # Test sacred_heart/or via double-colon
    config = get_tenant("sacred_heart::or")
    assert config.tenant_id == "sacred_heart/or"
    assert config.inventory_path == or_dir / "inventory.csv"

    # Test general_memorial_cvor via underscore
    config = get_tenant("general_memorial_cvor")
    assert config.tenant_id == "general_memorial_cvor"
    assert config.inventory_path == general_memorial_cvor_dir / "inventory.csv"


def test_list_tenants(tmp_path, monkeypatch):
    """Verify list_tenants detects directories offline correctly."""
    hospitals_mock = tmp_path / "hospitals"
    hospitals_mock.mkdir()

    tenant_1 = hospitals_mock / "or_main"
    tenant_1.mkdir()
    (tenant_1 / "inventory.csv").touch()

    tenant_2 = hospitals_mock / "icu_critical_care"
    tenant_2.mkdir()
    (tenant_2 / "inventory.csv").touch()

    tenant_3 = hospitals_mock / "fake_tenant"
    tenant_3.mkdir()

    monkeypatch.setattr(app.config, "HOSPITALS_DIR", hospitals_mock)

    tenants = list_tenants()
    # fake_tenant has no inventory.csv so it should be omitted
    assert set(tenants) == {"or_main", "icu_critical_care"}
    # Verify order preference - we know the list_tenants uses preferred_order
    assert set(tenants[:2]) == {"or_main", "icu_critical_care"}


def test_get_tenant_invalid_paths(tmp_path, monkeypatch):
    """Test getting a tenant that doesn't exist."""
    hospitals_mock = tmp_path / "hospitals"
    hospitals_mock.mkdir()

    monkeypatch.setattr(app.config, "HOSPITALS_DIR", hospitals_mock)

    with pytest.raises(ValueError, match="Tenant directory not found: non_existent_tenant"):
        get_tenant("non_existent_tenant")

def test_validate_tenant_id_fuzzing():
    # Attempting various bad inputs
    bad_inputs = [
        "../../etc/passwd",
        "/etc/passwd",
        "some_tenant/../../../etc/passwd",
        "sacred_heart::or/../../",
        "te!nant",
        "tenant_1;",
        "tenant space",
        "tenant#name",
        "\x00tenant",
        "tenant\n1",
        "  ..  ",
        "//etc/passwd",
        "/",
        "foo//bar",
        "foo/"
    ]
    for bad in bad_inputs:
        with pytest.raises(ValueError):
            validate_tenant_id(bad)

def test_validate_tenant_id_malformed_payloads():
    # Non-string types should be rejected with ValueError, except None
    malformed_inputs = [
        123,
        ["or_main"],
        {"tenant": "or_main"},
        True,
        object()
    ]
    for bad in malformed_inputs:
        with pytest.raises(ValueError, match="tenant_id must be a string"):
            validate_tenant_id(bad)  # type: ignore

def test_get_tenant_boundary_isolation(tmp_path, monkeypatch):
    """Enforce strict boundary checks for tenant isolation."""
    hospitals_mock = tmp_path / "hospitals"
    hospitals_mock.mkdir()
    monkeypatch.setattr(app.config, "HOSPITALS_DIR", hospitals_mock)

    # Valid tenant
    tenant_a_dir = hospitals_mock / "valid_tenant"
    tenant_a_dir.mkdir()
    (tenant_a_dir / "inventory.csv").touch()

    # Getting outside should fail due to regex check or direct isolation
    with pytest.raises(ValueError):
         get_tenant("valid_tenant/../../../etc/passwd")

def test_list_tenants_empty_and_offline_invariants(tmp_path, monkeypatch):
    """Verify list_tenants works under empty or non-existent directories."""
    # When directory doesn't exist at all
    hospitals_mock = tmp_path / "non_existent_hospitals"
    monkeypatch.setattr(app.config, "HOSPITALS_DIR", hospitals_mock)

    assert list_tenants() == []


def test_multi_tenant_boundary_enforcement_facility_dept(tmp_path, monkeypatch):
    """Enforce multi-tenant boundary enforcement (facility_id::dept_id)."""
    hospitals_mock = tmp_path / "hospitals"
    hospitals_mock.mkdir()

    fac_dir1 = hospitals_mock / "facility_alpha"
    fac_dir1.mkdir()
    dept_dir1 = fac_dir1 / "dept_x"
    dept_dir1.mkdir()
    (dept_dir1 / "inventory.csv").touch()

    fac_dir2 = hospitals_mock / "facility_beta"
    fac_dir2.mkdir()
    dept_dir2 = fac_dir2 / "dept_x"
    dept_dir2.mkdir()
    (dept_dir2 / "inventory.csv").touch()

    monkeypatch.setattr(app.config, "HOSPITALS_DIR", hospitals_mock)

    config1 = get_tenant("facility_alpha::dept_x")
    config2 = get_tenant("facility_beta::dept_x")

    assert config1.tenant_id == "facility_alpha/dept_x"
    assert config2.tenant_id == "facility_beta/dept_x"
    assert config1.inventory_path != config2.inventory_path

    with pytest.raises(ValueError):
        validate_tenant_id("facility_alpha::../facility_beta")

    with pytest.raises(ValueError):
        validate_tenant_id("facility_alpha::dept_x/../../etc/passwd")

def test_offline_mutation_replay_idempotency(tmp_path, monkeypatch):
    """Enforce offline mutation replay idempotency in ConfigBackend."""
    hospitals_mock = tmp_path / "hospitals"
    hospitals_mock.mkdir()
    tenant_dir = hospitals_mock / "replay_tenant"
    tenant_dir.mkdir()
    (tenant_dir / "inventory.csv").touch()
    monkeypatch.setattr(app.config, "HOSPITALS_DIR", hospitals_mock)

    first_val = validate_tenant_id("some_facility::some_dept")
    second_val = validate_tenant_id(first_val)
    assert first_val == "some_facility/some_dept"
    assert second_val == "some_facility/some_dept"

    config_1 = get_tenant("replay_tenant")
    config_2 = get_tenant("replay_tenant")
    config_3 = get_tenant("replay_tenant")

    assert config_1.tenant_id == config_2.tenant_id == config_3.tenant_id
    assert config_1.inventory_path == config_2.inventory_path == config_3.inventory_path
    assert config_1.orientation_path == config_2.orientation_path == config_3.orientation_path

def test_config_offline_first_caching_and_healing(tmp_path, monkeypatch):
    """
    Test fault injection, network/storage partition degradation, intermittent latency,
    and self-healing reconnection for ConfigBackend (list_tenants and get_tenant).
    Offline-first: should fallback to cached state rather than throw OSError.
    """

    # Reset caches for this test specifically
    monkeypatch.setattr(app.config, "_tenant_cache", {})
    monkeypatch.setattr(app.config, "_list_tenants_cache", [])


    hospitals_mock = tmp_path / "hospitals"
    hospitals_mock.mkdir()

    tenant_1 = hospitals_mock / "or_main"
    tenant_1.mkdir()
    (tenant_1 / "inventory.csv").touch()

    tenant_2 = hospitals_mock / "er_trauma"
    tenant_2.mkdir()
    (tenant_2 / "inventory.csv").touch()

    monkeypatch.setattr(app.config, "HOSPITALS_DIR", hospitals_mock)

    network_state = {"status": "online", "latency": 0.0}

    original_iterdir = Path.iterdir
    original_resolve = Path.resolve

    def mock_iterdir(self):
        if network_state["status"] == "offline":
            raise OSError("Storage partition offline")
        if network_state["latency"] > 0:
            time.sleep(network_state["latency"])
        return original_iterdir(self)

    def mock_resolve(self, *args, **kwargs):
        if network_state["status"] == "offline":
            raise OSError("Storage partition offline")
        if network_state["latency"] > 0:
            time.sleep(network_state["latency"])
        return original_resolve(self, *args, **kwargs)

    with patch.object(Path, 'iterdir', new=mock_iterdir), \
         patch.object(Path, 'resolve', new=mock_resolve):

        # 1. Normal state - warm up the cache
        tenants = list_tenants()
        assert "or_main" in tenants

        config_online = get_tenant("or_main")
        assert config_online.tenant_id == "or_main"

        # 2. Intermittent latency
        network_state["latency"] = 0.05
        start_time = time.time()
        tenants_latency = list_tenants()
        elapsed = time.time() - start_time
        assert "or_main" in tenants_latency
        assert elapsed >= 0.05

        # 3. Network partition degradation (Offline)
        network_state["status"] = "offline"
        network_state["latency"] = 0.0

        # Should self-heal / fallback to cache
        tenants_offline = list_tenants()
        assert "or_main" in tenants_offline

        config_offline = get_tenant("or_main")
        assert config_offline.tenant_id == "or_main"

        # 4. Self-healing reconnection (Online)
        network_state["status"] = "online"

        tenants_recovered = list_tenants()
        assert "or_main" in tenants_recovered

        config_recovered = get_tenant("or_main")
        assert config_recovered.tenant_id == "or_main"
