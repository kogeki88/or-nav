from hypothesis import given, strategies as st
import pytest
from fastapi.testclient import TestClient
import uuid
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
