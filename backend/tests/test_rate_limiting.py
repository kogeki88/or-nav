import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.limiter import limiter

@pytest.fixture
def client():
    # enable limiter for these tests since it is disabled by default for pytest
    limiter.enabled = True
    limiter.reset()
    yield TestClient(app)
    limiter.enabled = False

def test_rate_limit_chat(client):
    limiter.reset()
    for _ in range(60):
        response = client.post("/api/chat", json={"message": "test", "tenant_id": "sacred_heart::or"})
        assert response.status_code in (200, 422, 500, 400) # Accept anything except 429 for the first 60

    response = client.post("/api/chat", json={"message": "test", "tenant_id": "sacred_heart::or"})
    assert response.status_code == 429
    assert "Retry-After" in response.headers

def test_rate_limit_voice_status(client):
    limiter.reset()
    for _ in range(60):
        response = client.get("/api/voice/status")
        assert response.status_code in (200, 422, 500, 400)

    response = client.get("/api/voice/status")
    assert response.status_code == 429
    assert "Retry-After" in response.headers

def test_rate_limit_voice_token(client):
    limiter.reset()
    for _ in range(60):
        response = client.post("/api/voice/token", json={"tenant_id": "sacred_heart::or", "participant_name": "test"})
        assert response.status_code in (200, 422, 500, 503, 400)

    response = client.post("/api/voice/token", json={"tenant_id": "sacred_heart::or", "participant_name": "test"})
    assert response.status_code == 429
    assert "Retry-After" in response.headers

def test_rate_limit_voice_transcribe(client):
    limiter.reset()
    file_data = b"dummy audio content"
    for _ in range(60):
        response = client.post(
            "/api/voice/transcribe",
            data={"tenant_id": "sacred_heart::or"},
            files={"file": ("test.wav", file_data, "audio/wav")}
        )
        assert response.status_code in (200, 422, 500, 503, 400, 413)

    response = client.post(
        "/api/voice/transcribe",
        data={"tenant_id": "sacred_heart::or"},
        files={"file": ("test.wav", file_data, "audio/wav")}
    )
    assert response.status_code == 429
    assert "Retry-After" in response.headers

