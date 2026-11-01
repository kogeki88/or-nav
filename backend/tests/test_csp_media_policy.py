from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_csp_media_policy():
    response = client.get("/health")
    csp = response.headers.get("Content-Security-Policy", "")
    assert "media-src 'self' mediastream:" in csp
    assert "frame-ancestors 'none'" in csp
