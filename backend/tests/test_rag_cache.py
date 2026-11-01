import pytest
import asyncio
from unittest.mock import patch

from app.config import get_tenant
from app.services.rag_fallback import RAGService, _MAX_CACHE_SIZE

@pytest.mark.asyncio
async def test_rag_cache_lru_eviction():
    tenant = get_tenant("or_main")
    service = RAGService(tenant)

    with patch.object(service, '_call_gemini') as mock_gemini:
        mock_gemini.return_value = ("mock response", False)
        # Mock active key to trigger _call_gemini instead of fallback
        service._api_key = "dummy"

        # Fill cache to capacity
        for i in range(_MAX_CACHE_SIZE):
            await service.query_with_meta(f"query {i}")

        assert len(service._cache) == _MAX_CACHE_SIZE

        # Access the first item to move it to the end of LRU
        await service.query_with_meta("query 0")

        # Add a new item that exceeds max capacity
        await service.query_with_meta(f"query {_MAX_CACHE_SIZE}")

        assert len(service._cache) == _MAX_CACHE_SIZE

        key_0 = service._cache_key("query 0")
        key_1 = service._cache_key("query 1")
        key_new = service._cache_key(f"query {_MAX_CACHE_SIZE}")

        # query 0 was accessed recently, so it should remain
        assert key_0 in service._cache
        # query 1 is now the oldest, so it should be evicted
        assert key_1 not in service._cache
        # the new query should be present
        assert key_new in service._cache

