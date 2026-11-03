import pytest
from fastapi.testclient import TestClient
from app.main import app as main_app
import app.auth
import json

client = TestClient(main_app)

@pytest.fixture(autouse=True)
def clean_auth_state(tmp_path, monkeypatch):
    """Ensure clean user state before and after each test, and enforce multi-tenant isolation by mocking USERS_FILE."""
    mock_users_file = tmp_path / "hospitals" / "users.json"
    mock_users_file.parent.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(app.auth, "USERS_FILE", mock_users_file)

    # Write a default dummy user to satisfy application fallback assumptions
    app.auth.save_users(app.auth.DEFAULT_DEMO_USERS)

    # Enforce offline-first constraint
    def mock_request(*args, **kwargs):
        raise RuntimeError("Network requests are disabled in this test suite.")

    monkeypatch.setattr("httpx.get", mock_request, raising=False)
    monkeypatch.setattr("httpx.post", mock_request, raising=False)
    monkeypatch.setattr("httpx.request", mock_request, raising=False)

def test_hash_password():
    assert len(app.auth.hash_password("test")) == 64  # SHA-256 length
    assert app.auth.hash_password("test") != app.auth.hash_password("test2")
    assert type(app.auth.hash_password("test")) is str

def test_load_and_save_users():
    users = app.auth.load_users()
    assert len(users) > 0
    new_user = dict(users[0])
    new_user["email"] = "new@test.com"
    users.append(new_user)
    app.auth.save_users(users)

    reloaded_users = app.auth.load_users()
    assert len(reloaded_users) == len(users)

def test_sanitize_user():
    user = {"email": "test", "passwordHash": "hash", "password_hash": "hash2", "name": "Test"}
    sanitized = app.auth.sanitize_user(user)
    assert "passwordHash" not in sanitized
    assert "password_hash" not in sanitized
    assert sanitized["name"] == "Test"

def test_register():
    response = client.post("/api/auth/register", json={"email": "newuser@hospital.org", "password": "password123"})
    assert response.status_code == 200
    data = response.json()
    assert "token" in data
    assert data["user"]["email"] == "newuser@hospital.org"

def test_register_existing():
    client.post("/api/auth/register", json={"email": "newuser2@hospital.org", "password": "password123"})
    response = client.post("/api/auth/register", json={"email": "newuser2@hospital.org", "password": "password123"})
    assert response.status_code == 400

def test_login():
    client.post("/api/auth/register", json={"email": "loginuser@hospital.org", "password": "password123"})
    response = client.post("/api/auth/login", json={"email": "loginuser@hospital.org", "password": "password123"})
    assert response.status_code == 200
    data = response.json()
    assert "token" in data
    assert data["user"]["email"] == "loginuser@hospital.org"

def test_reset_password():
    client.post("/api/auth/register", json={"email": "resetuser@hospital.org", "password": "password123"})
    response = client.post("/api/auth/reset-password", json={"email": "resetuser@hospital.org", "newPassword": "newpassword123"})
    assert response.status_code == 200

    response = client.post("/api/auth/login", json={"email": "resetuser@hospital.org", "password": "newpassword123"})
    assert response.status_code == 200

def test_update_profile():
    reg = client.post("/api/auth/register", json={"email": "profileuser@hospital.org", "password": "password123"})
    user_id = reg.json()["user"]["userId"]

    response = client.put("/api/auth/profile", json={
        "userId": user_id,
        "fullName": "Profile User",
        "facilityId": "test_fac",
        "departmentId": "test_dept",
        "clinicalRole": "Test Role"
    })
    assert response.status_code == 200
    data = response.json()
    assert data["onboardingCompleted"] is True
    assert data["profile"]["fullName"] == "Profile User"
