import asyncio
import socket
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock

import httpx
from hypothesis import given, settings, HealthCheck
import hypothesis.strategies as st

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
    def test_chat_malformed_payload_resilience(self, mock_tenant_dir):
        """
        Verify that malformed inputs to /api/chat do not cause unhandled exceptions
        and return the correct HTTP status codes (e.g., 422 for validation errors).
        """
        client = TestClient(app)

        # Missing required field 'message'
        res = client.post("/api/chat", json={"tenant_id": "sacred_heart::or"})
        assert res.status_code == 422

        # Empty payload
        res = client.post("/api/chat", json={})
        assert res.status_code == 422

        # Invalid type for message
        res = client.post("/api/chat", json={"message": 123, "tenant_id": "sacred_heart::or"})
        assert res.status_code == 422

        # Huge message (boundary testing for resilience)
        huge_message = "a" * 100000
        res = client.post("/api/chat", json={"message": huge_message, "tenant_id": "sacred_heart::or"})
        assert res.status_code in (200, 422, 413)











    def test_multi_tenant_isolation_rate_limits(self, mock_tenant_dir, tmp_path, monkeypatch):
        """
        Ensure rate limits are isolated properly and do not cross-pollute tenants.
        We simulate exhausting the rate limit for one IP/tenant and verify the other is unaffected.
        """
        from app.main import app as main_app
        client = TestClient(main_app)

        # Setup a second mock tenant properly inside HOSPITALS_DIR
        import app.config
        hospitals_dir = app.config.HOSPITALS_DIR
        tenant2_dir = hospitals_dir / "general_memorial" / "or"
        tenant2_dir.mkdir(parents=True, exist_ok=True)
        manifest_file = tenant2_dir / "manifest.json"
        manifest_file.write_text("{}")

        # Enforce offline-first invariant (no network access during test)
        import socket
        original_socket = socket.socket
        def _raise_offline_error(family=-1, type=-1, proto=-1, fileno=None):
            if family == socket.AF_UNIX: # allow UNIX sockets used by ASGI/test client
                return original_socket(family, type, proto, fileno)
            raise RuntimeError(f"Offline-first violation: Network request attempted (family={family})")
        monkeypatch.setattr(socket, "socket", _raise_offline_error)

        def custom_get_ipaddr(request):
            return request.headers.get("x-forwarded-for", "127.0.0.1")

        import app.limiter
        monkeypatch.setattr(app.limiter, "get_ipaddr", custom_get_ipaddr)
        monkeypatch.setattr(main_app.state.limiter, "_key_func", custom_get_ipaddr)

        # 3. Apply custom_get_ipaddr to all existing routes inside _route_limits
        for route in main_app.state.limiter._route_limits.values():
            for limit in route:
                limit.key_func = custom_get_ipaddr

        def make_requests(ip_addr, tenant_id, count):
            responses = []
            for i in range(count):
                payload = {
                    "message": f"test {i}",
                    "tenant_id": tenant_id,
                }
                responses.append(client.post("/api/chat", json=payload, headers={"x-forwarded-for": ip_addr}))
            return responses

        # Exhaust rate limit for IP 1 / Tenant A
        ip1_res = make_requests("192.168.1.100", "sacred_heart::or", 61)
        assert sum(1 for r in ip1_res if r.status_code == 200) == 60
        assert ip1_res[-1].status_code == 429

        # Verify IP 2 / Tenant B is unaffected despite IP 1 being limited
        ip2_res = make_requests("192.168.1.101", "general_memorial::or", 5)
        assert sum(1 for r in ip2_res if r.status_code == 200) == 5

    @settings(max_examples=50, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
    @given(
        message=st.one_of(st.none(), st.text(), st.integers()),
        tenant_id=st.one_of(st.none(), st.text(), st.integers())
    )
    def test_boundary_inputs(self, mock_tenant_dir, message, tenant_id):
        """
        Fuzz the /api/chat endpoint with different types and boundaries
        to ensure it does not crash (HTTP 500).
        """
        client = TestClient(app)
        payload = {}
        if message is not None:
            payload["message"] = message
        if tenant_id is not None:
            payload["tenant_id"] = tenant_id

        res = client.post("/api/chat", json=payload)
        assert res.status_code != 500
