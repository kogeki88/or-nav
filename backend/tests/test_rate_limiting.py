from fastapi.testclient import TestClient
import pytest
from app.main import app
from app.limiter import limiter

@pytest.fixture(autouse=True)
def enable_limiter():
    original_enabled = limiter.enabled
    limiter.enabled = True
    yield
    limiter.enabled = original_enabled
    # clear limiter cache
    limiter.reset()

def _get_client_for_rate_limit():
    client = TestClient(app)
    return client

def test_rate_limit_chat():
    client = _get_client_for_rate_limit()
    for _ in range(60):
        resp = client.post("/api/chat", json={"message": "hello"})
        assert resp.status_code == 200, resp.text

    resp = client.post("/api/chat", json={"message": "hello"})
    assert resp.status_code == 429
    assert "retry-after" in (k.lower() for k in resp.headers.keys())

def test_rate_limit_voice():
    client = _get_client_for_rate_limit()
    for _ in range(60):
        resp = client.get("/api/voice/status")
        assert resp.status_code == 200

    resp = client.get("/api/voice/status")
    assert resp.status_code == 429
    assert "retry-after" in (k.lower() for k in resp.headers.keys())
