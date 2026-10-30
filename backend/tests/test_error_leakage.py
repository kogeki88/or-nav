import pytest
from fastapi.testclient import TestClient
from app.main import app
from fastapi.responses import JSONResponse
import os

client = TestClient(app, raise_server_exceptions=False)

@app.get("/api/test-error-leakage-endpoint")
async def trigger_error():
    os.environ["DUMMY_SECRET_KEY"] = "super-secret-12345"
    raise RuntimeError(f"Failed at /opt/backend/app/db.sqlite: DUMMY_SECRET_KEY={os.environ['DUMMY_SECRET_KEY']}")

def test_unexpected_error_sanitized():
    response = client.get("/api/test-error-leakage-endpoint")
    assert response.status_code == 500

    content = response.text
    assert "super-secret-12345" not in content
    assert "/opt/backend/app/db.sqlite" not in content
    assert "RuntimeError" not in content

    # We should return a generic JSON message
    assert response.headers.get("content-type") == "application/json"
    assert response.json() == {"detail": "Internal Server Error"}
