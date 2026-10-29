from app.main import _mask_api_key

def test_mask_api_key():
    # Empty string
    assert _mask_api_key("") == "***"

    # None-like string
    assert _mask_api_key("your-api-key-here") == "your...here"

    # Length < 8
    assert _mask_api_key("short") == "***"
    assert _mask_api_key("1234567") == "***"

    # Length >= 8
    assert _mask_api_key("12345678") == "1234...5678"
    assert _mask_api_key("AIzaSyTestKey1234567890abcd") == "AIza...abcd"
