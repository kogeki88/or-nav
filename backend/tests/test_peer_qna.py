import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.peer_qna import load_peer_questions, save_peer_questions
import uuid

client = TestClient(app)

@pytest.fixture(autouse=True)
def clean_peer_questions():
    """Ensure clean peer questions state before and after each test."""
    initial = load_peer_questions()
    yield
    # Restore clean state
    save_peer_questions(initial)

def test_tenant_isolation_strict():
    """Explicitly verify that questions from one tenant do not leak into another's results."""
    # Create question in sacred_heart::or
    client.post(
        "/api/peer-questions",
        json={
            "tenant_id": "sacred_heart::or",
            "question_text": "Is this sacred heart OR?",
        },
    )

    # Create question in county_general::or
    client.post(
        "/api/peer-questions",
        json={
            "tenant_id": "county_general::or",
            "question_text": "Is this county general OR?",
        },
    )

    # Query sacred_heart::or
    sh_res = client.get("/api/peer-questions?tenant_id=sacred_heart::or")
    assert sh_res.status_code == 200
    sh_qs = sh_res.json()
    assert all("sacred_heart" in q["tenantId"].lower() or q["tenantId"].lower() == "or_main" for q in sh_qs)
    assert not any("county_general" in q["tenantId"].lower() for q in sh_qs)

    # Query county_general::or
    cg_res = client.get("/api/peer-questions?tenant_id=county_general::or")
    assert cg_res.status_code == 200
    cg_qs = cg_res.json()
    assert all("county_general" in q["tenantId"].lower() or q["tenantId"].lower() == "or_main" for q in cg_qs)
    assert not any("sacred_heart" in q["tenantId"].lower() for q in cg_qs)

def test_offline_mutation_replay_idempotency():
    """Simulate offline mutation replay and verify idempotency."""
    # Attempt to replay the same question submission twice
    q_payload = {
        "tenant_id": "sacred_heart::or",
        "question_text": "How to operate the new fluid warmer?",
        "asked_by": "Offline User",
        "idempotency_key": "idem-" + uuid.uuid4().hex
    }

    # 1. First execution
    res1 = client.post("/api/peer-questions", json=q_payload)
    assert res1.status_code == 200
    data1 = res1.json()

    # 2. Second execution (replay)
    res2 = client.post("/api/peer-questions", json=q_payload)
    assert res2.status_code == 200
    data2 = res2.json()

    assert data1 == data2


def test_offline_mutation_replay_answer_idempotency():
    """Simulate offline mutation replay for answers and verify idempotency."""
    # First, create a question
    q_res = client.post(
        "/api/peer-questions",
        json={
            "tenant_id": "sacred_heart::or",
            "question_text": "Question for answer idempotency test?",
        },
    )
    assert q_res.status_code == 200
    q_id = q_res.json()["id"]

    ans_payload = {
        "answered_by": "Offline Colleague",
        "answer_text": "Here is the answer.",
        "idempotency_key": "idem-ans-" + uuid.uuid4().hex
    }

    # 1. First execution
    res1 = client.post(f"/api/peer-questions/{q_id}/answers", json=ans_payload)
    assert res1.status_code == 200
    data1 = res1.json()
    assert len(data1["answers"]) == 1

    # 2. Second execution (replay)
    res2 = client.post(f"/api/peer-questions/{q_id}/answers", json=ans_payload)
    assert res2.status_code == 200
    data2 = res2.json()

    assert data1 == data2
    assert len(data2["answers"]) == 1


