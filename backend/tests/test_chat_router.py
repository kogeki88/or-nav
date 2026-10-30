import pytest
from fastapi.testclient import TestClient
from app.main import app
import httpx

from app.services.inventory_search import reset_inventory_services
from app.services.governance import reset_governance_services
from app.services.rag_fallback import reset_rag_services

class TestChatRouterMultiTenant:
    """Rigorous Unit & Regression Tests for ChatRouterMultiTenant"""





    @pytest.fixture(autouse=True)
    def mock_tenant_data_paths(self, tmp_path, monkeypatch):
        """Mock tenant paths to prevent modifying real hospital data."""
        import shutil
        import pathlib
        from app.config import get_tenant, TenantConfig

        # Copy the whole hospitals directory to tmp_path
        hospitals_dir = pathlib.Path("hospitals")
        tmp_hospitals = tmp_path / "hospitals"
        shutil.copytree(hospitals_dir, tmp_hospitals)

        orig_get_tenant = get_tenant

        def mock_get_tenant_paths(tenant_id):
            orig_tenant = orig_get_tenant(tenant_id)
            # Create a new TenantConfig using tmp_hospitals
            return TenantConfig(
                tenant_id=orig_tenant.tenant_id,
                display_name=orig_tenant.display_name,
                inventory_path=tmp_hospitals / orig_tenant.tenant_id / "inventory.csv",
                orientation_path=tmp_hospitals / orig_tenant.tenant_id / "orientation.md"
            )

        # Mock globally for any module that calls it dynamically
        monkeypatch.setattr("app.config.get_tenant", mock_get_tenant_paths)

        # Patch check_tenant in chat router, which uses get_tenant
        import app.routers.chat
        if hasattr(app.routers.chat, "check_tenant"):
            from fastapi import HTTPException
            def mock_check_tenant(tenant_id):
                try:
                    return mock_get_tenant_paths(tenant_id)
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))
            monkeypatch.setattr("app.routers.chat.check_tenant", mock_check_tenant)

        import app.config
        monkeypatch.setattr(app.config, "HOSPITALS_DIR", tmp_hospitals)
        import app.services.governance
        monkeypatch.setattr(app.services.governance, "HOSPITALS_DIR", tmp_hospitals)
        import app.services.lexicon_learning
        monkeypatch.setattr(app.services.lexicon_learning, "HOSPITALS_DIR", tmp_hospitals)

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
        assert "Slashes are not allowed" in resp.json()["detail"] or "Tenant directory not found" in resp.json()["detail"]

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

    def test_flag_wrong(self):
        client = TestClient(app)
        # We assume general_memorial_cvor has 3-0 Silk Suture
        resp = client.post("/api/inventory/flag-wrong", json={
            "tenant_id": "general_memorial_cvor",
            "item": "3-0 Silk Suture",
            "reason": "Missing"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["item"] == "3-0 Silk Suture"
        assert data["status"] == "needs_reverification"
        assert data["verification_score"] == 0.5

        # Test 404
        resp404 = client.post("/api/inventory/flag-wrong", json={
            "tenant_id": "general_memorial_cvor",
            "item": "nonexistent item",
            "reason": "Missing"
        })
        assert resp404.status_code == 404

    def test_verify_move(self):
        client = TestClient(app)
        resp = client.post("/api/inventory/verify-move", json={
            "tenant_id": "general_memorial_cvor",
            "item": "3-0 Silk Suture",
            "expected_location": "OR 21 Cabinet 2"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["item"] == "3-0 Silk Suture"
        assert "verify_count" in data

    def test_add_item(self):
        client = TestClient(app)
        resp = client.post("/api/inventory/add-item", json={
            "tenant_id": "general_memorial_cvor",
            "item": "New Scalpel",
            "location": "OR 15 Cab 1 Shelf 2 Bin 3",
            "category": "Instruments",
            "surgeon_notes": "",
            "learned_aliases": []
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["item"] == "New Scalpel"
        assert "OR 15" in data["full_code"]

    def test_questions_flow(self):
        client = TestClient(app)

        # Create question
        resp = client.post("/api/questions", json={
            "tenant_id": "general_memorial_cvor",
            "question_text": "Where do we keep the new staplers?",
            "asked_by_role": "RN"
        })
        assert resp.status_code == 200
        q_data = resp.json()
        q_id = q_data["id"]
        assert q_data["status"] == "open"

        # Answer question
        resp_ans = client.post(f"/api/questions/{q_id}/answer", json={
            "tenant_id": "general_memorial_cvor",
            "answer_text": "In the supply room on shelf 4",
            "confidence": "confident",
            "responder_role": "Charge Nurse",
            "promote_to_verified": True
        })
        assert resp_ans.status_code == 200
        assert resp_ans.json()["status"] == "verified"

        # List questions
        resp_list = client.get("/api/questions?tenant_id=general_memorial_cvor")
        assert resp_list.status_code == 200
        assert "questions" in resp_list.json()

    def test_ingest_csv(self):

        client = TestClient(app)

        # Mock file write
        csv_content = b"item,category,room,cabinet,shelf,container,aliases,surgeon_notes\ntest item,supplies,OR 1,Cab 1,Shelf 1,Box 1,,notes"
        resp = client.post("/api/ingest", data={"tenant_id": "general_memorial_cvor"}, files={"file": ("test.csv", csv_content, "text/csv")})
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
        assert resp.json()["file_type"] == "csv"

    def test_ingest_md(self):

        client = TestClient(app)
        md_content = b"# Orientation\nWelcome to CVOR."
        resp = client.post("/api/ingest", data={"tenant_id": "general_memorial_cvor"}, files={"file": ("orientation.md", md_content, "text/markdown")})
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
        assert resp.json()["file_type"] == "markdown"
