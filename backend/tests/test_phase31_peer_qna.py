"""
Phase 31 Test Suite: Orientee Question & Multi-Peer Verification Ping System.

Tests:
1. Asking an orientee question initializes it with status 'unverified' and verificationsCount 0.
2. Answering a question attaches PeerAnswer with isVerifiedConsensus False.
3. First peer verification vote increments count to 1 ('🟡 Unverified (1/2)').
4. Second peer verification vote transitions answer to verified consensus and question to 'verified' ('🟢 Verified').
5. Duplicate peer verification by same clinician is rejected from double-counting.
6. Filtering by tenant_id isolates department questions.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.peer_qna import load_peer_questions, save_peer_questions

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_peer_questions():
    """Ensure clean peer questions state before and after each test."""
    initial = load_peer_questions()
    yield
    # Restore clean state
    save_peer_questions(initial)


def test_create_orientee_question():
    """Verify posting an orientee question initializes with status 'unverified' and verificationsCount 0."""
    res = client.post(
        "/api/peer-questions",
        json={
            "tenant_id": "sacred_heart::or",
            "question_text": "What is the procedure if heparin is not reversed before chest close?",
            "asked_by": "Sean Iglesia, RN (Orientee)",
            "role": "Orientee Circulator",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["id"].startswith("pq-")
    assert data["tenantId"] == "sacred_heart::or"
    assert "heparin is not reversed" in data["questionText"]
    assert data["askedBy"] == "Sean Iglesia, RN (Orientee)"
    assert data["status"] == "unverified"
    assert data["verificationsCount"] == 0
    assert len(data["answers"]) == 0


def test_answer_and_multi_peer_verification_lifecycle():
    """
    Test full verification lifecycle:
    1. Orientee asks question -> status 'unverified' (0/2)
    2. Colleague submits answer
    3. Peer 1 verifies -> verificationsCount 1 ('🟡 Unverified (1/2)')
    4. Peer 2 verifies -> verificationsCount 2, answer consensus True, question 'verified' ('🟢 Verified')
    """
    # 1. Create question
    q_res = client.post(
        "/api/peer-questions",
        json={
            "tenant_id": "sacred_heart::or",
            "question_text": "Where is the emergency vascular shunt stored during ruptured AAA?",
            "asked_by": "Nurse Turk (Orientee)",
            "role": "Circulating RN",
        },
    )
    assert q_res.status_code == 200
    q_data = q_res.json()
    q_id = q_data["id"]
    assert q_data["status"] == "unverified"
    assert q_data["verificationsCount"] == 0

    # 2. Add an answer
    ans_res = client.post(
        f"/api/peer-questions/{q_id}/answers",
        json={
            "answered_by": "Dr. Christopher Turk",
            "answer_text": "Shunts are in Core Supply · Cart V · Shelf 1 · Bin A next to vascular clamp set.",
        },
    )
    assert ans_res.status_code == 200
    ans_data = ans_res.json()
    assert len(ans_data["answers"]) == 1
    answer = ans_data["answers"][0]
    a_id = answer["answerId"]
    assert answer["answeredBy"] == "Dr. Christopher Turk"
    assert answer["isVerifiedConsensus"] is False
    assert len(answer["verifiedBy"]) == 0

    # 3. Peer 1 verifies (Carla Espinosa) -> 1/2 verification
    v1_res = client.post(
        f"/api/peer-questions/{q_id}/answers/{a_id}/verify",
        json={"verified_by": "Carla Espinosa, RN"},
    )
    assert v1_res.status_code == 200
    v1_data = v1_res.json()
    assert v1_data["verificationsCount"] == 1
    assert v1_data["status"] == "unverified"  # Still unverified (1/2)
    ans1 = v1_data["answers"][0]
    assert ans1["isVerifiedConsensus"] is False
    assert "Carla Espinosa, RN" in ans1["verifiedBy"]

    # 4. Duplicate verification by same clinician must not double-count
    dup_res = client.post(
        f"/api/peer-questions/{q_id}/answers/{a_id}/verify",
        json={"verified_by": "Carla Espinosa, RN"},
    )
    assert dup_res.status_code == 200
    dup_data = dup_res.json()
    assert dup_data["verificationsCount"] == 1
    assert len(dup_data["answers"][0]["verifiedBy"]) == 1

    # 5. Peer 2 verifies (Dr. John Dorian) -> reaches threshold 2/2 -> auto-upgrades to 'verified'
    v2_res = client.post(
        f"/api/peer-questions/{q_id}/answers/{a_id}/verify",
        json={"verified_by": "Dr. John Dorian, MD"},
    )
    assert v2_res.status_code == 200
    v2_data = v2_res.json()
    assert v2_data["verificationsCount"] == 2
    assert v2_data["status"] == "verified"  # Upgraded to 🟢 Verified!
    ans2 = v2_data["answers"][0]
    assert ans2["isVerifiedConsensus"] is True
    assert len(ans2["verifiedBy"]) == 2
    assert "Carla Espinosa, RN" in ans2["verifiedBy"]
    assert "Dr. John Dorian, MD" in ans2["verifiedBy"]


def test_list_peer_questions_filtering():
    """Verify GET /api/peer-questions filters by tenant_id correctly."""
    # List all
    all_res = client.get("/api/peer-questions")
    assert all_res.status_code == 200
    all_qs = all_res.json()
    assert isinstance(all_qs, list)

    # Post a specific PACU question
    client.post(
        "/api/peer-questions",
        json={
            "tenant_id": "sacred_heart::pacu",
            "question_text": "What is the maximum time a patient can remain in Phase I PACU before escalation?",
            "asked_by": "PACU Orientee RN",
            "role": "PACU RN",
        },
    )

    # Filter for pacu
    pacu_res = client.get("/api/peer-questions?tenant_id=sacred_heart::pacu")
    assert pacu_res.status_code == 200
    pacu_qs = pacu_res.json()
    assert any("Phase I PACU" in q["questionText"] for q in pacu_qs)


def test_invalid_question_or_answer_not_found():
    """Verify 404 responses for missing question or answer."""
    bad_q = client.post("/api/peer-questions/pq-nonexistent/answers", json={"answer_text": "test"})
    assert bad_q.status_code == 404

    bad_v = client.post("/api/peer-questions/pq-seed-1/answers/pa-nonexistent/verify", json={"verified_by": "test"})
    assert bad_v.status_code == 404