def test_offline_mutation_replay_verify_idempotency():
    """Simulate offline mutation replay for verifications and verify idempotency."""
    # First, create a question and an answer
    q_res = client.post(
        "/api/peer-questions",
        json={
            "tenant_id": "county_general::or",
            "question_text": "How do you do CPR?",
        },
    )
    assert q_res.status_code == 200
    q_id = q_res.json()["id"]

    ans_res = client.post(
        f"/api/peer-questions/{q_id}/answers",
        json={
            "answered_by": "Offline Colleague",
            "answer_text": "Push hard and fast.",
        }
    )
    assert ans_res.status_code == 200
    a_id = ans_res.json()["answers"][0]["answerId"]

    # The verify endpoint takes a verifier name and handles deduplication via the name itself
    # VerifyAnswerRequest only has verified_by, let's see how it behaves natively since deduplication is already implemented.
    # 1. First verification
    v1_res = client.post(
        f"/api/peer-questions/{q_id}/answers/{a_id}/verify",
        json={"verified_by": "Offline Verifier"}
    )
    assert v1_res.status_code == 200
    data1 = v1_res.json()
    assert data1["verificationsCount"] == 1

    # 2. Second verification (replay)
    v2_res = client.post(
        f"/api/peer-questions/{q_id}/answers/{a_id}/verify",
        json={"verified_by": "Offline Verifier"}
    )
    assert v2_res.status_code == 200
    data2 = v2_res.json()

    assert data1 == data2
    assert data2["verificationsCount"] == 1

def test_create_question_validation_boundary():
    """Boundary testing for schema validation in CreateQuestionRequest."""
    # Exceeding max length for question_text (max_length=1000)
    res = client.post(
        "/api/peer-questions",
        json={
            "tenant_id": "valid_tenant::or",
            "question_text": "A" * 1001,
        },
    )
    assert res.status_code == 422

    # Invalid tenant_id pattern (pattern=r"^[a-zA-Z0-9_\-\:]+$")
    res = client.post(
        "/api/peer-questions",
        json={
            "tenant_id": "invalid tenant id with spaces",
            "question_text": "Is this valid?",
        },
    )
    assert res.status_code == 422

    # Empty tenant_id (min_length=1)
    res = client.post(
        "/api/peer-questions",
        json={
            "tenant_id": "",
            "question_text": "Is this valid?",
        },
    )
    assert res.status_code == 422

    # Empty question_text (min_length=1)
    res = client.post(
        "/api/peer-questions",
        json={
            "tenant_id": "valid_tenant::or",
            "question_text": "",
        },
    )
    assert res.status_code == 422

def test_create_question_malformed_payload():
    """Resilience against malformed payloads."""
    # Incorrect types
    res = client.post(
        "/api/peer-questions",
        json={
            "tenant_id": {"not": "a string"},
            "question_text": ["also", "not", "a string"],
        },
    )
    assert res.status_code == 422

def test_fuzzing_create_question():
    """Fuzzing input fields to ensure zero unhandled exceptions."""
    import random
    import string

    def random_string(length):
        return ''.join(random.choices(string.ascii_letters + string.digits, k=length))

    for _ in range(20):
        # Generate random length but valid tenant_id and question_text
        tenant_id = random_string(random.randint(1, 95)) + "::or"
        question_text = random_string(random.randint(1, 1000))

        res = client.post(
            "/api/peer-questions",
            json={
                "tenant_id": tenant_id,
                "question_text": question_text,
                "idempotency_key": f"fuzz-{uuid.uuid4().hex}"
            },
        )
        # Should be successful with valid (even if random) inputs
        assert res.status_code == 200

import concurrent.futures
import time

def test_peer_qna_high_concurrency_burst():
    """Concurrent burst execution, race condition resistance, and latency benchmarks."""
    num_requests = 20
    tenant_1 = "sacred_heart::or"
    tenant_2 = "county_general::or"

    def make_request(i):
        tenant = tenant_1 if i % 2 == 0 else tenant_2
        payload = {
            "tenant_id": tenant,
            "question_text": f"Concurrent question {i}",
            "asked_by": "Concurrent User",
            "idempotency_key": f"concurrent-idem-{uuid.uuid4().hex}"
        }
        start_time = time.time()
        res = client.post("/api/peer-questions", json=payload)
        latency = time.time() - start_time
        return res.status_code, res.json(), latency, tenant

    start_wall = time.time()
    results = []
    # ThreadPoolExecutor is used to fire requests off quickly.
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(make_request, i) for i in range(num_requests)]
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())

    wall_latency = time.time() - start_wall

    # Assertions
    latencies = [r[2] for r in results]
    avg_latency = sum(latencies) / len(latencies)
    assert avg_latency < 1.0  # Expect reasonable average latency

    for status, data, lat, tenant in results:
        assert status == 200
        assert data["tenantId"] == tenant

    # Verify Multi-tenant Isolation after burst
    sh_res = client.get(f"/api/peer-questions?tenant_id={tenant_1}")
    cg_res = client.get(f"/api/peer-questions?tenant_id={tenant_2}")

    sh_qs = sh_res.json()
    cg_qs = cg_res.json()

    assert all("sacred_heart" in q["tenantId"].lower() or q["tenantId"].lower() == "or_main" for q in sh_qs)
    assert all("county_general" in q["tenantId"].lower() or q["tenantId"].lower() == "or_main" for q in cg_qs)

