import pytest
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
