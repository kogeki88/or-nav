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
    limiter.reset()

def _get_client():
    return TestClient(app)

def test_rate_limit_chat():
    client = _get_client()
    for _ in range(60):
        resp = client.post("/api/chat", json={"message": "hello"})
        # Just ensure it's not 429
        assert resp.status_code != 429

    resp = client.post("/api/chat", json={"message": "hello"})
    assert resp.status_code == 429
    assert "retry-after" in (k.lower() for k in resp.headers.keys())

def test_rate_limit_voice_token():
    client = _get_client()
    for _ in range(60):
        resp = client.post("/api/voice/token", json={"tenant_id": "test", "participant_name": "test"})
        # It might be 503 or 500, but not 429
        assert resp.status_code != 429

    resp = client.post("/api/voice/token", json={"tenant_id": "test", "participant_name": "test"})
    assert resp.status_code == 429
    assert "retry-after" in (k.lower() for k in resp.headers.keys())
