"""
Phase 16 Adversarial Edge-Case, Chaos & Concurrency Torture Gauntlet.
Covers Vectors 1 through 5:
  Vector 1: Suture-Gauge Phonetic Collisions & False-Positive Guard
  Vector 2: Adversarial PHI Scrubbing vs Clinical Numbers
  Vector 3: Concurrent File Write Race Conditions (15 parallel writes)
  Vector 4: Strict Multi-Tenant Isolation & Path Traversal Guard
  Vector 5: Malformed Audio, Oversized Payloads & Broken CSV Ingestion
"""

import asyncio
import io
import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import pytest
from httpx import AsyncClient, ASGITransport

from app.config import get_tenant, HOSPITALS_DIR
from app.main import app
from app.scrubber import scrub_phi, REDACTION
from app.services.inventory_search import InventoryService, get_inventory_service
from app.services.governance import get_governance_service
from app.services.rag_fallback import get_rag_service


@pytest.fixture
def inv_service():
    tenant = get_tenant("general_memorial_cvor")
    return InventoryService(tenant)


# ===========================================================================
# Vector 1: Suture-Gauge Phonetic Collisions & False-Positive Guard
# ===========================================================================
class TestVector1SutureGaugeGuard:
    def test_conflicting_suture_gauge_returns_none(self, inv_service):
        """Querying 5-0 prolene must NOT match 4-0 Prolene or 2-0 Prolene."""
        res = inv_service.search("where is 5-0 prolene")
        assert res is None

    def test_exact_suture_gauge_returns_correct_item(self, inv_service):
        """Querying 2-0 prolene must match 2-0 Prolene Suture."""
        res = inv_service.search("where is 2-0 prolene")
        assert res is not None
        assert res["item"] == "2-0 Prolene Suture"

    def test_suture_material_conflict_guard(self, inv_service):
        """Querying 2-0 silk must NOT match 2-0 Prolene Suture (material conflict)."""
        res = inv_service.search("where is 2-0 silk")
        assert res is None

    def test_silk_gauge_mismatches_return_none(self, inv_service):
        """Querying 7-0 silk or 4-0 silk must NOT match Prolene items."""
        assert inv_service.search("where is 7-0 silk") is None
        assert inv_service.search("where is 4-0 silk") is None

    def test_valid_silk_matches_exact_item(self, inv_service):
        """Querying 3-0 silk must match 3-0 Silk Suture."""
        res = inv_service.search("where is 3-0 silk")
        assert res is not None
        assert res["item"] == "3-0 Silk Suture"

    def test_french_size_conflict_guard(self, inv_service):
        """Querying 18Fr chest tube must NOT match Chest Tube 32Fr."""
        res = inv_service.search("where is 18Fr chest tube")
        assert res is None

    def test_exact_french_size_matches(self, inv_service):
        """Querying 32Fr chest tube matches Chest Tube 32Fr."""
        res = inv_service.search("where is 32Fr chest tube")
        assert res is not None
        assert res["item"] == "Chest Tube 32Fr"

    def test_complete_gibberish_returns_none(self, inv_service):
        """Querying non-medical gibberish must never trigger fuzzy match."""
        res = inv_service.search("where is the pepperoni pizza")
        assert res is None


# ===========================================================================
# Vector 2: Adversarial PHI Scrubbing vs Clinical Numbers
# ===========================================================================
class TestVector2AdversarialPhiScrubbing:
    def test_adversarial_cvor_sentence_scrubbing(self, inv_service):
        raw_text = (
            "Patient Robert Miller, DOB 11/04/1962, MRN 7382910 in OR 21 "
            "needs 4-0 Prolene RB-1 and Heparin 300 units/kg for ACT over 480"
        )
        scrubbed = scrub_phi(raw_text)

        # 1. Verify PHI is 100% redacted
        assert "Robert Miller" not in scrubbed.text
        assert "11/04/1962" not in scrubbed.text
        assert "7382910" not in scrubbed.text
        assert scrubbed.redaction_count == 3
        assert REDACTION in scrubbed.text

        # 2. Verify clinical numbers and parameters are 100% preserved
        assert "OR 21" in scrubbed.text
        assert "4-0" in scrubbed.text
        assert "RB-1" in scrubbed.text
        assert "300" in scrubbed.text
        assert "480" in scrubbed.text

        # 3. Verify downstream search cleanly resolves 4-0 Prolene Suture
        match = inv_service.search(scrubbed.text)
        assert match is not None
        assert match["item"] == "4-0 Prolene Suture"


