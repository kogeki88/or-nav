import asyncio
import socket
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import HOSPITALS_DIR
from app.limiter import limiter
from app.main import app
from app.services.inventory_search import reset_inventory_services


@pytest.fixture(autouse=True)
def enable_limiter():
    original_enabled = limiter.enabled
    limiter.enabled = True
    limiter.reset()
    yield
    limiter.enabled = original_enabled
    limiter.reset()


@pytest.fixture(autouse=True)
def strict_offline_first(monkeypatch):
    """Ensure no external network calls are made during the tests, but allow TestClient to function."""
    original_socket = socket.socket
    def _raise_offline_error(family=-1, type=-1, proto=-1, fileno=None):
        if family == socket.AF_UNIX: # allow UNIX sockets used by ASGI/test client
            return original_socket(family, type, proto, fileno)
        raise RuntimeError(f"Offline-first violation: Network request attempted (family={family})")

    monkeypatch.setattr(socket, "socket", _raise_offline_error)
    monkeypatch.setenv("GEMINI_API_KEY", "")


@pytest.fixture
def mock_tenant_dir(tmp_path, monkeypatch):
    """Enforce multi-tenant isolation by overriding HOSPITALS_DIR."""
    tenant_dir = tmp_path / "sacred_heart" / "or"
    tenant_dir.mkdir(parents=True)
    monkeypatch.setattr("app.config.HOSPITALS_DIR", tmp_path)

    # Needs manifest and inventory mapping
    manifest_file = tmp_path / "manifest.json"
    manifest_file.write_text("{}")

    # Mock inventory cache to prevent cross-tenant state leaks
    reset_inventory_services()

    yield tenant_dir


class TestLimiterConcurrencyThrottling:
    def test_concurrent_rate_limiting_chat(self, mock_tenant_dir):
        """
        Verify that making 100 concurrent requests to /api/chat enforces the
        60/minute rate limit strictly. Exactly 60 should succeed, and exactly
        40 should fail with HTTP 429 Too Many Requests.
        """
        client = TestClient(app)

        def make_request(idx):
            payload = {
                "message": f"Where is the prolene suture? {idx}",
                "tenant_id": "sacred_heart::or",
            }
            return client.post("/api/chat", json=payload)

        with ThreadPoolExecutor(max_workers=20) as executor:
            responses = list(executor.map(make_request, range(100)))

        assert len(responses) == 100

        status_200_count = sum(1 for resp in responses if resp.status_code == 200)
        status_429_count = sum(1 for resp in responses if resp.status_code == 429)

        assert status_200_count == 60, f"Expected 60 successful requests, got {status_200_count}"
        assert status_429_count == 40, f"Expected 40 rate-limited requests, got {status_429_count}"

        # Verify retry-after header is present in the 429 responses
        for resp in responses:
            if resp.status_code == 429:
                assert "retry-after" in (k.lower() for k in resp.headers.keys())
