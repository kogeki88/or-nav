import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_verify_move_fuzz_payload():
    resp = client.post("/api/inventory/verify-move", json={
        "tenant_id": "sacred_heart::or",
        "item": "x" * 256,
        "expected_location": "x" * 256,
    })
    # Should be 422 after we add max_length to BaseModel
    assert resp.status_code == 422

def test_flag_wrong_fuzz_payload():
    resp = client.post("/api/inventory/flag-wrong", json={
        "tenant_id": "sacred_heart::or",
        "item": "x" * 256,
        "reason": "x" * 1000,
    })
    assert resp.status_code == 422

def test_create_question_fuzz_payload():
    resp = client.post("/api/questions", json={
        "tenant_id": "sacred_heart::or",
        "question_text": "x" * 1500,
    })
    assert resp.status_code == 422

def test_verify_move_invalid_tenant():
    resp = client.post("/api/inventory/verify-move", json={
        "tenant_id": "invalid tenant id with spaces",
        "item": "scalpel",
    })
    assert resp.status_code == 422

def test_flag_wrong_invalid_tenant():
    resp = client.post("/api/inventory/flag-wrong", json={
        "tenant_id": "<script>alert(1)</script>",
        "item": "scalpel",
        "reason": "missing",
    })
    assert resp.status_code == 422

def test_peer_qna_create_invalid_tenant():
    # Peer QnA endpoint
    resp = client.post("/api/questions", json={
        "tenant_id": "---invalid///",
        "question_text": "How do I do this?",
    })
    assert resp.status_code == 422


def test_verify_move_fuzz_payload_html():
    resp = client.post("/api/inventory/verify-move", json={
        "tenant_id": "sacred_heart::or",
        "item": "<script>alert(1)</script>",
        "expected_location": "location 1"
    })
    assert resp.status_code == 422

def test_flag_wrong_fuzz_payload_html():
    resp = client.post("/api/inventory/flag-wrong", json={
        "tenant_id": "sacred_heart::or",
        "item": "scalpel",
        "reason": "<script>alert(1)</script>"
    })
    assert resp.status_code == 422

def test_create_question_fuzz_payload_html():
    resp = client.post("/api/questions", json={
        "tenant_id": "sacred_heart::or",
        "question_text": "<script>alert(1)</script>"
    })
    assert resp.status_code == 422

def test_verify_move_fuzz_payload_sql():
    resp = client.post("/api/inventory/verify-move", json={
        "tenant_id": "sacred_heart::or",
        "item": "DROP TABLE inventory;",
        "expected_location": "location 1"
    })
    assert resp.status_code == 422

def test_flag_wrong_fuzz_payload_sql():
    resp = client.post("/api/inventory/flag-wrong", json={
        "tenant_id": "sacred_heart::or",
        "item": "scalpel",
        "reason": "INSERT INTO users"
    })
    assert resp.status_code == 422

def test_create_question_fuzz_payload_sql():
    resp = client.post("/api/questions", json={
        "tenant_id": "sacred_heart::or",
        "question_text": "SELECT * FROM secrets"
    })
    assert resp.status_code == 422
