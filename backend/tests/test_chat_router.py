import pytest
from fastapi.testclient import TestClient
from app.main import app
import httpx

class TestChatRouterMultiTenant:
    """Rigorous Unit & Regression Tests for ChatRouterMultiTenant"""

    @pytest.fixture(autouse=True)
    def enforce_offline_first(self, monkeypatch):
        """Poison httpx instead of socket, to avoid breaking ASGI loop creation."""
        def mock_httpx_post(*args, **kwargs):
            raise RuntimeError("Network call attempted during offline-first test")
        monkeypatch.setattr(httpx, "post", mock_httpx_post)
        monkeypatch.setattr(httpx, "get", mock_httpx_post)
        monkeypatch.setattr(httpx, "request", mock_httpx_post)

    def test_tenant_isolation_general_memorial(self):
        client = TestClient(app)
        resp = client.post("/api/chat", json={
            "message": "where is 3-0 silk",
            "tenant_id": "general_memorial_cvor"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["routing_tier"] == "TIER_1_LOCAL_CSV"
        assert data["coordinate_card"]["item"] == "3-0 Silk Suture"
        assert "OR 21" in data["coordinate_card"]["full_code"]

    def test_tenant_isolation_or_main(self):
        client = TestClient(app)
        resp = client.post("/api/chat", json={
            "message": "where is 3-0 silk",
            "tenant_id": "or_main"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["routing_tier"] == "TIER_1_LOCAL_CSV"
        assert data["coordinate_card"]["item"] == "3-0 Silk Suture"
        assert data["coordinate_card"]["full_code"] != ""
        # The exact code depends on the tenant data, but we assert they resolve

    def test_tenant_path_traversal_rejection(self):
        client = TestClient(app)
        resp = client.post("/api/chat", json={
            "message": "where is 3-0 silk",
            "tenant_id": "../../../etc/passwd"
        })
        assert resp.status_code == 400
        assert "Invalid tenant_id" in resp.json()["detail"] or "Path traversal" in resp.json()["detail"]

    def test_tenant_invalid_slash_rejection(self):
        client = TestClient(app)
        resp = client.post("/api/chat", json={
            "message": "where is 3-0 silk",
            "tenant_id": "general/memorial"
        })
        assert resp.status_code == 400
        assert "Slashes are not allowed" in resp.json()["detail"]

    def test_tenant_double_colon_normalization(self):
        client = TestClient(app)
        # Even if valid, general_memorial::cvor doesn't necessarily exist,
        # but it shouldn't hit the 400 'Slashes are not allowed' error,
        # it should pass validation and then get a 404 or 200 depending on if dir exists.
        resp = client.post("/api/chat", json={
            "message": "where is 3-0 silk",
            "tenant_id": "sacred_heart::or"
        })
        assert resp.status_code in [404, 200]
        if resp.status_code == 404:
            assert "Tenant directory not found" in resp.json()["detail"]

    def test_inventory_sync_tenant_isolation(self):
        client = TestClient(app)
        resp = client.get("/api/inventory/sync?tenant_id=general_memorial_cvor")
        assert resp.status_code == 200
        data = resp.json()
        assert data["tenant_id"] == "general_memorial_cvor"
        assert "items" in data

    def test_voice_query_silence_fallback(self):
        client = TestClient(app)
        # 1-byte file which is < _MIN_AUDIO_BYTES (400)
        file_content = b"0"
        files = {"file": ("audio.wav", file_content, "audio/wav")}
        data = {"tenant_id": "or_main"}
        resp = client.post("/api/v1/voice-query", files=files, data=data)
        assert resp.status_code == 200
        js = resp.json()
        assert js.get("silence") is True
        assert js.get("safe_transcript") == ""

    def test_voice_query_invalid_tenant(self):
        client = TestClient(app)
        file_content = b"0"
        files = {"file": ("audio.wav", file_content, "audio/wav")}
        data = {"tenant_id": "../invalid"}
        resp = client.post("/api/v1/voice-query", files=files, data=data)
        assert resp.status_code == 400
