from hypothesis import given, strategies as st
import pytest
from fastapi.testclient import TestClient
import uuid
import httpx
import socket
import time
import concurrent.futures
import app.auth
from app.main import app as main_app
from app.auth import load_users, save_users, DEFAULT_DEMO_USERS

client = TestClient(main_app)

@pytest.fixture(autouse=True)
def clean_auth_state(tmp_path, monkeypatch):
    """Ensure clean user state before and after each test, and enforce multi-tenant isolation by mocking USERS_FILE."""
    mock_users_file = tmp_path / "hospitals" / "users.json"
    mock_users_file.parent.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(app.auth, "USERS_FILE", mock_users_file)

    # Enforce offline-first constraint
    def mock_request(*args, **kwargs):
        raise RuntimeError("Network requests are disabled in this test suite.")

    monkeypatch.setattr("httpx.get", mock_request, raising=False)
    monkeypatch.setattr("httpx.post", mock_request, raising=False)
    monkeypatch.setattr("httpx.request", mock_request, raising=False)

    orig_socket = socket.socket
    def mock_socket(*args, **kwargs):
        family = args[0] if len(args) > 0 else kwargs.get("family", -1)
        if family == getattr(socket, 'AF_UNIX', -1):
            return orig_socket(*args, **kwargs)
        raise RuntimeError("Network requests are disabled in this test suite.")
    monkeypatch.setattr(socket, "socket", mock_socket)

    # Save the initial demo user state to the tmp_path
    save_users(DEFAULT_DEMO_USERS)

    yield

