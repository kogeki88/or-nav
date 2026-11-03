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

def test_register_fuzzing_and_boundaries():
    # Invalid emails
    for i, invalid_email in enumerate(["not-an-email", "missing-at.com", "@missing-local.com", "space in@email.com", ""]):
        res = client.post("/api/auth/register", json={"email": invalid_email, "password": "password123"})
        if res.status_code != 400:
            print(f"FAILED EMAIL: '{invalid_email}' got {res.status_code}")
        assert res.status_code == 400

    # Invalid passwords (boundary - less than 4 chars)
    for i, invalid_pw in enumerate(["", "12", "123", "   "]):
        res = client.post("/api/auth/register", json={"email": f"valid_pw_{i}@email.com", "password": invalid_pw})
        if res.status_code != 400:
            print(f"FAILED PW: '{invalid_pw}' got {res.status_code}")
        assert res.status_code == 400

    # Malformed payload (missing fields)
    res = client.post("/api/auth/register", json={"email": "valid2@email.com"})
    assert res.status_code == 422

    res = client.post("/api/auth/register", json={"password": "password123"})
    assert res.status_code == 422

    # Malformed JSON
    res = client.post("/api/auth/register", content="Not a json")
    assert res.status_code == 422

def test_login_fuzzing():
    # Invalid email login attempt
    for invalid_email in ["not-an-email", "", "   "]:
        res = client.post("/api/auth/login", json={"email": invalid_email, "password": "password123"})
        assert res.status_code == 401

    # Missing fields
    res = client.post("/api/auth/login", json={"email": "valid@email.com"})
    assert res.status_code == 422

def test_reset_password_fuzzing():
    for invalid_email in ["not-an-email", "", "   "]:
        res = client.post("/api/auth/reset-password", json={"email": invalid_email, "newPassword": "password123"})
        assert res.status_code == 404

    # Missing new password
    res = client.post("/api/auth/reset-password", json={"email": "valid@email.com"})
    assert res.status_code == 400

def test_profile_schema_validation():
    # Invalid profile schema (nested dict expected but got string)
    res = client.put("/api/auth/profile", json={"userId": "123", "profile": "string instead of dict"})
    assert res.status_code == 422

def test_offline_first_invariant(monkeypatch):
    import httpx
    def mock_post(*args, **kwargs):
        raise httpx.NetworkError("Network is disconnected")
    monkeypatch.setattr(httpx, 'post', mock_post)

    # We should still be able to authenticate and register locally when offline
    res = client.post("/api/auth/register", json={"email": "offline@hospital.org", "password": "password123"})
    assert res.status_code == 200

    res = client.post("/api/auth/login", json={"email": "offline@hospital.org", "password": "password123"})
    assert res.status_code == 200

def test_multi_tenant_isolation_invariant(tmp_path, monkeypatch):
    import app.auth

    # Tenant A
    tenant_a_dir = tmp_path / "tenant_a"
    tenant_a_dir.mkdir()
    monkeypatch.setattr(app.auth, "USERS_FILE", tenant_a_dir / "users.json")
    client.post("/api/auth/register", json={"email": "user@tenant-a.com", "password": "password123"})

    # Tenant B
    tenant_b_dir = tmp_path / "tenant_b"
    tenant_b_dir.mkdir()
    monkeypatch.setattr(app.auth, "USERS_FILE", tenant_b_dir / "users.json")
    client.post("/api/auth/register", json={"email": "user@tenant-b.com", "password": "password123"})

    # Check Tenant B doesn't see Tenant A
    res = client.post("/api/auth/login", json={"email": "user@tenant-a.com", "password": "password123"})
    assert res.status_code == 401

    # Check Tenant B sees Tenant B
    res = client.post("/api/auth/login", json={"email": "user@tenant-b.com", "password": "password123"})
    assert res.status_code == 200

def test_offline_mutation_replay_idempotency():
    res1 = client.put("/api/auth/profile", json={
        "email": "idempotent@hospital.org",
        "facilityId": "sacred_heart",
        "departmentId": "sacred_heart::or",
        "clinicalRole": "RN"
    })
    assert res1.status_code == 200
    profile1 = res1.json()["profile"]

    res2 = client.put("/api/auth/profile", json={
        "email": "idempotent@hospital.org",
        "facilityId": "sacred_heart",
        "departmentId": "sacred_heart::or",
        "clinicalRole": "RN"
    })
    assert res2.status_code == 200
    profile2 = res2.json()["profile"]

    assert profile1 == profile2

def test_multi_tenant_boundary_enforcement():
    res = client.put("/api/auth/profile", json={
        "email": "tenant1@hospital.org",
        "facilityId": "fac1",
        "departmentId": "fac1::dept1"
    })
    assert res.status_code == 200
    assert res.json()["profile"]["facilityId"] == "fac1"
    assert res.json()["profile"]["departmentId"] == "fac1::dept1"

    res_b = client.put("/api/auth/profile", json={
        "email": "tenant2@hospital.org",
        "facilityId": "fac2",
        "departmentId": "fac2::dept2"
    })
    assert res_b.status_code == 200
    assert res_b.json()["profile"]["facilityId"] == "fac2"
    assert res_b.json()["profile"]["departmentId"] == "fac2::dept2"

def test_network_partition_and_recovery(monkeypatch, tmp_path):
    import time
    import uuid
    import app.auth
    from fastapi.testclient import TestClient
    from app.main import app as main_app

    # Use raise_server_exceptions=False to ensure we catch 500 errors gracefully
    client_local = TestClient(main_app, raise_server_exceptions=False)

    mock_users_file = tmp_path / "hospitals" / "users.json"
    mock_users_file.parent.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(app.auth, "USERS_FILE", mock_users_file)

    network_state = {"status": "online", "latency": 0.0}
    original_save = app.auth.save_users

    def mock_save_users(users):
        if network_state["latency"] > 0:
            time.sleep(network_state["latency"])
        if network_state["status"] == "offline":
            raise OSError("Network/Storage partition: disk offline")
        original_save(users)

    monkeypatch.setattr(app.auth, "save_users", mock_save_users)

    # 1. Fault injection & Partition: Offline mode (should 500)
    network_state["status"] = "offline"
    uid1 = uuid.uuid4().hex
    res = client_local.post("/api/auth/register", json={"email": f"fail_{uid1}@hospital.org", "password": "password"})
    assert res.status_code == 500

    # 2. Intermittent latency
    network_state["status"] = "online"
    network_state["latency"] = 0.1
    uid2 = uuid.uuid4().hex
    res = client_local.post("/api/auth/register", json={"email": f"latency_{uid2}@hospital.org", "password": "password"})
    assert res.status_code == 200

    # 3. Self-healing / Reconnection (toggle back to online)
    network_state["latency"] = 0.0
    uid3 = uuid.uuid4().hex
    res = client_local.post("/api/auth/register", json={"email": f"recover_{uid3}@hospital.org", "password": "password"})
    assert res.status_code == 200
