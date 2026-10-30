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