class TestAuthTokenRotation:
    """Test Suite for AuthTokenRotation. Tests that tokens are unique."""

    def test_auth_token_rotation_login(self):
        """Verify multiple logins generate unique tokens."""
        # First login
        res1 = client.post(
            "/api/auth/login",
            json={"email": "sean@sacredheart.org", "password": "password123"},
        )
        assert res1.status_code == 200
        token1 = res1.json()["token"]

        # Second login
        res2 = client.post(
            "/api/auth/login",
            json={"email": "sean@sacredheart.org", "password": "password123"},
        )
        assert res2.status_code == 200
        token2 = res2.json()["token"]

        # Tokens should be different
        assert token1 != token2
        assert token1.startswith("token-")
        assert token2.startswith("token-")


    def test_auth_token_rotation_register(self):
        """Verify registrations generate unique tokens."""
        res1 = client.post(
            "/api/auth/register",
            json={
                "email": f"test1-{uuid.uuid4().hex}@test.com",
                "password": "password123",
                "fullName": "Test One",
            },
        )
        assert res1.status_code == 200
        token1 = res1.json()["token"]

        res2 = client.post(
            "/api/auth/register",
            json={
                "email": f"test2-{uuid.uuid4().hex}@test.com",
                "password": "password123",
                "fullName": "Test Two",
            },
        )
        assert res2.status_code == 200
        token2 = res2.json()["token"]

        assert token1 != token2
        assert token1.startswith("token-")
        assert token2.startswith("token-")

    def test_auth_token_rotation_concurrent_burst(self):
        """Verify race condition resistance and measure latency for concurrent requests."""
        num_requests = 10
        start_time = time.time()

        def make_login_request(i):
            return client.post(
                "/api/auth/login",
                json={"email": "sean@sacredheart.org", "password": "password123"}
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=num_requests) as executor:
            futures = [executor.submit(make_login_request, i) for i in range(num_requests)]
            results = [future.result() for future in concurrent.futures.as_completed(futures)]

        latency = time.time() - start_time

        assert latency < 2.0, f"Latency was {latency}s, expected < 2.0s"

        tokens = []
        for res in results:
            assert res.status_code == 200
            token = res.json()["token"]
            assert token.startswith("token-")
            tokens.append(token)

        assert len(set(tokens)) == num_requests, "Tokens generated concurrently are not unique."



    def test_auth_token_rotation_malformed_payloads(self):
        """Verify token rotation resilience against missing, null, and extremely long string inputs for login."""
        # Missing fields in login
        res1 = client.post("/api/auth/login", json={"email": "sean@sacredheart.org"})
        assert res1.status_code == 422

        # Null fields in login
        res2 = client.post("/api/auth/login", json={"email": None, "password": None})
        assert res2.status_code == 422

        # Extremely long password in login
        long_pass = "p" * 1000
        res4 = client.post("/api/auth/login", json={"email": "sean@sacredheart.org", "password": long_pass})
        assert res4.status_code in [401, 422]

    def test_auth_token_rotation_multi_tenant_isolation(self, tmp_path, monkeypatch):
        """Ensure the mocked USERS_FILE does not leak state between test executions for token generation."""
        # Create a new user in this test
        client.post("/api/auth/register", json={"email": "isolated@test.com", "password": "password123", "fullName": "Isolated"})

        # Verify they can log in
        res1 = client.post("/api/auth/login", json={"email": "isolated@test.com", "password": "password123"})
        assert res1.status_code == 200

        # Now, explicitly trigger a re-initialization of the clean state (simulating a new test)
        mock_users_file = tmp_path / "hospitals_2" / "users.json"
        mock_users_file.parent.mkdir(parents=True, exist_ok=True)
        monkeypatch.setattr("app.auth.USERS_FILE", mock_users_file)
        save_users(DEFAULT_DEMO_USERS)

        # The isolated user should NO LONGER be able to log in, proving state isolation
        res2 = client.post("/api/auth/login", json={"email": "isolated@test.com", "password": "password123"})
        assert res2.status_code == 401

    @given(
        st.emails(),
        st.text(min_size=4, max_size=100),
        st.text(max_size=50)
    )
    def test_fuzz_register_auth_token_rotation(self, email, password, full_name):
        """Fuzzing registrations to ensure tokens are unique and payloads handled."""
        res1 = client.post(
            "/api/auth/register",
            json={
                "email": email,
                "password": password,
                "fullName": full_name,
            },
        )
        if res1.status_code == 200:
            token1 = res1.json()["token"]
            assert token1.startswith("token-")

            # Second login should generate a new token
            res2 = client.post(
                "/api/auth/login",
                json={"email": email, "password": password},
            )
            assert res2.status_code == 200
            token2 = res2.json()["token"]
            assert token1 != token2
        else:
            # 400 = invalid email or weak password, 422 = unprocessable entity (pydantic validation), 409/400 = duplicate email
            assert res1.status_code in [400, 422, 409]

    def test_offline_first_invariant_enforced(self, clean_auth_state):
        """Verify that normal auth endpoints do not make any external network requests."""
        # Valid login (should not need network, and if it does it will hit the RuntimeError in clean_auth_state)
        res1 = client.post("/api/auth/login", json={"email": "sean@sacredheart.org", "password": "password123"})
        assert res1.status_code == 200

        # Valid registration (should not need network)
        res2 = client.post(
            "/api/auth/register",
            json={
                "email": f"offline-{uuid.uuid4().hex}@test.com",
                "password": "password123",
                "fullName": "Offline Test",
            },
        )
        assert res2.status_code == 200



    def test_auth_profile_offline_mutation_replay_idempotency(self, clean_auth_state):
        """Verify that replaying the same profile mutation multiple times offline is idempotent."""
        reg_res = client.post(
            "/api/auth/register",
            json={"email": "replay@test.com", "password": "password123", "fullName": "Replay User"}
        )
        assert reg_res.status_code == 200

        payload = {
            "email": "replay@test.com",
            "facilityId": "sacred_heart",
            "departmentId": "or_main",
            "clinicalRole": "Surgeon"
        }

        res1 = client.put("/api/auth/profile", json=payload)
        assert res1.status_code == 200
        data1 = res1.json()
        data1.pop("latency_ms", None)
        data1.pop("last_verified_at", None)

        res2 = client.put("/api/auth/profile", json=payload)
        assert res2.status_code == 200
        data2 = res2.json()
        data2.pop("latency_ms", None)
        data2.pop("last_verified_at", None)

        assert data1 == data2
        assert data2["profile"]["facilityId"] == "sacred_heart"
        assert data2["profile"]["departmentId"] == "or_main"
        assert data2["profile"]["clinicalRole"] == "Surgeon"

    def test_auth_token_rotation_reset_password(self, clean_auth_state):
        """Verify that logging in after a password reset generates a unique token."""
        res_reg = client.post(
            "/api/auth/register",
            json={"email": "rotate@test.com", "password": "old_password", "fullName": "Rotate Password User"}
        )
        assert res_reg.status_code == 200
        token_initial = res_reg.json()["token"]

        # Reset password
        res_reset = client.post(
            "/api/auth/reset-password",
            json={"email": "rotate@test.com", "newPassword": "new_password"}
        )
        assert res_reset.status_code == 200

        # Login with new password
        res_login = client.post(
            "/api/auth/login",
            json={"email": "rotate@test.com", "password": "new_password"}
        )
        assert res_login.status_code == 200
        token_after_reset = res_login.json()["token"]

        assert token_after_reset.startswith("token-")
        assert token_after_reset != token_initial

    def test_auth_reset_password_offline_mutation_replay_idempotency(self, clean_auth_state):
        """Verify that resetting a password multiple times sequentially offline is idempotent."""
        reg_res = client.post(
            "/api/auth/register",
            json={"email": "reset@test.com", "password": "old_password", "fullName": "Reset User"}
        )
        assert reg_res.status_code == 200

        payload = {
            "email": "reset@test.com",
            "newPassword": "new_password123"
        }

        res1 = client.post("/api/auth/reset-password", json=payload)
        assert res1.status_code == 200
        data1 = res1.json()
        data1.pop("latency_ms", None)
        data1.pop("last_verified_at", None)

        res2 = client.post("/api/auth/reset-password", json=payload)
        assert res2.status_code == 200
        data2 = res2.json()
        data2.pop("latency_ms", None)
        data2.pop("last_verified_at", None)

        assert data1 == data2
        assert data2["success"] is True

    def test_auth_multi_tenant_boundary_enforcement(self, clean_auth_state):
        """Ensure users are correctly isolated by their facility_id::dept_id boundaries."""
        res_a = client.post(
            "/api/auth/register",
            json={"email": "userA@tenantA.com", "password": "password123", "fullName": "User A"}
        )
        assert res_a.status_code == 200

        client.put("/api/auth/profile", json={
            "email": "userA@tenantA.com",
            "facilityId": "tenantA_fac",
            "departmentId": "dept_alpha"
        })

        res_b = client.post(
            "/api/auth/register",
            json={"email": "userB@tenantB.com", "password": "password123", "fullName": "User B"}
        )
        assert res_b.status_code == 200

        client.put("/api/auth/profile", json={
            "email": "userB@tenantB.com",
            "facilityId": "tenantB_fac",
            "departmentId": "dept_beta"
        })

        login_a = client.post("/api/auth/login", json={"email": "userA@tenantA.com", "password": "password123"})
        profile_a = login_a.json()["profile"]
        assert profile_a["facilityId"] == "tenantA_fac"
        assert profile_a["departmentId"] == "dept_alpha"

        login_b = client.post("/api/auth/login", json={"email": "userB@tenantB.com", "password": "password123"})
        profile_b = login_b.json()["profile"]
        assert profile_b["facilityId"] == "tenantB_fac"
        assert profile_b["departmentId"] == "dept_beta"
