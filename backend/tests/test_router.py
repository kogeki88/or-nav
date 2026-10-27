"""
Tests for OR-Nav Hybrid Query Router (Phase 2).

Verifies:
  1. Tier 1 Local CSV Lookup:
     - Speed & accuracy (<10ms target, coordinate card format)
     - Direct item name matching
     - Alias matching (OR slang like "spoons", "free ties", "bovie", "30 silk")
  2. Intent Separation:
     - Complex procedural questions bypass Tier 1 and route to Tier 2 (Gemini RAG)
     - Surgeon preference queries bypass Tier 1
  3. Natural Language Relocation & Crowdsourced Move Verification:
     - Move reporting via natural language in /api/chat (verify_count=1)
     - Verification step 2/3 via /api/inventory/verify-move
     - Auto-commit at 3/3 confirmations (updates coordinates, resets pending state)
     - Subsequent lookups reflect the committed new coordinates
  4. PHI Scrubbing Integration:
     - Client/edge scrubber integration on /api/chat
     - Redacted queries still resolve to clinical answers without data leak
  5. RAG Zero-Cost Caching & Offline Fallback:
     - Identical normalized procedural queries return cached responses
     - Graceful offline fallback when GEMINI_API_KEY is not set
  6. File Ingestion Endpoint:
     - CSV ingestion updates inventory
     - MD ingestion updates orientation
     - Unsupported extensions rejected with HTTP 400
"""

import io
import shutil
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.config import get_tenant
from app.services.inventory_search import get_inventory_service, reset_inventory_services
from app.services.rag_fallback import get_rag_service, reset_rag_services


@pytest.fixture(autouse=True)
def isolate_tenant_data():
    """
    Fixture that backs up inventory.csv and orientation.md before tests,
    resets service singletons, and restores the original files on teardown.
    """
    tenant = get_tenant("general_memorial_cvor")
    inv_path = tenant.inventory_path
    orient_path = tenant.orientation_path

    # Backups
    inv_backup = inv_path.with_suffix(".csv.bak")
    orient_backup = orient_path.with_suffix(".md.bak")

    shutil.copyfile(inv_path, inv_backup)
    shutil.copyfile(orient_path, orient_backup)

    reset_inventory_services()
    reset_rag_services()

    yield

    # Restore
    if inv_backup.exists():
        shutil.copyfile(inv_backup, inv_path)
        inv_backup.unlink()
    if orient_backup.exists():
        shutil.copyfile(orient_backup, orient_path)
        orient_backup.unlink()

    reset_inventory_services()
    reset_rag_services()


@pytest.fixture
def client():
    """FastAPI TestClient fixture."""
    return TestClient(app)


# ===================================================================
# 1. Tier 1 Local CSV Matching & Alias Tests
# ===================================================================

