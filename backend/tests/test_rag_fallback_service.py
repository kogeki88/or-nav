import pytest
from pathlib import Path
from app.config import TenantConfig
from app.services.rag_fallback import RAGService

@pytest.fixture
def dummy_tenant(tmp_path):
    inventory = tmp_path / "inventory.csv"
    orientation = tmp_path / "orientation.md"
    inventory.write_text("item_id,aliases,department,location,surgeon_notes\n1,scalpel,OR,A,Dr. Smith uses this\n", encoding="utf-8")
    orientation.write_text("## Local Rules\nAlways wear a mask.", encoding="utf-8")

    # We also need a dummy baseline.md, but that's hardcoded to HOSPITALS_DIR / "GLOBAL_BASELINE" / "baseline.md"
    # We can patch it in the test.
    return TenantConfig(
        tenant_id="dummy",
        display_name="Dummy",
        inventory_path=inventory,
        orientation_path=orientation
    )

@pytest.mark.asyncio
async def test_empty_fallback_handling(dummy_tenant, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    service = RAGService(dummy_tenant)
    service._api_key = ""
    # Make baseline empty
    service._baseline_text = ""

    # Query with no overlap to anything
    response, is_baseline = service._offline_fallback("xyzqwer nothing match", None)
    assert "[OFFLINE MODE] I couldn't find relevant information in the knowledge base" in response
    assert is_baseline is False

@pytest.mark.asyncio
async def test_no_knowledge_base_loaded(dummy_tenant, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    service = RAGService(dummy_tenant)
    service._api_key = ""
    service._orientation_text = ""
    service._inventory_text = ""
    service._baseline_text = ""
    # Override get hospital pack to return empty
    monkeypatch.setattr(service, "_get_hospital_pack_resources", lambda x: {})

    response, is_baseline = service._offline_fallback("mask", None)
    assert "[OFFLINE MODE] No knowledge base loaded." in response
    assert is_baseline is False

@pytest.mark.asyncio
async def test_query_caching(dummy_tenant, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    service = RAGService(dummy_tenant)
    service._api_key = ""

    # Run a query
    resp1, is_b1 = await service.query_with_meta("mask", facility_name="dummy", clinical_role=None)

    # It should be in cache now
    key = service._cache_key("mask", facility_name="dummy", clinical_role=None)
    assert key in service._cache

    # Override the _offline_fallback to prove it hits cache
    called = False
    def fake_fallback(*args, **kwargs):
        nonlocal called
        called = True
        return "Not Cached", False
    monkeypatch.setattr(service, "_offline_fallback", fake_fallback)

    resp2, is_b2 = await service.query_with_meta("mask", facility_name="dummy", clinical_role=None)
    assert resp2 == resp1
    assert not called

@pytest.mark.asyncio
async def test_relevance_scoring(dummy_tenant, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    service = RAGService(dummy_tenant)
    service._api_key = ""

    service._orientation_text = "## Local Rules\nAlways wear a mask when handling the scalpel."
    service._baseline_text = "## Baseline Standards\nThe skin prep is important. AORN standards say so."

    # Overlap with local
    resp, is_b = service._offline_fallback("mask", None)
    assert "Based on the facility orientation guide" in resp
    assert "Always wear a mask" in resp
    assert is_b is False

    # Overlap with baseline and +3 boost
    # "skin prep" is a _BASELINE_TOPIC_PATTERNS
    resp, is_b = service._offline_fallback("skin prep important", None)
    assert "Based on the AORN / CNOR Perioperative Educational Baseline" in resp
    assert "skin prep is important" in resp
    assert is_b is True