def test_offline_first_concurrent_answers_and_verifications():
    """Enforce offline-first invariants with concurrent answers and verifications on a single question."""
    # 1. Create a base question offline
    q_payload = {
        "tenant_id": "sacred_heart::or",
        "question_text": "Concurrent offline verification target?",
        "asked_by": "Offline Creator",
        "idempotency_key": f"offline-q-{uuid.uuid4().hex}"
    }
    q_res = client.post("/api/peer-questions", json=q_payload)
    assert q_res.status_code == 200
    q_id = q_res.json()["id"]

    # 2. Concurrently add answers and verifications simulating offline sync replay
    # We serialize the answer addition but verify concurrently

    # Let's create an answer first
    a_payload = {
        "answered_by": "Offline Responder Main",
        "answer_text": "Offline Answer Main",
        "idempotency_key": f"offline-a-{uuid.uuid4().hex}"
    }
    res_a = client.post(f"/api/peer-questions/{q_id}/answers", json=a_payload)
    assert res_a.status_code == 200
    a_id = res_a.json()["answers"][-1]["answerId"]

    num_verifications = 20
    def add_verify(i):
        # Verify
        v_payload = {
            "verified_by": f"Offline Verifier {i}"
        }
        res_v = client.post(f"/api/peer-questions/{q_id}/answers/{a_id}/verify", json=v_payload)
        return res_v.status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(add_verify, i) for i in range(num_verifications)]
        statuses = [f.result() for f in concurrent.futures.as_completed(futures)]

    for s in statuses:
        assert s == 200

    final_q_res = client.get(f"/api/peer-questions?tenant_id=sacred_heart::or")
    final_q = next((q for q in final_q_res.json() if q["id"] == q_id), None)
    assert final_q is not None

    # We should have all verifications
    ans = next((a for a in final_q["answers"] if a["answerId"] == a_id), None)
    assert ans is not None
    assert len(ans["verifiedBy"]) == num_verifications