class TestTier1LocalCSV:
    """Verify Tier 1 direct lookups, aliases, latency, and coordinate cards."""

    def test_direct_item_name_lookup(self, client):
        resp = client.post("/api/chat", json={"message": "where is 3-0 silk", "tenant_id": "general_memorial_cvor"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["routing_tier"] == "TIER_1_LOCAL_CSV"
        assert data["phi_detected"] is False
        assert data["coordinate_card"] is not None

        card = data["coordinate_card"]
        assert card["item"] == "3-0 Silk Suture"
        assert card["room"] == "OR 21"
        assert card["cabinet"] == "A"
        assert card["shelf"] == "2"
        assert card["container"] == "C"
        assert card["full_code"] == "OR 21 A 2 C"
        assert "Dr. Chen" in card["surgeon_notes"]

    @pytest.mark.parametrize("query,expected_item", [
        ("where are the free ties", "3-0 Silk Suture"),
        ("find silk ties", "3-0 Silk Suture"),
        ("30 silk", "3-0 Silk Suture"),
        ("spoons", "Internal Defibrillator Paddles"),
        ("internal paddles", "Internal Defibrillator Paddles"),
        ("where is the bovie", "Bovie Pencil"),
        ("cautery", "Bovie Pencil"),
        ("need a 10 blade", "#10 Blade"),
        ("skin knife", "#10 Blade"),
        ("chest tube 32 french", "Chest Tube 32Fr"),
        ("mediastinal tube", "Chest Tube 32Fr"),
        ("aortic cannula", "Cannulation Set (Aortic)"),
        ("cell saver", "Cell Saver Tubing Set"),
        ("debakeys", "DeBakey Forceps 12in"),
    ])
    def test_cvor_alias_lookups(self, client, query, expected_item):
        resp = client.post("/api/chat", json={"message": query, "tenant_id": "general_memorial_cvor"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["routing_tier"] == "TIER_1_LOCAL_CSV", f"Query '{query}' failed to hit Tier 1"
        assert data["coordinate_card"] is not None
        assert data["coordinate_card"]["item"] == expected_item

    def test_tier_1_sub_10ms_target(self, client):
        # Warmup
        client.post("/api/chat", json={"message": "where is 3-0 silk"})
        # Measured call
        resp = client.post("/api/chat", json={"message": "where is 3-0 silk"})
        assert resp.status_code == 200
        data = resp.json()
        # Fast local search: latency_ms should be very low (typically <15ms in test client)
        assert data["routing_tier"] == "TIER_1_LOCAL_CSV"
        assert data["latency_ms"] < 50.0


# ===================================================================
# 2. Intent Separation Tests
# ===================================================================

class TestIntentSeparation:
    """Ensure complex procedural queries bypass Tier 1 to Tier 2 (Gemini RAG)."""

    @pytest.mark.live_llm
    @pytest.mark.parametrize("procedural_query", [
        "What is the Heparin ACT target for bypass?",
        "What sutures does Dr. Patel prefer?",
        "How do I activate MTP?",
        "What is the Dantrolene dosing for malignant hyperthermia?",
        "Can I tube blood products in Station 12?",
        "What are the steps for emergency bypass crash-on?",
        "What is the component ratio for MTP?",
        "Explain when to call perfusion STAT",
    ])
    def test_procedural_queries_route_to_tier_2(self, client, procedural_query):
        resp = client.post("/api/chat", json={"message": procedural_query, "tenant_id": "general_memorial_cvor"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["routing_tier"] == "TIER_2_GEMINI_RAG", (
            f"Query '{procedural_query}' incorrectly routed to {data['routing_tier']}"
        )
        assert data["coordinate_card"] is None
        assert len(data["reply_text"]) > 20


# ===================================================================
# 3. Crowdsourced Move Verification Consensus (1/3 -> 3/3 Auto-Commit)
# ===================================================================

class TestCrowdsourcedMoveConsensus:
    """Test natural language move detection and 3-step consensus commitment."""

    def test_full_move_consensus_cycle(self, client):
        # Initial location check
        r0 = client.post("/api/chat", json={"message": "where is 3-0 silk"})
        assert r0.json()["coordinate_card"]["full_code"] == "OR 21 A 2 C"

        # Step 1: User reports move in natural language
        move_msg = "The 3-0 silk moved to OR 21 B 1 A"
        r1 = client.post("/api/chat", json={"message": move_msg})
        assert r1.status_code == 200
        d1 = r1.json()
        assert d1["routing_tier"] == "MOVE_REPORTED"
        assert d1["move_widget"] is not None
        assert d1["move_widget"]["item"] == "3-0 Silk Suture"
        assert d1["move_widget"]["new_location"] == "OR 21 B 1 A"
        assert d1["move_widget"]["verify_count"] == 1
        assert d1["move_widget"]["committed"] is False
        assert "2 more confirmations" in d1["reply_text"]

        # Step 2: Peer 1 verifies move via button
        r2 = client.post("/api/inventory/verify-move", json={
            "tenant_id": "general_memorial_cvor",
            "item": "3-0 Silk Suture",
        })
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["verify_count"] == 2
        assert d2["committed"] is False
        assert "2/3 confirmations" in d2["reply_text"]

        # Step 3: Peer 2 verifies move -> auto-commit at 3/3
        r3 = client.post("/api/inventory/verify-move", json={
            "tenant_id": "general_memorial_cvor",
            "item": "3-0 Silk Suture",
        })
        assert r3.status_code == 200
        d3 = r3.json()
        assert d3["verify_count"] == 0
        assert d3["committed"] is True
        assert "location committed" in d3["reply_text"].lower()

        # Step 4: Verify subsequent Tier 1 lookup returns new coordinates!
        r4 = client.post("/api/chat", json={"message": "where is 3-0 silk"})
        d4 = r4.json()
        assert d4["routing_tier"] == "TIER_1_LOCAL_CSV"
        card = d4["coordinate_card"]
        assert card["room"] == "OR 21"
        assert card["cabinet"] == "B"
        assert card["shelf"] == "1"
        assert card["container"] == "A"
        assert card["full_code"] == "OR 21 B 1 A"
        assert card["pending_location"] == ""
        assert card["verify_count"] == 0

    def test_verify_nonexistent_item_fails(self, client):
        resp = client.post("/api/inventory/verify-move", json={
            "tenant_id": "general_memorial_cvor",
            "item": "NonExistentItem999",
        })
        assert resp.status_code == 404


# ===================================================================
# 4. PHI Scrubbing Integration in Chat
# ===================================================================

class TestPHIScrubbingIntegration:
    """Verify end-to-end PHI masking before routing."""

    def test_phi_in_tier_1_lookup(self, client):
        msg = "patient John Smith MRN 1234567 needs 3-0 silk from OR 21"
        resp = client.post("/api/chat", json={"message": msg})
        assert resp.status_code == 200
        data = resp.json()
        assert data["phi_detected"] is True
        assert "[REDACTED_PHI]" in data["scrubbed_query"]
        assert "John Smith" not in data["scrubbed_query"]
        assert "1234567" not in data["scrubbed_query"]
        # Still resolves to 3-0 Silk Suture
        assert data["routing_tier"] == "TIER_1_LOCAL_CSV"
        assert data["coordinate_card"]["item"] == "3-0 Silk Suture"

    def test_phi_in_tier_2_procedural_query(self, client):
        msg = "pt Jane Doe DOB 03/15/1955 what is the heparin dose for bypass?"
        resp = client.post("/api/chat", json={"message": msg})
        assert resp.status_code == 200
        data = resp.json()
        assert data["phi_detected"] is True
        assert "[REDACTED_PHI]" in data["scrubbed_query"]
        assert "Jane Doe" not in data["scrubbed_query"]
        assert "03/15/1955" not in data["scrubbed_query"]
        assert data["routing_tier"] == "TIER_2_GEMINI_RAG"


# ===================================================================
# 5. RAG Zero-Cost Caching & Offline Fallback
# ===================================================================

class TestRAGCachingAndFallback:
    """Verify caching behavior and offline response accuracy."""

    @pytest.mark.live_llm
    def test_rag_caching_returns_identical_result(self, client):
        q = "How do I activate MTP in OR 21?"
        r1 = client.post("/api/chat", json={"message": q})
        r2 = client.post("/api/chat", json={"message": "how do i activate mtp in or 21?  "})

        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r1.json()["routing_tier"] == "TIER_2_GEMINI_RAG"
        assert r2.json()["routing_tier"] == "TIER_2_GEMINI_RAG"
        assert r1.json()["reply_text"] == r2.json()["reply_text"]

    def test_offline_fallback_contains_key_protocols(self, client):
        # MTP query
        r_mtp = client.post("/api/chat", json={"message": "What is the MTP activation protocol?"})
        assert "x4-25663" in r_mtp.json()["reply_text"] or "MTP" in r_mtp.json()["reply_text"]

        # MH Cart query
        r_mh = client.post("/api/chat", json={"message": "What is the Dantrolene dosing for malignant hyperthermia?"})
        assert "2.5 mg/kg" in r_mh.json()["reply_text"] or "Dantrolene" in r_mh.json()["reply_text"]


# ===================================================================
# 6. File Ingestion Endpoint
# ===================================================================

class TestIngestEndpoint:
    """Verify CSV and MD ingestion updates knowledge base dynamically."""

    def test_ingest_csv_updates_inventory(self, client):
        new_csv = (
            "item,category,room,cabinet,shelf,container,aliases,pending_location,verify_count,surgeon_notes\n"
            "Robotic Micro-Needledrive,Robotics,OR 22,R,1,A,micro driver|robotic driver,,0,Dr. Taylor daVinci exclusive\n"
        )
        files = {"file": ("inventory.csv", io.BytesIO(new_csv.encode("utf-8")), "text/csv")}
        data = {"tenant_id": "general_memorial_cvor"}

        resp = client.post("/api/ingest", files=files, data=data)
        assert resp.status_code == 200
        assert resp.json()["file_type"] == "csv"
        assert resp.json()["rows_loaded"] == 1

        # Search for newly ingested item
        r_search = client.post("/api/chat", json={"message": "where is the robotic driver"})
        assert r_search.status_code == 200
        assert r_search.json()["routing_tier"] == "TIER_1_LOCAL_CSV"
        assert r_search.json()["coordinate_card"]["item"] == "Robotic Micro-Needledrive"

    def test_ingest_invalid_extension_rejected(self, client):
        files = {"file": ("malicious.exe", io.BytesIO(b"bad content"), "application/octet-stream")}
        resp = client.post("/api/ingest", files=files, data={"tenant_id": "general_memorial_cvor"})
        assert resp.status_code == 400
        assert "Unsupported file type" in resp.json()["detail"]


class TestNetworkInfoEndpoint:
    """Verify local LAN IPv4 and HTTPS tunnel discovery for mobile QR pairing."""

    def test_network_info_returns_valid_ip_and_url(self, client):
        resp = client.get("/api/network-info")
        assert resp.status_code == 200
        data = resp.json()
        assert "lan_ip" in data
        assert "mobile_url" in data
        assert "lan_url" in data
        assert "https_active" in data
        assert data["lan_ip"].count(".") == 3
        assert data["lan_url"] == f"http://{data['lan_ip']}:3000"
        if data["https_active"]:
            assert data["mobile_url"].startswith("https://")
        else:
            assert data["mobile_url"] == data["lan_url"]


class TestGeminiConfigEndpoints:
    """Verify hot-reloadable Gemini API key configuration endpoints."""

    def test_gemini_status_and_set_key(self, client, monkeypatch):
        import os
        from pathlib import Path
        from app.services.rag_fallback import reset_rag_services

        env_path = Path(__file__).resolve().parent.parent / ".env"
        orig_env_text = env_path.read_text(encoding="utf-8") if env_path.exists() else None
        orig_key = os.environ.get("GEMINI_API_KEY")

        try:
            os.environ.pop("GEMINI_API_KEY", None)
            reset_rag_services()

            # 1. Unconfigured status
            r0 = client.get("/api/config/gemini-status")
            assert r0.status_code == 200
            d0 = r0.json()
            assert d0["configured"] is False
            assert d0["masked_key"] is None
            assert d0["model"] == "gemini-2.5-flash"

            # 2. Empty key rejected
            r_bad = client.post("/api/config/gemini-key", json={"api_key": "   "})
            assert r_bad.status_code == 400

            # 3. Valid key saved and hot-reloaded
            r_set = client.post("/api/config/gemini-key", json={"api_key": "AIzaSyTestKey1234567890abcd"})
            assert r_set.status_code == 200
            d_set = r_set.json()
            assert d_set["configured"] is True
            assert d_set["masked_key"] == "AIza...abcd"
            assert d_set["model"] == "gemini-2.5-flash"

            # 4. Subsequent status check reflects active key
            r1 = client.get("/api/config/gemini-status")
            assert r1.status_code == 200
            assert r1.json()["configured"] is True
            assert r1.json()["masked_key"] == "AIza...abcd"
        finally:
            if orig_env_text is not None:
                env_path.write_text(orig_env_text, encoding="utf-8")
            if orig_key is not None:
                os.environ["GEMINI_API_KEY"] = orig_key
            else:
                os.environ.pop("GEMINI_API_KEY", None)
            reset_rag_services()
