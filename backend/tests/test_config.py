import pytest
from app.config import validate_tenant_id


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
