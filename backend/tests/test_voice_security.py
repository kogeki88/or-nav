import os
import json
import jwt
import time
from fastapi.testclient import TestClient
import pytest
from app.main import app

@pytest.fixture
def client():
    return TestClient(app)

def test_voice_token_security(client, monkeypatch):
    monkeypatch.setenv("LIVEKIT_URL", "wss://livekit.cvor.internal")
    monkeypatch.setenv("LIVEKIT_API_KEY", "devkey123")
    monkeypatch.setenv("LIVEKIT_API_SECRET", "secret123456789012345678901234567890")

    resp = client.post("/api/voice/token", json={
        "tenant_id": "general_memorial_cvor",
        "participant_name": "dr_chen_cvor",
    })

    assert resp.status_code == 200
    data = resp.json()
    token = data["token"]

    decoded = jwt.decode(token, options={"verify_signature": False})

    assert "exp" in decoded

    current_time = time.time()
    ttl = decoded["exp"] - current_time

    assert 590 < ttl <= 600

    assert decoded.get("sub") == "dr_chen_cvor"

    metadata_str = decoded.get("metadata")
    assert metadata_str is not None

    metadata = json.loads(metadata_str)
    assert metadata.get("tenant_id") == "general_memorial_cvor"

def test_expired_voice_token_is_rejected():
    payload = {
        "sub": "dr_chen_cvor",
        "exp": time.time() - 600,
        "metadata": '{"tenant_id": "general_memorial_cvor"}'
    }

    expired_token = jwt.encode(payload, "secret", algorithm="HS256")

    with pytest.raises(jwt.ExpiredSignatureError):
        jwt.decode(expired_token, "secret", algorithms=["HS256"])

def test_missing_livekit_credentials_fails(client, monkeypatch):
    monkeypatch.delenv("LIVEKIT_API_KEY", raising=False)
    monkeypatch.delenv("LIVEKIT_API_SECRET", raising=False)

    resp = client.post("/api/voice/token", json={
        "tenant_id": "general_memorial_cvor",
        "participant_name": "dr_chen_cvor",
    })

    assert resp.status_code == 503
