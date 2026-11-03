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
