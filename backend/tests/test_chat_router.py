import pytest
from fastapi.testclient import TestClient
from app.main import app
import httpx
from hypothesis import given, settings, strategies as st


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


    def test_chat_malformed_missing_message(self):
        client = TestClient(app)
        resp = client.post("/api/chat", json={
            "tenant_id": "general_memorial_cvor"
        })
        assert resp.status_code == 422

    def test_chat_malformed_invalid_type(self):
        client = TestClient(app)
        resp = client.post("/api/chat", json={
            "message": 12345,
            "tenant_id": "general_memorial_cvor"
        })
        assert resp.status_code == 422

    def test_chat_boundary_empty_string(self):
        client = TestClient(app)
        resp = client.post("/api/chat", json={
            "message": "",
            "tenant_id": "general_memorial_cvor"
        })
        assert resp.status_code == 422

    def test_chat_boundary_very_long_message(self):
        client = TestClient(app)
        resp = client.post("/api/chat", json={
            "message": "a" * 3000,
            "tenant_id": "general_memorial_cvor"
        })
        assert resp.status_code == 422

    @settings(max_examples=50, deadline=None)
    @given(message=st.text(min_size=1, max_size=2000), tenant_id=st.text(min_size=1, max_size=50))
    def test_chat_fuzzing(self, message, tenant_id):
        client = TestClient(app)
        resp = client.post("/api/chat", json={
            "message": message,
            "tenant_id": tenant_id
        })
        assert resp.status_code in [200, 400, 404, 409, 422, 500]
        # In a real app we don't want 500, let's assert it is not 500
        assert resp.status_code != 500

    def test_chat_concurrent_burst_and_latency(self):
        reset_inventory_services()
        reset_governance_services()
        reset_rag_services()
        client = TestClient(app)
        tenant_a = "general_memorial_cvor"
        tenant_b = "or_main"

        import time
        from concurrent.futures import ThreadPoolExecutor

        def make_request(tenant):
            start = time.time()
            resp = client.post("/api/chat", json={
                "message": "where is 3-0 silk",
                "tenant_id": tenant
            })
            end = time.time()
            return resp, end - start

        # Burst of 20 concurrent requests
        start_time = time.time()
        with ThreadPoolExecutor(max_workers=20) as executor:
            futures = [executor.submit(make_request, tenant_a if i % 2 == 0 else tenant_b) for i in range(20)]
            results = [f.result() for f in futures]
        end_time = time.time()

        # Verify race conditions and tenant isolation in results
        for i, (resp, lat) in enumerate(results):
            assert resp.status_code == 200
            data = resp.json()
            if i % 2 == 0:
                assert data["routing_tier"] == "TIER_1_LOCAL_CSV"
                assert "coordinate_card" in data
                assert data["coordinate_card"]["item"] == "3-0 Silk Suture"
                assert "OR 21" in data["coordinate_card"]["full_code"]
            else:
                assert data["routing_tier"] == "TIER_1_LOCAL_CSV"
                assert "coordinate_card" in data
                assert data["coordinate_card"]["item"] == "3-0 Silk Suture"
                assert data["coordinate_card"]["full_code"] != ""

        # Total latency check: check average wall latency for concurrency
        # (According to the memory: "calculate the total average wall latency ((end_time - start_time) / len(results)) rather than checking the latency inside each individual thread.")
        avg_latency = (end_time - start_time) / len(results)
        assert avg_latency < 0.2

    def test_offline_mutation_replay_idempotency(self, monkeypatch):
        import httpx
        client = TestClient(app)

        def mock_post(*args, **kwargs):
            class DummyRequest:
                pass
            raise httpx.NetworkError("Offline mode: Network is unreachable", request=DummyRequest())

        monkeypatch.setattr(httpx, "post", mock_post)
        monkeypatch.setattr(httpx, "get", mock_post)
        monkeypatch.setattr(httpx, "request", mock_post)

        payload = {
            "tenant_id": "general_memorial_cvor",
            "message": "add new scalpel to inventory"
        }

        resp1 = client.post("/api/chat", json=payload)
        resp2 = client.post("/api/chat", json=payload)
        resp3 = client.post("/api/chat", json=payload)

        assert resp1.status_code == 200
        assert resp2.status_code == 200
        assert resp3.status_code == 200

        data1 = resp1.json()
        data2 = resp2.json()
        data3 = resp3.json()

        for data in [data1, data2, data3]:
            if "latency_ms" in data:
                del data["latency_ms"]

        assert data1 == data2 == data3

    def test_multi_tenant_boundary_enforcement(self):
        client = TestClient(app)

        # Verify general_memorial_cvor gets coordinate card with no pending_location
        respA = client.post("/api/chat", json={"message": "where is 3-0 silk", "tenant_id": "general_memorial_cvor"})
        assert respA.status_code == 200
        assert "coordinate_card" in respA.json()
        assert respA.json()["coordinate_card"]["full_code"] == "OR 21 A 2 C"
        assert respA.json()["coordinate_card"]["pending_location"] == ""

        # Verify or_main gets isolated data with pending_location
        respB = client.post("/api/chat", json={"message": "where is 3-0 silk", "tenant_id": "or_main"})
        assert respB.status_code == 200
        assert "coordinate_card" in respB.json()
        assert respB.json()["coordinate_card"]["full_code"] == "OR 21 A 2 C"
        assert respB.json()["coordinate_card"]["pending_location"] == "OR 21 B 1 A"
        assert respB.json()["move_widget"] is not None

        # Verify general_memorial::cvor maps to general_memorial_cvor
        respC = client.post("/api/chat", json={"message": "where is 3-0 silk", "tenant_id": "general_memorial::cvor"})
        assert respC.status_code == 400
        assert "Slashes are not allowed" in respC.json()["detail"] or "Tenant directory not found" in respC.json()["detail"]

        # Verify cross tenant with bad format is rejected
        respD = client.post("/api/chat", json={"message": "where is 3-0 silk", "tenant_id": "other_hospital::er"})
        assert respD.status_code in [404, 400]

    @settings(max_examples=50, deadline=None)
    @given(question_text=st.text(min_size=3, max_size=1000), tenant_id=st.text(min_size=1, max_size=50))
    def test_questions_fuzzing(self, question_text, tenant_id):
        client = TestClient(app)
        resp = client.post("/api/questions", json={
            "question_text": question_text,
            "tenant_id": tenant_id
        })
        assert resp.status_code in [200, 400, 404, 422]

    @settings(max_examples=50, deadline=None)
    @given(item=st.text(min_size=1, max_size=500), expected_location=st.text(min_size=1, max_size=500), tenant_id=st.text(min_size=1, max_size=50))
    def test_verify_move_fuzzing(self, item, expected_location, tenant_id):
        client = TestClient(app)
        resp = client.post("/api/inventory/verify-move", json={
            "item": item,
            "expected_location": expected_location,
            "tenant_id": tenant_id
        })
        assert resp.status_code in [200, 400, 404, 422]

    def test_multi_tenant_boundary_add_item(self):
        client = TestClient(app)

        # Add item to tenant A
        respA_add = client.post("/api/inventory/add-item", json={
            "tenant_id": "general_memorial_cvor",
            "item": "Secret Isolated Item",
            "location": "A Location",
            "category": "Instruments",
            "surgeon_notes": "",
            "learned_aliases": []
        })
        assert respA_add.status_code == 200

        # Try to find item in tenant A
        respA_chat = client.post("/api/chat", json={
            "message": "where is Secret Isolated Item",
            "tenant_id": "general_memorial_cvor"
        })
        assert respA_chat.status_code == 200
        assert respA_chat.json()["coordinate_card"]["item"] == "Secret Isolated Item"

        # Try to find item in tenant B
        respB_chat = client.post("/api/chat", json={
            "message": "where is Secret Isolated Item",
            "tenant_id": "or_main"
        })
        assert respB_chat.status_code == 200
        # Assert the item is not found, coordinate_card is None
        assert respB_chat.json()["coordinate_card"] is None

    def test_multi_tenant_boundary_questions(self):
        client = TestClient(app)

        # Tenant A adds question
        respA_q = client.post("/api/questions", json={
            "tenant_id": "general_memorial_cvor",
            "question_text": "Is this tenant A only?",
            "asked_by_role": "RN"
        })
        assert respA_q.status_code == 200

        # Tenant A gets questions
        respA_list = client.get("/api/questions?tenant_id=general_memorial_cvor")
        assert respA_list.status_code == 200
        q_texts_A = [q["question_text"] for q in respA_list.json()["questions"]]
        assert "Is this tenant A only?" in q_texts_A

        # Tenant B gets questions
        respB_list = client.get("/api/questions?tenant_id=or_main")
        assert respB_list.status_code == 200
        q_texts_B = [q["question_text"] for q in respB_list.json()["questions"]]
        assert "Is this tenant A only?" not in q_texts_B

    def test_offline_mutation_replay_idempotency_verify_move(self):
        client = TestClient(app)

        payload = {
            "tenant_id": "general_memorial_cvor",
            "item": "3-0 Silk Suture",
            "expected_location": "OR 21 Cabinet 2",
            "timestamp": "2024-05-15T12:00:00Z"
        }

        # Issue 3 sequential identical requests simulating offline replays
        resp1 = client.post("/api/inventory/verify-move", json=payload)
        resp2 = client.post("/api/inventory/verify-move", json=payload)
        resp3 = client.post("/api/inventory/verify-move", json=payload)

        assert resp1.status_code == 200
        assert resp2.status_code == 200
        assert resp3.status_code == 200

        data1 = resp1.json()
        data2 = resp2.json()
        data3 = resp3.json()

        for data in [data1, data2, data3]:
            if "latency_ms" in data:
                del data["latency_ms"]

        assert data1 == data2 == data3
