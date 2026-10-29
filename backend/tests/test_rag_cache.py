import pytest
import os
from pathlib import Path
from app.config import TenantConfig
from app.services.rag_fallback import RAGService, _MAX_CACHE_SIZE

@pytest.mark.asyncio
async def test_rag_cache_eviction(monkeypatch):
    # Make sure we don't accidentally hit the real Gemini API during this test
    # by ensuring GEMINI_API_KEY is clear for this test context.
    monkeypatch.setenv("GEMINI_API_KEY", "")

    dummy_tenant = TenantConfig(
        tenant_id="test_tenant",
        display_name="Test Tenant",
        inventory_path=Path("/tmp/dummy_inventory.csv"),
        orientation_path=Path("/tmp/dummy_orientation.md"),
    )

    service = RAGService(dummy_tenant)
    service._api_key = "" # explicitly make sure API key is empty

    assert _MAX_CACHE_SIZE == 1024

    # Run queries to fill the cache to max capacity
    for i in range(_MAX_CACHE_SIZE):
        query = f"test query {i}"
        await service.query_with_meta(query)

    with service._lock:
        assert len(service._cache) == _MAX_CACHE_SIZE

        # Check that the first query is currently at the beginning of the OrderedDict
        # (It was accessed first, so it's the oldest and should be first to evict)
        first_cache_key = service._cache_key("test query 0")
        assert first_cache_key in service._cache

    # Run one more query to trigger eviction
    await service.query_with_meta(f"test query {_MAX_CACHE_SIZE}")

    with service._lock:
        assert len(service._cache) == _MAX_CACHE_SIZE

        # The oldest entry ("test query 0") should now be evicted
        assert first_cache_key not in service._cache

        # The newest entry should be in the cache
        newest_cache_key = service._cache_key(f"test query {_MAX_CACHE_SIZE}")
        assert newest_cache_key in service._cache
