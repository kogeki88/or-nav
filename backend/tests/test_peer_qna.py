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
