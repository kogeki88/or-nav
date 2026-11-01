import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

def test_token_verification():
    """Verify that a protected endpoint accepts a valid authorization token."""
    login_res = client.post(
        "/api/auth/login",
        json={"email": "sean@sacredheart.org", "password": "password123"}
    )
    assert login_res.status_code == 200
    token = login_res.json()["token"]

    res = client.put(
        "/api/auth/profile",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "userId": "usr-demo-001",
            "facilityId": "county_general",
            "departmentId": "er_trauma",
            "clinicalRole": "ER RN",
        }
    )
    assert res.status_code == 200

def test_expired_token_rejection():
    """Verify that an expired token is rejected with an HTTP 401 response."""
    expired_token = "token-expired1234"
    res = client.put(
        "/api/auth/profile",
        headers={"Authorization": f"Bearer {expired_token}"},
        json={
            "userId": "usr-demo-001",
            "facilityId": "county_general",
            "departmentId": "er_trauma",
            "clinicalRole": "ER RN",
        }
    )
    assert res.status_code == 401

def test_logout_invalidates_token():
    """Verify that a logout attempt successfully invalidates the token."""
    login_res = client.post(
        "/api/auth/login",
        json={"email": "sean@sacredheart.org", "password": "password123"}
    )
    assert login_res.status_code == 200
    token = login_res.json()["token"]

    logout_res = client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert logout_res.status_code == 200

    res = client.put(
        "/api/auth/profile",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "userId": "usr-demo-001",
            "facilityId": "county_general",
            "departmentId": "er_trauma",
            "clinicalRole": "ER RN",
        }
    )
    assert res.status_code == 401
