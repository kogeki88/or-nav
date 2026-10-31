import asyncio
import socket
import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock

import httpx
import pytest
from fastapi.testclient import TestClient
from fastapi import Request

from app.config import HOSPITALS_DIR
from app.limiter import limiter
from app.main import app as fastapi_app
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

    tenant_dir2 = tmp_path / "other_hospital" / "er"
    tenant_dir2.mkdir(parents=True)

    monkeypatch.setattr("app.config.HOSPITALS_DIR", tmp_path)

    # Needs manifest and inventory mapping
    manifest_file = tmp_path / "manifest.json"
    manifest_file.write_text("{}")

    (tmp_path / "other_hospital" / "manifest.json").write_text("{}")

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
        client = TestClient(fastapi_app)

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

    def test_concurrent_burst_race_condition(self, mock_tenant_dir):
        """
        Test that bursting the exact limit concurrently does not result in unexpected
        allowances due to race conditions (i.e. more than 60 succeeding).
        """
        client = TestClient(fastapi_app)
        limiter.reset()

        def make_request(idx):
            payload = {
                "message": f"Where is the prolene suture? {idx}",
                "tenant_id": "sacred_heart::or",
            }
            import random
            time.sleep(random.random() * 0.05)

            return client.post("/api/chat", json=payload)

        with ThreadPoolExecutor(max_workers=100) as executor:
            responses = list(executor.map(make_request, range(100)))

        status_200_count = sum(1 for resp in responses if resp.status_code == 200)
        status_429_count = sum(1 for resp in responses if resp.status_code == 429)

        assert status_200_count == 60, f"Expected 60 successful requests, got {status_200_count}"
        assert status_429_count == 40, f"Expected 40 rate-limited requests, got {status_429_count}"

    def test_multi_tenant_isolation(self, mock_tenant_dir, monkeypatch):
        """
        Test multi-tenant isolation on the actual application endpoint.
        Ensure that different tenants (by IP or payload) have independent rate limit buckets.
        """
        import slowapi.extension

        original_evaluate = slowapi.extension.Limiter._check_request_limit

        def bypass_check_request_limit(self, request, endpoint_func, sign_off):
            # Temporarily remove testclient from state during evaluation so get_ipaddr uses the real fallback
            has_testclient = hasattr(request.state, "testclient")
            if has_testclient:
                del request.state.testclient

            # slowapi.util.get_remote_address uses request.client.host which in TestClient is "testclient"
            # So we set it to something else temporarily
            old_client = request.scope.get("client")

            ip = request.headers.get("X-Forwarded-For", "127.0.0.1")
            request.scope["client"] = (ip, 80)

            try:
                return original_evaluate(self, request, endpoint_func, sign_off)
            finally:
                if has_testclient:
                    request.state.testclient = True
                request.scope["client"] = old_client

        monkeypatch.setattr(slowapi.extension.Limiter, "_check_request_limit", bypass_check_request_limit)

        client = TestClient(fastapi_app)
        limiter.reset()

        def make_request(idx):
            tenant = "sacred_heart::or" if idx % 2 == 0 else "other_hospital::er"
            ip = "1.1.1.1" if idx % 2 == 0 else "2.2.2.2"

            payload = {
                "message": f"Where is the prolene suture? {idx}",
                "tenant_id": tenant,
            }
            import random
            time.sleep(random.random() * 0.05)

            return client.post("/api/chat", json=payload, headers={"X-Forwarded-For": ip})

        with ThreadPoolExecutor(max_workers=50) as executor:
            responses = list(executor.map(make_request, range(100)))

        status_200_count = sum(1 for resp in responses if resp.status_code == 200)
        status_429_count = sum(1 for resp in responses if resp.status_code == 429)

        assert status_200_count == 100, f"Expected 100 successful requests (50 per tenant), got {status_200_count}"
        assert status_429_count == 0, f"Expected 0 rate-limited requests, got {status_429_count}"

    def test_latency_under_load(self, mock_tenant_dir):
        """
        Test that latency under rate limiting load remains low.
        Specifically, checking that responses (even 429s) are handled quickly,
        averaging under 500ms per request when using sync TestClient under GIL.
        """
        client = TestClient(fastapi_app)
        limiter.reset()

        def make_request(idx):
            start = time.time()
            payload = {
                "message": f"Where is the prolene suture? {idx}",
                "tenant_id": "sacred_heart::or",
            }
            client.post("/api/chat", json=payload)
            end = time.time()
            return end - start

        with ThreadPoolExecutor(max_workers=20) as executor:
            latencies = list(executor.map(make_request, range(100)))

        avg_latency = sum(latencies) / len(latencies)

        assert avg_latency < 0.500, f"Expected average latency < 500ms, got {avg_latency*1000:.2f}ms"
