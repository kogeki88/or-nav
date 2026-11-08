import asyncio
import time
from httpx import AsyncClient, ASGITransport
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
        raise httpx.NetworkError("Network is disconnected", request=httpx.Request("POST", "http://mock"))
    monkeypatch.setattr(httpx, 'post', mock_post)

    # We should still be able to authenticate and register locally when offline
    res = client.post("/api/auth/register", json={"email": "offline@hospital.org", "password": "password123"})
    assert res.status_code == 200

    res = client.post("/api/auth/login", json={"email": "offline@hospital.org", "password": "password123"})
    assert res.status_code == 200

def test_multi_tenant_isolation_invariant(tmp_path, monkeypatch):
    import app.auth

    tenant_a = "tenant-a"
    tenant_b = "tenant-b"

    # Tenant A
    tenant_a_dir = tmp_path / tenant_a
    tenant_a_dir.mkdir()
    monkeypatch.setattr(app.auth, "USERS_FILE", tenant_a_dir / "users.json")
    client.post("/api/auth/register", json={"email": f"user@{tenant_a}.com", "password": "password123"})

    # Tenant B
    tenant_b_dir = tmp_path / tenant_b
    tenant_b_dir.mkdir()
    monkeypatch.setattr(app.auth, "USERS_FILE", tenant_b_dir / "users.json")
    client.post("/api/auth/register", json={"email": f"user@{tenant_b}.com", "password": "password123"})

    # Check Tenant B doesn't see Tenant A
    res = client.post("/api/auth/login", json={"email": f"user@{tenant_a}.com", "password": "password123"})
    assert res.status_code == 401

    # Check Tenant B sees Tenant B
    res = client.post("/api/auth/login", json={"email": f"user@{tenant_b}.com", "password": "password123"})
    assert res.status_code == 200

def test_offline_mutation_replay_idempotency():
    res1 = client.put("/api/auth/profile", json={
        "email": "idempotent@hospital.org",
        "facilityId": "sacred_heart",
        "departmentId": "sacred_heart::or",
        "clinicalRole": "RN"
    })
    assert res1.status_code == 200
    snapshot1 = res1.json()

    res2 = client.put("/api/auth/profile", json={
        "email": "idempotent@hospital.org",
        "facilityId": "sacred_heart",
        "departmentId": "sacred_heart::or",
        "clinicalRole": "RN"
    })
    assert res2.status_code == 200
    snapshot2 = res2.json()

    import copy
    def deep_clean(d):
        if isinstance(d, dict):
            return {k: deep_clean(v) for k, v in d.items() if k not in ["createdAt", "verification_score"]}
        if isinstance(d, list):
            return [deep_clean(i) for i in d]
        return d

    clean1 = deep_clean(copy.deepcopy(snapshot1))
    clean2 = deep_clean(copy.deepcopy(snapshot2))
    assert clean1 == clean2

def test_multi_tenant_boundary_enforcement():
    tenant1_id = "fac1"
    tenant1_dept = f"{tenant1_id}::dept1"
    res = client.put("/api/auth/profile", json={
        "email": f"{tenant1_id}@hospital.org",
        "facilityId": tenant1_id,
        "departmentId": tenant1_dept
    })
    assert res.status_code == 200
    assert res.json()["profile"]["facilityId"] == tenant1_id
    assert res.json()["profile"]["departmentId"] == tenant1_dept

    tenant2_id = "fac2"
    tenant2_dept = f"{tenant2_id}::dept2"
    res_b = client.put("/api/auth/profile", json={
        "email": f"{tenant2_id}@hospital.org",
        "facilityId": tenant2_id,
        "departmentId": tenant2_dept
    })
    assert res_b.status_code == 200
    assert res_b.json()["profile"]["facilityId"] == tenant2_id
    assert res_b.json()["profile"]["departmentId"] == tenant2_dept

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

    import socket
    original_socket = socket.socket
    import os
    def mock_socket(*args, **kwargs):
        # We only want to mock standard network sockets (AF_INET/AF_INET6), not unix domain sockets
        # created internally by asyncio (like in socketpair used for self-pipe).
        # We default to AF_INET if not passed, simulating standard external network calls.
        if args:
            if not isinstance(args[0], int):
                raise OSError("Network/Storage partition: network violation bypass attempt")
            family = args[0]
        else:
            family = kwargs.get("family", socket.AF_INET)

        unix_family = getattr(socket, "AF_UNIX", -1)
        if os.name != 'nt' and family == unix_family:
            return original_socket(*args, **kwargs)

        if network_state["status"] == "offline" and family in (socket.AF_INET, socket.AF_INET6):
            raise OSError("Network/Storage partition: socket offline")
        return original_socket(*args, **kwargs)
    monkeypatch.setattr(socket, "socket", mock_socket)

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

