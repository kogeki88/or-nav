import pytest
from fastapi.testclient import TestClient
from app.main import app
import hashlib

client = TestClient(app)

def test_ota_bundle_verification_valid_checksum():
    """Test OTA bundle verification with a valid checksum."""
    content = b"test payload for valid checksum"
    valid_checksum = hashlib.sha256(content).hexdigest()

    files = {"file": ("test.apk", content, "application/vnd.android.package-archive")}
    data = {"checksum": valid_checksum}

    response = client.post("/api/ota/upload", files=files, data=data)
    assert response.status_code == 200
    assert response.json()["status"] == "success"

def test_ota_bundle_verification_mismatched_hash():
    """Test OTA bundle verification with a mismatched hash is rejected."""
    content = b"test payload for invalid checksum"
    mismatched_checksum = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"

    files = {"file": ("test.apk", content, "application/vnd.android.package-archive")}
    data = {"checksum": mismatched_checksum}

    response = client.post("/api/ota/upload", files=files, data=data)
    assert response.status_code == 400
    assert "Corrupted payload" in response.json()["detail"]

def test_assert_invalid_packages_rejected_without_filesystem():
    """Assert invalid packages are immediately rejected without touching filesystem."""
    content = b"another test payload"
    mismatched_checksum = "wrongchecksum"

    files = {"file": ("test.apk", content, "application/vnd.android.package-archive")}
    data = {"checksum": mismatched_checksum}

    response = client.post("/api/ota/upload", files=files, data=data)
    assert response.status_code == 400
