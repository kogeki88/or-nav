"""
Tests for the Peer QnA Service (backend/app/peer_qna.py).
Tests question broadcast, answer threading, tenant scoping, and peer verification.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.peer_qna import load_peer_questions, save_peer_questions

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_peer_questions():
    """Ensure a clean peer questions state before and after each test."""
    initial = load_peer_questions()
    yield
    # Restore clean state
    save_peer_questions(initial)


def test_create_orientee_question():
    """Verify posting an orientee question initializes properly."""
    res = client.post(
        "/api/peer-questions",
        json={
            "tenant_id": "county_general::or",
            "question_text": "Where is the emergency vascular shunt stored during ruptured AAA?",
            "asked_by": "Orientee RN",
            "role": "Orientee Circulator",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["id"].startswith("pq-")
    assert data["tenantId"] == "county_general::or"
    assert "vascular shunt stored" in data["questionText"]
    assert data["askedBy"] == "Orientee RN"
    assert data["role"] == "Orientee Circulator"
    assert data["status"] == "unverified"
    assert data["verificationsCount"] == 0
    assert len(data["answers"]) == 0


def test_answer_and_multi_peer_verification_lifecycle():
    """
    Test full lifecycle: Ask -> Answer -> Verify (1/2) -> Verify (2/2) -> Verified.
    """
    # 1. Ask question
    q_res = client.post(
        "/api/peer-questions",
        json={
            "tenant_id": "county_general::or",
            "question_text": "What is the proper warm-up time for the Belmont rapid infuser?",
            "asked_by": "Nurse Orientee",
            "role": "Circulating RN",
        },
    )
    assert q_res.status_code == 200
    q_data = q_res.json()
    q_id = q_data["id"]
    assert q_data["status"] == "unverified"

    # 2. Add answer
    ans_res = client.post(
        f"/api/peer-questions/{q_id}/answers",
        json={
            "answered_by": "Dr. Benton",
            "answer_text": "About 1-2 minutes.",
        },
    )
    assert ans_res.status_code == 200
    ans_data = ans_res.json()
    assert len(ans_data["answers"]) == 1
    answer = ans_data["answers"][0]
    a_id = answer["answerId"]
    assert answer["answeredBy"] == "Dr. Benton"
    assert answer["isVerifiedConsensus"] is False

    # 3. Verify (1/2)
    v1_res = client.post(
        f"/api/peer-questions/{q_id}/answers/{a_id}/verify",
        json={"verified_by": "Nurse Hathaway"},
    )
    assert v1_res.status_code == 200
    v1_data = v1_res.json()
    assert v1_data["verificationsCount"] == 1
    assert v1_data["status"] == "unverified"
    ans1 = v1_data["answers"][0]
    assert ans1["isVerifiedConsensus"] is False
    assert "Nurse Hathaway" in ans1["verifiedBy"]

    # 4. Duplicate verify
    dup_res = client.post(
        f"/api/peer-questions/{q_id}/answers/{a_id}/verify",
        json={"verified_by": "Nurse Hathaway"},
    )
    assert dup_res.status_code == 200
    dup_data = dup_res.json()
    assert dup_data["verificationsCount"] == 1
    assert len(dup_data["answers"][0]["verifiedBy"]) == 1

    # 5. Verify (2/2) -> Verified
    v2_res = client.post(
        f"/api/peer-questions/{q_id}/answers/{a_id}/verify",
        json={"verified_by": "Dr. Carter"},
    )
    assert v2_res.status_code == 200
    v2_data = v2_res.json()
    assert v2_data["verificationsCount"] == 2
    assert v2_data["status"] == "verified"
    ans2 = v2_data["answers"][0]
    assert ans2["isVerifiedConsensus"] is True
    assert len(ans2["verifiedBy"]) == 2
    assert "Nurse Hathaway" in ans2["verifiedBy"]
    assert "Dr. Carter" in ans2["verifiedBy"]


def test_list_peer_questions_filtering():
    """Verify listing and tenant filtering."""
    # Add a county_general::or question
    client.post(
        "/api/peer-questions",
        json={
            "tenant_id": "county_general::or",
            "question_text": "Question for OR",
        },
    )
    # Add a county_general::pacu question
    client.post(
        "/api/peer-questions",
        json={
            "tenant_id": "county_general::pacu",
            "question_text": "Question for PACU",
        },
    )

    # Get all
    all_res = client.get("/api/peer-questions")
    assert all_res.status_code == 200
    assert len(all_res.json()) >= 2

    # Filter by PACU
    pacu_res = client.get("/api/peer-questions?tenant_id=county_general::pacu")
    assert pacu_res.status_code == 200
    pacu_qs = pacu_res.json()
    assert all("pacu" in q["tenantId"].lower() for q in pacu_qs)
    assert any("Question for PACU" in q["questionText"] for q in pacu_qs)


def test_invalid_question_or_answer_not_found():
    """Verify 404 responses for missing question or answer."""
    # Missing question for answer
    bad_q = client.post("/api/peer-questions/pq-nonexistent/answers", json={"answer_text": "test"})
    assert bad_q.status_code == 404

    # Missing question for verify
    bad_v1 = client.post("/api/peer-questions/pq-nonexistent/answers/pa-nonexistent/verify", json={"verified_by": "test"})
    assert bad_v1.status_code == 404

    # Valid question, missing answer for verify
    # First create a valid question
    q_res = client.post(
        "/api/peer-questions",
        json={
            "tenant_id": "sacred_heart::or",
            "question_text": "A valid question",
        },
    )
    assert q_res.status_code == 200
    q_id = q_res.json()["id"]

    bad_v2 = client.post(f"/api/peer-questions/{q_id}/answers/pa-nonexistent/verify", json={"verified_by": "test"})
    assert bad_v2.status_code == 404

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
