import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_csp_media_and_frame_ancestors():
    response = client.get("/health")
    assert response.status_code == 200
    csp = response.headers.get("Content-Security-Policy")
    assert csp is not None
    assert "media-src" in csp
    assert "frame-ancestors" in csp