def test_extended_multi_tenant_boundary_enforcement_and_offline_replay():
    """Verify facility_id::dept_id multi-tenant boundary isolation alongside offline mutation replay idempotency."""
    fac_dept_1 = "alpha_facility::icu"
    fac_dept_2 = "beta_facility::er"

    # Replay idempotency for tenant 1
    q_payload_1 = {
        "tenant_id": fac_dept_1,
        "question_text": "How to operate alpha equipment?",
        "asked_by": "Alpha Nurse",
        "idempotency_key": f"idem-alpha-q-{uuid.uuid4().hex}"
    }

    # 1st creation
    r1a = client.post("/api/peer-questions", json=q_payload_1)
    assert r1a.status_code == 200
    q_id_1 = r1a.json()["id"]

    # 2nd creation (replay)
    r1b = client.post("/api/peer-questions", json=q_payload_1)
    assert r1b.status_code == 200
    assert r1a.json() == r1b.json()

    # Replay idempotency for answers in tenant 1
    a_payload_1 = {
        "answered_by": "Alpha Doctor",
        "answer_text": "Push the red button.",
        "idempotency_key": f"idem-alpha-a-{uuid.uuid4().hex}"
    }
    ra1a = client.post(f"/api/peer-questions/{q_id_1}/answers", json=a_payload_1)
    ra1b = client.post(f"/api/peer-questions/{q_id_1}/answers", json=a_payload_1)
    assert ra1a.json() == ra1b.json()

    a_id_1 = ra1a.json()["answers"][-1]["answerId"]

    # Replay idempotency for verifications in tenant 1
    v_payload_1 = {"verified_by": "Alpha Verifier"}
    rv1a = client.post(f"/api/peer-questions/{q_id_1}/answers/{a_id_1}/verify", json=v_payload_1)
    rv1b = client.post(f"/api/peer-questions/{q_id_1}/answers/{a_id_1}/verify", json=v_payload_1)
    assert rv1a.json() == rv1b.json()

    # Same for tenant 2 to ensure data exists for both
    q_payload_2 = {
        "tenant_id": fac_dept_2,
        "question_text": "How to operate beta equipment?",
        "asked_by": "Beta Nurse",
        "idempotency_key": f"idem-beta-q-{uuid.uuid4().hex}"
    }
    r2 = client.post("/api/peer-questions", json=q_payload_2)
    q_id_2 = r2.json()["id"]

    # Now enforce Multi-tenant boundary isolation
    res_get1 = client.get(f"/api/peer-questions?tenant_id={fac_dept_1}")
    res_get2 = client.get(f"/api/peer-questions?tenant_id={fac_dept_2}")

    data1 = res_get1.json()
    data2 = res_get2.json()

    # Tenant 1 should only see tenant 1 questions
    assert any(q["id"] == q_id_1 for q in data1)
    assert not any(q["id"] == q_id_2 for q in data1)

    # Tenant 2 should only see tenant 2 questions
    assert any(q["id"] == q_id_2 for q in data2)
    assert not any(q["id"] == q_id_1 for q in data2)

from unittest.mock import patch
import time

def test_network_partition_unhandled_storage_failure():
    """Simulate a network partition / storage failure that results in a 500 error."""
    tenant = "sacred_heart::or"
    payload = {
        "tenant_id": tenant,
        "question_text": "Is this system completely down?",
        "idempotency_key": f"fail-q-{uuid.uuid4().hex}"
    }

    # Simulate storage failing unexpectedly
    with patch("app.peer_qna.save_peer_questions", side_effect=OSError("Network partition / Disk unreachable")):
        try:
            res = client.post("/api/peer-questions", json=payload)
            # The test client can raise or return 500 depending on raise_server_exceptions
            assert res.status_code == 500
        except OSError:
            # If it bubbles up directly because of test client configuration
            pass

def test_fault_injection_intermittent_latency_create_question():
    """Simulate intermittent network latency / degraded backend state."""
    tenant = "county_general::or"

    # Use side_effect to inject a small sleep, then return the actual load result
    def slow_load():
        time.sleep(0.5)
        return load_peer_questions()

    with patch("app.peer_qna.load_peer_questions", side_effect=slow_load):
        payload = {
            "tenant_id": tenant,
            "question_text": "Is this system degraded?",
            "idempotency_key": f"lat-q-{uuid.uuid4().hex}"
        }
        start = time.time()
        res = client.post("/api/peer-questions", json=payload)
        duration = time.time() - start

        assert res.status_code == 200
        # Allow some flexibility for test flakiness
        assert duration >= 0.1
        assert res.json()["questionText"] == "Is this system degraded?"

