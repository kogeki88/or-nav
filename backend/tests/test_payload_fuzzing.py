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