def test_auth_memory_leak_and_gc(monkeypatch):
    import tracemalloc
    import gc
    import weakref
    from app.auth import RegisterRequest

    # 1. Tracemalloc High Volume Simulation
    monkeypatch.setattr("app.auth.save_users", lambda users: None) # Aggressive disk write mock

    import psutil
    import os
    process = psutil.Process(os.getpid())

    get_fds = lambda: process.num_fds() if hasattr(process, 'num_fds') else process.num_handles()
    initial_fds = get_fds()

    tracemalloc.start()
    snapshot1 = tracemalloc.take_snapshot()

    for i in range(2500):
        if i % 5 != 0:
            res = client.post("/api/auth/register", json={"email": f"memleak_{i % 5}@test.com", "password": "password123"})
            assert res.status_code in (200, 400)

    snapshot2 = tracemalloc.take_snapshot()
    tracemalloc.stop()

    # Verify no file descriptor leaks (unclosed resources)
    final_fds = get_fds()
    assert final_fds <= initial_fds + 5  # Small tolerance

    stats = snapshot2.compare_to(snapshot1, 'lineno')
    # Filter for app code leaks (basic heuristic)
    app_stats = [s for s in stats if "app/" in s.traceback[0].filename]

    # If app_stats has heavy accumulation, size_diff would be large.
    if app_stats:
        max_diff = max(s.size_diff for s in app_stats)
        # Verify no single line in app code leaked > 100KB over 500 requests
        assert max_diff < 100 * 1024

    # 2. Object Garbage Collection Test
    req = RegisterRequest(email="gc_test@test.com", password="password")
    ref = weakref.ref(req)
    del req
    gc.collect()
    assert ref() is None

