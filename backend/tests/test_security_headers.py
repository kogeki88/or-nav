from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_cors_trusted_origin():
    response = client.options(
        "/health",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        }
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"

def test_cors_untrusted_origin():
    response = client.options(
        "/health",
        headers={
            "Origin": "https://malicious.com",
            "Access-Control-Request-Method": "GET",
        }
    )
    assert response.status_code == 400

def test_security_headers():
    response = client.get("/health")
    assert response.headers.get("X-Content-Type-Options") == "nosniff"
    assert response.headers.get("X-Frame-Options") == "DENY"
    assert response.headers.get("Content-Security-Policy") == "default-src 'self'; media-src 'self' mediastream:; frame-ancestors 'none';"