def test_self_healing_reconnection_idempotent_sync():
    """Simulate a network state changing from offline to online and assert self-healing synchronization."""
    network_state = {"status": "offline"}
    tenant = "sacred_heart::or"
    q_idempotency = f"heal-q-{uuid.uuid4().hex}"

    payload = {
        "tenant_id": tenant,
        "question_text": "Will this sync when online?",
        "idempotency_key": q_idempotency
    }

    original_save = save_peer_questions

    def mocked_save(questions):
        if network_state["status"] == "offline":
            raise OSError("Network partition")
        original_save(questions)

    # 1. Offline attempt fails
    with patch("app.peer_qna.save_peer_questions", side_effect=mocked_save):
        try:
            client.post("/api/peer-questions", json=payload)
        except OSError:
            pass

    # Question should not be saved yet
    res_get_1 = client.get(f"/api/peer-questions?tenant_id={tenant}")
    assert not any(q["idempotencyKey"] == q_idempotency for q in res_get_1.json())

    # 2. State recovers to online, sync queue flushes (client retries)
    network_state["status"] = "online"

    with patch("app.peer_qna.save_peer_questions", side_effect=mocked_save):
        res_sync = client.post("/api/peer-questions", json=payload)
        assert res_sync.status_code == 200

    # 3. Question should now be successfully saved and accessible
    res_get_2 = client.get(f"/api/peer-questions?tenant_id={tenant}")
    assert any(q["idempotencyKey"] == q_idempotency for q in res_get_2.json())

    # 4. A duplicate retry from another tab/queue should be idempotent and not create duplicates
    with patch("app.peer_qna.save_peer_questions", side_effect=mocked_save):
        res_sync_dup = client.post("/api/peer-questions", json=payload)
        assert res_sync_dup.status_code == 200

    res_get_3 = client.get(f"/api/peer-questions?tenant_id={tenant}")
    matches = [q for q in res_get_3.json() if q["idempotencyKey"] == q_idempotency]
    assert len(matches) == 1

import tracemalloc
import gc

def test_memory_leak_on_high_volume_requests():
    """Verify memory growth is constrained during a burst of queries (memory leak detection)."""
    tracemalloc.start()

    gc.collect()
    snapshot1 = tracemalloc.take_snapshot()

    tenant = "sacred_heart::or"
    for _ in range(500):
        client.post("/api/peer-questions", json={
            "tenant_id": tenant,
            "question_text": "Is this leaking memory?",
            "idempotency_key": f"mem-{uuid.uuid4().hex}"
        })
        client.get(f"/api/peer-questions?tenant_id={tenant}")

    gc.collect()
    snapshot2 = tracemalloc.take_snapshot()

    tracemalloc.stop()

    stats = snapshot2.compare_to(snapshot1, 'lineno')
    total_diff_b = sum(stat.size_diff for stat in stats)

    total_diff_mb = total_diff_b / (1024 * 1024)
    assert total_diff_mb < 50.0, f"Memory leak detected! Growth: {total_diff_mb:.2f} MB"

def test_peer_qna_cache_eviction_limits():
    """Verify memory constraints enforce eviction limits for peer questions."""
    tenant = "county_general::or"
    import app.peer_qna

    original_max = app.peer_qna.MAX_PEER_QUESTIONS
    app.peer_qna.MAX_PEER_QUESTIONS = 5

    try:
        # Create 10 questions to exceed the max limit of 5
        for i in range(10):
            client.post("/api/peer-questions", json={
                "tenant_id": tenant,
                "question_text": f"Question {i}",
                "idempotency_key": f"evict-{uuid.uuid4().hex}"
            })

        res = client.get(f"/api/peer-questions?tenant_id={tenant}")
        questions = res.json()

        # Only check the questions belonging *exactly* to this tenant to avoid seed overlap or partial matching
        exact_tenant_questions = [q for q in questions if q["tenantId"] == tenant]

        # Max limit is enforced per-tenant, so there should be exactly 5 questions for this exact tenant
        assert len(exact_tenant_questions) == 5
    finally:
        app.peer_qna.MAX_PEER_QUESTIONS = original_max

def test_unclosed_resources_and_fds():
    """Verify that no file descriptors or sockets are leaked during a burst of requests."""
    import psutil
    import os
    process = psutil.Process(os.getpid())

    # Get initial FD count
    initial_fds = process.num_fds() if hasattr(process, 'num_fds') else process.num_handles()

    tenant = "sacred_heart::or"
    for _ in range(100):
        client.post("/api/peer-questions", json={
            "tenant_id": tenant,
            "question_text": "Is this leaking FDs?",
            "idempotency_key": f"fds-{uuid.uuid4().hex}"
        })

    final_fds = process.num_fds() if hasattr(process, 'num_fds') else process.num_handles()
    # Allow small tolerance for test runner operations
    assert final_fds <= initial_fds + 5, f"FD leak detected: {initial_fds} -> {final_fds}"
