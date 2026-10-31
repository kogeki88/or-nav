from hypothesis import given, settings, HealthCheck, strategies as st
import pytest
import sys
from unittest.mock import MagicMock
from fastapi.testclient import TestClient
from app.main import app

@pytest.fixture
def client():
    return TestClient(app)

class TestVoiceRouter:
    def test_voice_status_unconfigured(self, client, monkeypatch):
        monkeypatch.delenv("LIVEKIT_URL", raising=False)
        monkeypatch.delenv("LIVEKIT_API_KEY", raising=False)
        monkeypatch.delenv("LIVEKIT_API_SECRET", raising=False)
        resp = client.get("/api/voice/status")
        assert resp.status_code == 200
        data = resp.json()
        assert not data["livekit_configured"]
        assert data["mode"] == "BROWSER_WEB_SPEECH"

    def test_voice_status_configured(self, client, monkeypatch):
        monkeypatch.setenv("LIVEKIT_URL", "wss://livekit.test")
        monkeypatch.setenv("LIVEKIT_API_KEY", "key")
        monkeypatch.setenv("LIVEKIT_API_SECRET", "secret")
        resp = client.get("/api/voice/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["livekit_configured"]
        assert data["mode"] == "LIVEKIT_WEBRTC"
        assert data["livekit_url"] == "wss://livekit.test"

    def test_mint_token_unconfigured(self, client, monkeypatch):
        monkeypatch.delenv("LIVEKIT_URL", raising=False)
        resp = client.post("/api/voice/token", json={"tenant_id": "test", "participant_name": "user"})
        assert resp.status_code == 503

    def test_mint_token_configured(self, client, monkeypatch):
        monkeypatch.setenv("LIVEKIT_URL", "wss://livekit.test")
        monkeypatch.setenv("LIVEKIT_API_KEY", "key")
        monkeypatch.setenv("LIVEKIT_API_SECRET", "secret")

        mock_livekit = MagicMock()
        mock_token = MagicMock()
        mock_token.with_grants.return_value = mock_token
        mock_token.with_identity.return_value = mock_token
        mock_token.with_metadata.return_value = mock_token
        mock_token.with_ttl.return_value = mock_token
        mock_token.with_ttl.return_value = mock_token
        mock_token.to_jwt.return_value = "mock_jwt_token"
        mock_livekit.AccessToken.return_value = mock_token

        monkeypatch.setitem(sys.modules, "livekit.api", mock_livekit)

        resp = client.post("/api/voice/token", json={"tenant_id": "test", "participant_name": "user"})
        assert resp.status_code == 200
        assert resp.json()["token"] == "mock_jwt_token"

    def test_transcribe_audio_too_large(self, client):
        large_audio = b"0" * (10 * 1024 * 1024 + 1)
        resp = client.post("/api/voice/transcribe", files={"file": ("test.wav", large_audio, "audio/wav")})
        assert resp.status_code == 413

    def test_transcribe_audio_too_small(self, client):
        small_audio = b"0" * 100
        resp = client.post("/api/voice/transcribe", files={"file": ("test.wav", small_audio, "audio/wav")})
        assert resp.status_code == 200
        assert resp.json()["silence"] is True

    def test_transcribe_audio_with_hint_silence(self, client):
        audio = b"0" * 500
        resp = client.post(
            "/api/voice/transcribe",
            files={"file": ("test.wav", audio, "audio/wav")},
            data={"transcript_hint": "[SILENCE]"}
        )
        assert resp.status_code == 200
        assert resp.json()["silence"] is True

    def test_transcribe_audio_with_hint_speech(self, client):
        audio = b"0" * 500
        resp = client.post(
            "/api/voice/transcribe",
            files={"file": ("test.wav", audio, "audio/wav")},
            data={"transcript_hint": "give me the bovie for patient John Smith"}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["silence"] is False
        assert "bovie" in data["transcript"].lower()
        # The scrubber replaces the name with [REDACTED_PHI]
        assert "john smith" not in data["safe_transcript"].lower()
        assert "[redacted_phi]" in data["safe_transcript"].lower()

    @settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(st.text(alphabet=st.characters(blacklist_categories=('Cs',), blacklist_characters=['\0'])))
    def test_fuzz_voice_status(self, client, monkeypatch, text):
        monkeypatch.setenv("LIVEKIT_URL", text)
        monkeypatch.setenv("LIVEKIT_API_KEY", text)
        monkeypatch.setenv("LIVEKIT_API_SECRET", text)
        resp = client.get("/api/voice/status")
        assert resp.status_code == 200

    @settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(st.text(alphabet=st.characters(blacklist_categories=('Cs',), blacklist_characters=['\0'])), st.text(alphabet=st.characters(blacklist_categories=('Cs',), blacklist_characters=['\0'])))
    def test_fuzz_mint_token_payload(self, client, monkeypatch, tenant_id, participant_name):
        monkeypatch.setenv("LIVEKIT_URL", "wss://livekit.test")
        monkeypatch.setenv("LIVEKIT_API_KEY", "key")
        monkeypatch.setenv("LIVEKIT_API_SECRET", "secret")

        mock_livekit = MagicMock()
        mock_token = MagicMock()
        mock_token.with_grants.return_value = mock_token
        mock_token.with_identity.return_value = mock_token
        mock_token.with_metadata.return_value = mock_token
        mock_token.with_ttl.return_value = mock_token
        mock_token.with_ttl.return_value = mock_token
        mock_token.to_jwt.return_value = "mock_jwt_token"
        mock_livekit.AccessToken.return_value = mock_token
        monkeypatch.setitem(sys.modules, "livekit.api", mock_livekit)

        resp = client.post("/api/voice/token", json={"tenant_id": tenant_id, "participant_name": participant_name})
        assert resp.status_code in [200, 422]

    def test_mint_token_missing_fields(self, client, monkeypatch):
        monkeypatch.setenv("LIVEKIT_URL", "wss://livekit.test")
        monkeypatch.setenv("LIVEKIT_API_KEY", "key")
        monkeypatch.setenv("LIVEKIT_API_SECRET", "secret")

        mock_livekit = MagicMock()
        mock_token = MagicMock()
        mock_token.with_grants.return_value = mock_token
        mock_token.with_identity.return_value = mock_token
        mock_token.with_metadata.return_value = mock_token
        mock_token.with_ttl.return_value = mock_token
        mock_token.with_ttl.return_value = mock_token
        mock_token.to_jwt.return_value = "mock_jwt_token"
        mock_livekit.AccessToken.return_value = mock_token
        monkeypatch.setitem(sys.modules, "livekit.api", mock_livekit)

        resp = client.post("/api/voice/token", json={})
        assert resp.status_code == 200
        assert resp.json()["token"] == "mock_jwt_token"
        assert resp.json()["tenant_id"] == "general_memorial_cvor"

    def test_mint_token_malformed_types(self, client, monkeypatch):
        monkeypatch.setenv("LIVEKIT_URL", "wss://livekit.test")
        monkeypatch.setenv("LIVEKIT_API_KEY", "key")
        monkeypatch.setenv("LIVEKIT_API_SECRET", "secret")
        resp = client.post("/api/voice/token", json={"tenant_id": 1234, "participant_name": []})
        assert resp.status_code == 422


    @settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(st.text(alphabet=st.characters(blacklist_categories=('Cs',), blacklist_characters=['\0'])))
    def test_fuzz_transcribe_audio_with_hint_fuzz(self, client, text):
        audio = b"0" * 500
        resp = client.post(
            "/api/voice/transcribe",
            files={"file": ("test.wav", audio, "audio/wav")},
            data={"transcript_hint": text}
        )
        assert resp.status_code == 200


    def test_voice_status_offline_fallback(self, client, monkeypatch):
        # Strict offline fallback as described in memory
        monkeypatch.delenv("LIVEKIT_URL", raising=False)
        monkeypatch.delenv("LIVEKIT_API_KEY", raising=False)
        monkeypatch.delenv("LIVEKIT_API_SECRET", raising=False)
        resp = client.get("/api/voice/status")
        assert resp.status_code == 200
        data = resp.json()
        assert not data["livekit_configured"]
        assert data["mode"] == "BROWSER_WEB_SPEECH"

    def test_transcribe_audio_missing_file(self, client):
        resp = client.post("/api/voice/transcribe", data={"transcript_hint": "hint"})
        assert resp.status_code == 422