# ===========================================================================
# Vector 3: Concurrent File Write Race Conditions
# ===========================================================================
class TestVector3ConcurrentFileWrites:
    @pytest.mark.anyio
    async def test_concurrent_15_writes_no_corruption(self):
        """Fire 15 concurrent writes to moves, flag-wrong, and questions."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            async def report_move_task(idx):
                payload = {
                    "message": f"The 4x4 Gauze moved to OR 21 B {idx % 5 + 1} A",
                    "tenant_id": "general_memorial_cvor",
                }
                return await client.post("/api/chat", json=payload)

            async def flag_wrong_task(idx):
                payload = {
                    "item": "Internal Defibrillator Paddles",
                    "reason": f"Concurrent test flag {idx}",
                    "tenant_id": "general_memorial_cvor",
                }
                return await client.post("/api/inventory/flag-wrong", json=payload)

            async def post_question_task(idx):
                payload = {
                    "question_text": f"Concurrent question {idx} regarding cannula?",
                    "asked_by_role": "CVOR Orientee RN",
                    "tenant_id": "general_memorial_cvor",
                }
                return await client.post("/api/questions", json=payload)

            tasks = []
            for i in range(5):
                tasks.append(report_move_task(i))
                tasks.append(flag_wrong_task(i))
                tasks.append(post_question_task(i))

            responses = await asyncio.gather(*tasks, return_exceptions=True)

            for idx, r in enumerate(responses):
                assert not isinstance(r, Exception), f"Task {idx} failed with {r}"
                assert r.status_code == 200, f"Task {idx} returned {r.status_code}: {r.text}"


# ===========================================================================
# Vector 4: Strict Multi-Tenant Isolation & Path Traversal Guard
# ===========================================================================
class TestVector4MultiTenantAndPathTraversal:
    @pytest.mark.anyio
    async def test_path_traversal_rejected_with_400(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            for bad_tenant in ["../../etc/passwd", "..\\..\\windows", "bad/tenant", "../general_memorial_cvor"]:
                r = await client.post("/api/chat", json={"message": "where is 3-0 silk", "tenant_id": bad_tenant})
                assert r.status_code == 400

                r2 = await client.get(f"/api/inventory/sync?tenant_id={bad_tenant}")
                assert r2.status_code == 400

    def test_tenant_rag_cache_key_isolation(self):
        """Verify cache keys in RAGService incorporate tenant_id."""
        t1 = get_tenant("general_memorial_cvor")
        rag1 = get_rag_service("general_memorial_cvor")
        k1 = rag1._cache_key("heparin dose")

        assert "general_memorial_cvor" in rag1.tenant.tenant_id
        # Cache key should be uniquely determined by tenant + query
        import hashlib
        expected = hashlib.md5("general_memorial_cvor::heparin dose".encode()).hexdigest()
        assert k1 == expected

    @pytest.mark.anyio
    async def test_multi_tenant_state_isolation(self):
        """Create secondary tenant 'test_st_jude_cvor' and verify zero state bleed."""
        secondary_dir = HOSPITALS_DIR / "test_st_jude_cvor"
        secondary_dir.mkdir(parents=True, exist_ok=True)
        try:
            # Write minimal inventory.csv for secondary tenant
            csv_content = (
                "item,category,room,cabinet,shelf,container,aliases,pending_location,verify_count,surgeon_notes,human_alias,verification_score,status,last_verified_at\n"
                "St Jude Mechanical Valve 27mm,Valves,OR 12,A,1,A,st jude valve|mechanical valve,,0,Dr. Adams only,OR 12 · Cart A · Shelf 1 · Bin A,3.0,verified,2026-10-20T08:00:00Z\n"
            )
            (secondary_dir / "inventory.csv").write_text(csv_content, encoding="utf-8")
            (secondary_dir / "orientation.md").write_text("# St Jude CVOR Orientation", encoding="utf-8")

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                # Query item that only exists in secondary tenant
                r_sec = await client.post("/api/chat", json={"message": "where is St Jude Mechanical Valve 27mm", "tenant_id": "test_st_jude_cvor"})
                assert r_sec.status_code == 200
                assert r_sec.json()["coordinate_card"]["item"] == "St Jude Mechanical Valve 27mm"

                # Query same item in general_memorial_cvor -> must not find it in Tier 1
                r_gen = await client.post("/api/chat", json={"message": "where is St Jude Mechanical Valve 27mm", "tenant_id": "general_memorial_cvor"})
                assert r_gen.status_code == 200
                assert r_gen.json()["coordinate_card"] is None
        finally:
            if secondary_dir.exists():
                shutil.rmtree(secondary_dir)


# ===========================================================================
# Vector 5: Malformed Audio, Oversized Payloads & Broken CSV Ingestion
# ===========================================================================
class TestVector5MalformedAudioAndBrokenCsv:
    @pytest.mark.anyio
    async def test_zero_byte_audio_returns_200_silence(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            files = {"file": ("empty.webm", io.BytesIO(b""), "audio/webm")}
            r = await client.post("/api/v1/voice-query", files=files)
            assert r.status_code == 200
            assert r.json().get("silence") is True

    @pytest.mark.anyio
    async def test_corrupt_binary_garbage_returns_200_handled(self):
        """Random 2500 bytes of non-audio binary garbage must return 200 without throwing 500."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            garbage = b"\x00\xff\xfe\x01\x02\x03\x7f\x80" * 300
            files = {"file": ("corrupt.bin", io.BytesIO(garbage), "application/octet-stream")}
            r = await client.post("/api/v1/voice-query", files=files)
            assert r.status_code == 200
            data = r.json()
            assert data.get("silence") is True or data.get("error_handled") is True

    @pytest.mark.anyio
    async def test_ingest_malformed_csv_returns_400(self):
        """Uploading CSV missing required columns or empty returns clean HTTP 400."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. Missing required 'item' and 'room'
            bad_csv = "color,size,price\nblue,large,100\n"
            files1 = {"file": ("bad.csv", io.BytesIO(bad_csv.encode("utf-8")), "text/csv")}
            r1 = await client.post("/api/ingest", data={"tenant_id": "general_memorial_cvor"}, files=files1)
            assert r1.status_code == 400
            assert "missing required columns" in r1.json()["detail"].lower()

            # 2. Empty CSV
            files2 = {"file": ("empty.csv", io.BytesIO(b""), "text/csv")}
            r2 = await client.post("/api/ingest", data={"tenant_id": "general_memorial_cvor"}, files=files2)
            assert r2.status_code == 400

    @pytest.mark.anyio
    async def test_ingest_valid_csv_with_utf8_bom(self):
        """Uploading valid CSV with UTF-8 BOM succeeds and loads rows cleanly."""
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # Preserve current inventory to restore after test
            inv = get_inventory_service("general_memorial_cvor")
            backup_rows = list(inv._rows)

            try:
                bom_csv = (
                    "\ufeffitem,category,room,cabinet,shelf,container,aliases,surgeon_notes\n"
                    "Micro Vascular Clamp,Instruments,OR 21,K,1,A,bulldog clamp,Dr. Patel\n"
                )
                files = {"file": ("inventory.csv", io.BytesIO(bom_csv.encode("utf-8")), "text/csv")}
                r = await client.post("/api/ingest", data={"tenant_id": "general_memorial_cvor"}, files=files)
                assert r.status_code == 200
                assert r.json()["rows_loaded"] == 1
            finally:
                # Restore original inventory
                inv._rows = backup_rows
                inv._save_csv()
