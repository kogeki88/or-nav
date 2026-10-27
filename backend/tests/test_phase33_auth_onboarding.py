"""
Phase 33 Test Suite: Authentication, Account Lifecycle & Profile Onboarding.

Verifies:
1. Pre-seeded demo account (sean@sacredheart.org / password123) with onboardingCompleted: True.
2. New account registration initializes with onboardingCompleted: False.
3. Duplicate email registration is prevented (case-insensitive).
4. Authentication with valid and invalid credentials.
5. Password reset flow updates credentials and enables login with new password.
6. Profile setup marks onboardingCompleted: True and persists across subsequent logins.

100% deterministic, $0.00 token cost, <1s execution.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.auth import load_users, save_users, DEFAULT_DEMO_USERS

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_auth_state():
    """Ensure clean user state before and after each test."""
    initial = load_users()
    yield
    save_users(initial)


def test_demo_account_login():
    """Verify pre-seeded demo user authenticates with onboardingCompleted: True and pre-configured profile."""
    res = client.post(
        "/api/auth/login",
        json={"email": "sean@sacredheart.org", "password": "password123"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["onboardingCompleted"] is True
    assert data["user"]["fullName"] == "Sean Iglesia, RN"
    assert data["profile"]["facilityId"] == "sacred_heart"
    assert data["profile"]["clinicalRole"] == "Circulating RN"
    assert "token" in data


def test_case_insensitive_email_login():
    """Verify email matching is case-insensitive."""
    res = client.post(
        "/api/auth/login",
        json={"email": "SEAN@SacredHeart.Org", "password": "password123"},
    )
    assert res.status_code == 200
    assert res.json()["user"]["email"] == "sean@sacredheart.org"


def test_invalid_credentials_rejected():
    """Verify login fails with 401 for incorrect password or non-existent email."""
    # Incorrect password
    res_bad_pw = client.post(
        "/api/auth/login",
        json={"email": "sean@sacredheart.org", "password": "wrongpassword"},
    )
    assert res_bad_pw.status_code == 401
    assert "Invalid email or password" in res_bad_pw.json()["detail"]

    # Non-existent user
    res_bad_user = client.post(
        "/api/auth/login",
        json={"email": "nobody@hospital.org", "password": "password123"},
    )
    assert res_bad_user.status_code == 401


def test_register_new_account_starts_with_onboarding_incomplete():
    """Verify new user registration starts with onboardingCompleted: False."""
    res = client.post(
        "/api/auth/register",
        json={
            "email": "elliot.reid@sacredheart.org",
            "password": "reidpassword",
            "fullName": "Dr. Elliot Reid, MD",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["onboardingCompleted"] is False
    assert data["user"]["fullName"] == "Dr. Elliot Reid, MD"
    assert data["user"]["email"] == "elliot.reid@sacredheart.org"
    assert "token" in data

    # Logging in as the new user also reflects onboardingCompleted: False
    login_res = client.post(
        "/api/auth/login",
        json={"email": "elliot.reid@sacredheart.org", "password": "reidpassword"},
    )
    assert login_res.status_code == 200
    assert login_res.json()["onboardingCompleted"] is False
    assert login_res.json()["profile"] is None


def test_duplicate_email_registration_rejected():
    """Verify duplicate email registration is rejected with 400."""
    res = client.post(
        "/api/auth/register",
        json={
            "email": "SEAN@sacredheart.org",
            "password": "newpassword",
            "fullName": "Sean Duplicate",
        },
    )
    assert res.status_code == 400
    assert "already exists" in res.json()["detail"].lower()


def test_reset_password_flow():
    """Verify forgot/reset password updates password hash and permits login with new password."""
    # 1. Reset password
    res_reset = client.post(
        "/api/auth/reset-password",
        json={"email": "sean@sacredheart.org", "new_password": "brandnewpassword99"},
    )
    assert res_reset.status_code == 200
    assert res_reset.json()["success"] is True

    # 2. Old password should now fail
    res_old = client.post(
        "/api/auth/login",
        json={"email": "sean@sacredheart.org", "password": "password123"},
    )
    assert res_old.status_code == 401

    # 3. New password should succeed
    res_new = client.post(
        "/api/auth/login",
        json={"email": "sean@sacredheart.org", "password": "brandnewpassword99"},
    )
    assert res_new.status_code == 200
    assert res_new.json()["user"]["email"] == "sean@sacredheart.org"


def test_profile_update_completes_onboarding():
    """Verify saving profile marks onboardingCompleted: True and persists across logins."""
    # 1. Register new user
    reg = client.post(
        "/api/auth/register",
        json={
            "email": "carla.espinosa@sacredheart.org",
            "password": "carlapassword",
            "fullName": "Carla Espinosa, RN",
        },
    )
    assert reg.status_code == 200
    user_id = reg.json()["user"]["userId"]
    assert reg.json()["onboardingCompleted"] is False

    # 2. Save profile assignment (onboarding step)
    prof_res = client.put(
        "/api/auth/profile",
        json={
            "userId": user_id,
            "facilityId": "county_general",
            "facilityName": "County General Hospital",
            "departmentId": "er_trauma",
            "clinicalRole": "ER RN",
        },
    )
    assert prof_res.status_code == 200
    assert prof_res.json()["onboardingCompleted"] is True
    assert prof_res.json()["profile"]["clinicalRole"] == "ER RN"

    # 3. Re-login as Carla: onboarding is now complete!
    re_login = client.post(
        "/api/auth/login",
        json={"email": "carla.espinosa@sacredheart.org", "password": "carlapassword"},
    )
    assert re_login.status_code == 200
    assert re_login.json()["onboardingCompleted"] is True
    assert re_login.json()["profile"]["facilityId"] == "county_general"
    assert re_login.json()["profile"]["departmentId"] == "er_trauma"
    assert re_login.json()["profile"]["clinicalRole"] == "ER RN"