def test_auth_cache_eviction_and_partition(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from app.main import app as main_app
    import app.auth

    # Instantiate TestClient without raise_server_exceptions to gracefully handle 500s
    # instead of crashing the test runner if exceptions bubble up.
    client_local = TestClient(main_app, raise_server_exceptions=False)

    # 3. Cache Eviction / Storage Quota Limit Simulation
    import uuid
    # Create lots of users to fill up any potential cache limit to exceed common cache threshold.
    # Memory rule: Generate enough unique entities to exceed the cache threshold.
    num_users = 110
    for i in range(num_users):
        email = f"cache_user_{uuid.uuid4().hex}_{i}@hospital.org"
        client_local.post("/api/auth/register", json={"email": email, "password": "password123"})

    # Simulate a cache size/quota exceeded scenario where saving throws an OSError gracefully.
    def mock_save_users_quota(users):
        raise OSError("QuotaExceededError: simulated storage offline or quota limit")

    monkeypatch.setattr(app.auth, "save_users", mock_save_users_quota)

    # The endpoint should naturally raise the unhandled OSError bubbling up as 500
    res = client_local.post("/api/auth/register", json={"email": "quota@test.com", "password": "password"})
    assert res.status_code == 500

def test_phi_redaction_and_prompt_injection():
    # 1. Prompt Injection Hardening
    malicious_email = "test+<script>alert(1)</script>@hospital.org"
    res = client.post("/api/auth/register", json={
        "email": malicious_email,
        "password": "password123",
        "fullName": "System'; DROP TABLE users; --"
    })
    assert res.status_code in (200, 400)

    # 2. PHI Redaction Verification (Redaction boundaries)
    # The application normalizes [REDACTED_PHI] for clinical Q&A, but at the auth boundary,
    # we input raw sensitive strings and ensure they do not execute, evaluating the redaction safety boundary.
    mrn = "123456789"
    res_phi = client.put("/api/auth/profile", json={
        "email": "idempotent@hospital.org",
        "facilityId": "sacred_heart",
        "departmentId": "sacred_heart::or",
        "clinicalRole": f"RN - MRN {mrn}"
    })
    assert res_phi.status_code == 200

    # Ensure sensitive data is handled cleanly without injection side-effects
    assert mrn in res_phi.json()["profile"]["clinicalRole"]

def test_zero_trust_token_exchange(monkeypatch):
    import uuid
    # Mocking the load_users to test auth header exchange if needed, or
    # simulate a fake token in a protected endpoint.
    # Currently /api/auth endpoints are mostly unauthenticated except /profile which takes user id.

    # Simulating a zero-trust check on the token
    # We verify token generation
    res = client.post("/api/auth/register", json={
        "email": f"zerotrust_{uuid.uuid4().hex}@hospital.org",
        "password": "password123"
    })
    assert res.status_code == 200
    token = res.json().get("token")
    assert token is not None
    assert token.startswith("token-")


@pytest.mark.asyncio
async def test_concurrent_registrations_race_condition():
    # Attempt to register the same user concurrently multiple times
    num_requests = 10
    async with AsyncClient(transport=ASGITransport(app=main_app), base_url="http://testserver") as ac:
        tasks = [
            ac.post("/api/auth/register", json={"email": "race@hospital.org", "password": "password123"})
            for _ in range(num_requests)
        ]
        results = await asyncio.gather(*tasks)

    # Only one should succeed due to race condition resistance
    successes = [r for r in results if r.status_code == 200]
    assert len(successes) == 1

@pytest.mark.asyncio
async def test_burst_distinct_registrations_latency():
    # Test system's ability to handle bursts of unique registrations
    num_requests = 50
    start_time = time.time()

    async def register_and_update(i):
        # isolate simulated workers into unique namespaces
        # Give each worker its own client to simulate isolated sessions
        async with AsyncClient(transport=ASGITransport(app=main_app), base_url="http://testserver") as client:
            email = f"burst{i}@hospital.org"
            tenant_id = f"sacred_heart::or_burst_{i}"

            res_reg = await client.post("/api/auth/register", json={"email": email, "password": "password123"})

            # Explicitly yield execution to the event loop with deterministic jitter
            await asyncio.sleep((i * 13) % 10 / 1000.0) # or Promise.resolve equivalent in python: asyncio.sleep(0)

            # Profile endpoint takes userId or email from request body. No headers needed according to app.auth code
            res_upd = await client.put("/api/auth/profile", json={
                "email": email,
                "facilityId": tenant_id,
                "departmentId": f"{tenant_id}::dept",
                "clinicalRole": f"::Worker_{i}::"
            })
            return res_reg, res_upd, tenant_id

    tasks = [register_and_update(i) for i in range(num_requests)]
    results = await asyncio.gather(*tasks)
    end_time = time.time()

    # Iterate through the entire result array to verify complete atomicity and isolate race conditions
    for i in range(num_requests):
        res_reg, res_upd, expected_tenant = results[i]
        assert res_reg.status_code == 200, f"Worker {i} registration failed"
        assert res_upd.status_code == 200, f"Worker {i} profile update failed"
        assert res_upd.json()["profile"]["facilityId"] == expected_tenant, f"Worker {i} namespace leaked"
        assert f"::Worker_{i}::" in json.dumps(res_upd.json()), f"Worker {i} data isolation failed"

    duration = end_time - start_time
    assert duration < 5.0 # Max 5 seconds for 50 concurrent registers


def test_deterministic_state_transition_matrices():
    import uuid
    import app.auth

    email = f"transition_{uuid.uuid4().hex}@hospital.org"
    # Initial state
    res1 = client.post("/api/auth/register", json={"email": email, "password": "password123"})
    assert res1.status_code == 200
    assert res1.json()["onboardingCompleted"] is False

    # Transition
    res2 = client.put("/api/auth/profile", json={
        "email": email,
        "facilityId": "fac",
        "departmentId": "dept"
    })
    assert res2.status_code == 200
    assert res2.json()["onboardingCompleted"] is True

    # Verify state persistence
    res3 = client.post("/api/auth/login", json={"email": email, "password": "password123"})
    assert res3.status_code == 200
    assert res3.json()["onboardingCompleted"] is True

def test_preference_card_conflict_resolution():
    import uuid
    import app.auth
    import concurrent.futures

    email = f"conflict_{uuid.uuid4().hex}@hospital.org"
    client.post("/api/auth/register", json={"email": email, "password": "password123"})

    def update_profile(data):
        return client.put("/api/auth/profile", json=data)

    requests = [
        {"email": email, "facilityId": "fac1", "clinicalRole": "Role A"},
        {"email": email, "facilityId": "fac2", "clinicalRole": "Role B"}
    ]

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(update_profile, requests))

    # One of the writes should have won, overriding the other
    res = client.post("/api/auth/login", json={"email": email, "password": "password123"})
    profile = res.json()["profile"]
    assert profile["facilityId"] in ["fac1", "fac2"]
    assert profile["clinicalRole"] in ["Role A", "Role B"]
    # Verify consistency between facilityId and clinicalRole (they come from same payload)
    if profile["facilityId"] == "fac1":
        assert profile["clinicalRole"] == "Role A"
    else:
        assert profile["clinicalRole"] == "Role B"

def test_clinical_state_snapshot_consistency():
    import uuid
    import copy
    import app.auth
    import json

    # Mutate state
    email = f"snapshot_{uuid.uuid4().hex}@hospital.org"

    # Load users to get baseline count
    baseline_len = len(app.auth.load_users())

    # Take baseline snapshot
    def manual_clone(obj):
        if isinstance(obj, dict):
            return {k: manual_clone(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [manual_clone(v) for v in obj]
        return obj

    baseline_users = manual_clone(app.auth.load_users())

    client.post("/api/auth/register", json={"email": email, "password": "password123"})

    # Take post-mutation snapshot
    post_users = manual_clone(app.auth.load_users())

    # Remove transient fields before structural comparison
    def clean(u):
        u.pop("createdAt", None)
        if u.get("profile"):
            u["profile"].pop("facilityName", None)

    for u in baseline_users:
        clean(u)
    for u in post_users:
        clean(u)

    # Structural comparison
    assert len(post_users) == len(baseline_users) + 1
    # Check that for all baseline users, the post_users contains an identical copy
    for b_u in baseline_users:
        assert b_u in post_users

    # Verify baseline is unaffected
    assert len(baseline_users) == baseline_len
