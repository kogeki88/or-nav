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

    def test_voice_transcribe_multi_tenant_isolation(self, client):
        audio = b"0" * 500
        tenant_1 = "facility_1::dept_a"
        tenant_2 = "facility_2::dept_b"

        payload_1 = f"give me the bovie for patient John Smith in {tenant_1}"
        payload_2 = f"give me the bovie for patient John Smith in {tenant_2}"

        resp_1 = client.post(
            "/api/voice/transcribe",
            files={"file": ("test.wav", audio, "audio/wav")},
            data={"transcript_hint": payload_1, "tenant_id": tenant_1}
        )
        resp_2 = client.post(
            "/api/voice/transcribe",
            files={"file": ("test.wav", audio, "audio/wav")},
            data={"transcript_hint": payload_2, "tenant_id": tenant_2}
        )

        assert resp_1.status_code == 200
        assert resp_2.status_code == 200

        data_1 = resp_1.json()
        data_2 = resp_2.json()

        assert tenant_1 in data_1["transcript"]
        assert tenant_1 in data_1["safe_transcript"]
        assert tenant_2 not in data_1["transcript"]
        assert tenant_2 not in data_1["safe_transcript"]

        assert tenant_2 in data_2["transcript"]
        assert tenant_2 in data_2["safe_transcript"]
        assert tenant_1 not in data_2["transcript"]
        assert tenant_1 not in data_2["safe_transcript"]

    def test_voice_transcribe_offline_mutation_replay_idempotency(self, client, monkeypatch):
        import httpx
        import socket

        def mock_raise(*args, **kwargs):
            raise RuntimeError("Offline invariant violated: External network call attempted.")

        original_socket = socket.socket
        def mock_socket(*args, **kwargs):
            family = args[0] if args else kwargs.get("family", socket.AF_INET)
            if family != getattr(socket, "AF_UNIX", -1):
                raise RuntimeError("Offline invariant violated: External network call attempted.")
            return original_socket(*args, **kwargs)

        monkeypatch.setattr(socket, "socket", mock_socket)
        monkeypatch.setattr(httpx, "get", mock_raise)
        monkeypatch.setattr(httpx, "post", mock_raise)
        monkeypatch.setattr(httpx, "request", mock_raise)

        audio = b"0" * 500
        tenant_id = "facility_42::dept_99"
        payload = f"give me the bovie for patient John Smith in {tenant_id}"

        resp1 = client.post(
            "/api/voice/transcribe",
            files={"file": ("test.wav", audio, "audio/wav")},
            data={"transcript_hint": payload, "tenant_id": tenant_id}
        )
        assert resp1.status_code == 200
        data1 = resp1.json()

        resp2 = client.post(
            "/api/voice/transcribe",
            files={"file": ("test.wav", audio, "audio/wav")},
            data={"transcript_hint": payload, "tenant_id": tenant_id}
        )
        assert resp2.status_code == 200
        data2 = resp2.json()

        assert data1 == data2

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

    def test_concurrent_burst_execution(self, client, monkeypatch):
        import time
        from concurrent.futures import ThreadPoolExecutor

        monkeypatch.setenv("LIVEKIT_URL", "wss://livekit.test")
        monkeypatch.setenv("LIVEKIT_API_KEY", "key")
        monkeypatch.setenv("LIVEKIT_API_SECRET", "secret")

        mock_livekit = MagicMock()
        mock_token = MagicMock()
        mock_token.with_grants.return_value = mock_token
        mock_token.with_identity.return_value = mock_token
        mock_token.with_metadata.return_value = mock_token
        mock_token.with_ttl.return_value = mock_token
        mock_token.to_jwt.return_value = "mock_jwt_token"
        mock_livekit.AccessToken.return_value = mock_token
        monkeypatch.setitem(sys.modules, "livekit.api", mock_livekit)

        def make_request(i):
            tenant_id = f"tenant_{i}"
            start_time = time.time()
            resp = client.post("/api/voice/token", json={"tenant_id": tenant_id, "participant_name": "user"})
            end_time = time.time()
            latency = end_time - start_time
            return tenant_id, resp, latency

        results = []
        with ThreadPoolExecutor(max_workers=20) as executor:
            futures = [executor.submit(make_request, i) for i in range(50)]
            for f in futures:
                results.append(f.result())

        latencies = []
        for expected_tenant, resp, latency in results:
            assert resp.status_code == 200
            assert resp.json()["tenant_id"] == expected_tenant
            latencies.append(latency)

        avg_latency = sum(latencies) / len(latencies)
        assert avg_latency < 0.5

    def test_voice_transcribe_offline_invariant(self, client, monkeypatch):
        import httpx
        import socket

        def mock_raise(*args, **kwargs):
            raise RuntimeError("Offline invariant violated: External network call attempted.")

        original_socket = socket.socket
        def mock_socket(*args, **kwargs):
            family = args[0] if args else kwargs.get("family", socket.AF_INET)
            if family != getattr(socket, "AF_UNIX", -1):
                raise RuntimeError("Offline invariant violated: External network call attempted.")
            return original_socket(*args, **kwargs)

        monkeypatch.setattr(socket, "socket", mock_socket)
        monkeypatch.setattr(httpx, "get", mock_raise)
        monkeypatch.setattr(httpx, "post", mock_raise)
        monkeypatch.setattr(httpx, "request", mock_raise)

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
