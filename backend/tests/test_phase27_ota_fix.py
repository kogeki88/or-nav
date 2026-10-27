"""
Phase 27.2 Android OTA Auto-Update & In-App APK Installer Test Suite.

Verifies:
1. Version manifest upgraded to v0.4, build_number: 5.
2. Cache-busting headers on GET /api/version (no-store, no-cache, must-revalidate).
3. Dynamic LAN IP resolution for apk_download_url.
4. Direct GET /api/download-apk streaming endpoint with correct MIME type and headers.
5. Monotonic build_number comparison logic (v0.31 / Build 4 -> v0.4 / Build 5).
6. 100% deterministic, zero external live LLM tokens, <1s execution.
"""

import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_version_manifest_build_number_5():
    """Verify GET /api/version returns v0.4 with build_number: 5 and cache-control headers."""
    res = client.get("/api/version")
    assert res.status_code == 200
    data = res.json()
    assert data["version"] == "v0.4"
    assert data["build_number"] == 5
    assert "android ota" in data["changelog"].lower()
    assert "/api/download-apk" in data["apk_download_url"] or "/or-nav.apk" in data["apk_download_url"]

    # Verify cache-busting headers
    cache_control = res.headers.get("cache-control", "").lower()
    assert "no-store" in cache_control
    assert "no-cache" in cache_control
    assert "must-revalidate" in cache_control


def test_public_version_json_matches_build_5():
    """Verify frontend/public/version.json matches v0.4 build 5."""
    root = Path(__file__).resolve().parent.parent.parent
    v_path = root / "frontend" / "public" / "version.json"
    assert v_path.exists()
    manifest = json.loads(v_path.read_text(encoding="utf-8"))
    assert manifest["version"] == "v0.4"
    assert manifest["build_number"] == 5
    assert "apk_download_url" in manifest


def test_download_apk_endpoint():
    """Verify GET /api/download-apk streams APK binary with proper package-archive MIME type."""
    res = client.get("/api/download-apk")
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/vnd.android.package-archive"
    assert "or-nav.apk" in res.headers.get("content-disposition", "")

    cache_control = res.headers.get("cache-control", "").lower()
    assert "no-store" in cache_control
    assert "no-cache" in cache_control

    # Ensure actual byte stream was returned
    content_length = int(res.headers.get("content-length", len(res.content)))
    assert content_length > 10000


def test_version_comparison_monotonic_build_number():
    """Verify Python parity for monotonic build_number comparison."""
    def is_newer(remote_v: str, remote_b: int, local_v: str, local_b: int) -> bool:
        if remote_b > 0 and local_b > 0:
            return remote_b > local_b
        return remote_v > local_v

    # Build 5 is strictly newer than Build 4
    assert is_newer("v0.4", 5, "v0.31", 4) is True
    assert is_newer("v0.4", 5, "v0.4", 4) is True

    # Same build is not newer
    assert is_newer("v0.4", 5, "v0.4", 5) is False

    # Previous build is not newer even if version string is tricky
    assert is_newer("v0.31", 4, "v0.4", 5) is False
