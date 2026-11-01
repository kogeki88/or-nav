import pytest
from fastapi.testclient import TestClient
from backend.app.main import app

# Add a dummy endpoint dynamically to the app to ensure we trigger a RuntimeError reliably
@app.get("/dummy-error")
async def dummy_error():
    raise RuntimeError("SENSITIVE_API_KEY=12345 /var/www/secret")

client = TestClient(app, raise_server_exceptions=False)

def test_error_leakage_sanitization():
    """
    Simulate a server exception (RuntimeError with sensitive data) during a request.
    Verify that the generic_exception_handler catches it and returns a sanitized
    500 Internal Server Error response without leaking the sensitive string.
    """
    response = client.get("/dummy-error")

    assert response.status_code == 500

    data = response.json()
    assert data == {"detail": "Internal Server Error"}

    # Double check the sensitive data is not in the text response
    assert "SENSITIVE_API_KEY" not in response.text
    assert "secret" not in response.text
