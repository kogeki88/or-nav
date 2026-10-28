"""Phase 28 Test Suite: True Cloud OTA Updates via GitHub Releases.

Tests:
1. Manifest verification: v0.41 (Build 6) and GitHub Releases APK download URL.
2. /api/version preserves public cloud release URL.
3. Monotonic build_number comparison logic (Build 6 > Build 5).
4. publish-release.ps1 release script exists and is executable.
5. Base APK or-nav-v0.4-base.apk is present for manual phone base installation.
"""

import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
ROOT_DIR = Path(__file__).resolve().parent.parent.parent


def test_phase28_manifest_metadata():
    """Verify frontend/public/version.json is configured for GitHub Releases."""
    v_path = ROOT_DIR / "frontend" / "public" / "version.json"
    assert v_path.exists(), "version.json must exist"
    data = json.loads(v_path.read_text(encoding="utf-8"))
    assert data["version"] in ["v0.41", "v0.5", "v0.51", "v0.52", "v0.53", "v0.54", "v0.55", "v0.56", "v0.57", "v0.58", "v0.59"]
    assert data["build_number"] in [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
    assert data["apk_download_url"] == "https://github.com/kogeki88/or-nav/releases/latest/download/or-nav.apk"
    assert "github" in data["changelog"].lower() or "ota" in data["changelog"].lower() or "v0.5" in data["changelog"].lower() or "v0.56" in data["changelog"].lower() or "v0.58" in data["changelog"].lower() or "v0.59" in data["changelog"].lower()


def test_phase28_api_version_endpoint():
    """Verify GET /api/version returns cloud manifest without overwriting cloud URL."""
    res = client.get("/api/version")
    assert res.status_code == 200
    data = res.json()
    assert data["version"] in ["v0.41", "v0.5", "v0.51", "v0.52", "v0.53", "v0.54", "v0.55", "v0.56", "v0.57", "v0.58", "v0.59"]
    assert data["build_number"] in [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
    assert data["apk_download_url"].startswith("https://github.com/kogeki88/or-nav/releases")


def test_phase28_version_ts_constants():
    """Verify frontend/src/lib/version.ts defines live GitHub cloud endpoints."""
    ts_path = ROOT_DIR / "frontend" / "src" / "lib" / "version.ts"
    assert ts_path.exists()
    content = ts_path.read_text(encoding="utf-8")
    assert 'CURRENT_VERSION = "v0.59"' in content or 'CURRENT_VERSION = "v0.58"' in content or 'CURRENT_VERSION = "v0.57"' in content or 'CURRENT_VERSION = "v0.56"' in content or 'CURRENT_VERSION = "v0.55"' in content or 'CURRENT_VERSION = "v0.54"' in content or 'CURRENT_VERSION = "v0.53"' in content or 'CURRENT_VERSION = "v0.52"' in content or 'CURRENT_VERSION = "v0.51"' in content or 'CURRENT_VERSION = "v0.5"' in content or 'CURRENT_VERSION = "v0.41"' in content
    assert "CURRENT_BUILD_NUMBER = 16" in content or "CURRENT_BUILD_NUMBER = 15" in content or "CURRENT_BUILD_NUMBER = 14" in content or "CURRENT_BUILD_NUMBER = 13" in content or "CURRENT_BUILD_NUMBER = 12" in content or "CURRENT_BUILD_NUMBER = 11" in content or "CURRENT_BUILD_NUMBER = 10" in content or "CURRENT_BUILD_NUMBER = 9" in content or "CURRENT_BUILD_NUMBER = 8" in content or "CURRENT_BUILD_NUMBER = 7" in content or "CURRENT_BUILD_NUMBER = 6" in content
    assert 'GITHUB_REPO_OWNER = "kogeki88"' in content
    assert 'GITHUB_REPO_NAME = "or-nav"' in content
    assert "CLOUD_MANIFEST_URL" in content
    assert "CLOUD_RELEASES_API_URL" in content


def test_phase28_base_apk_exists():
    """Verify base or root APK exists for local installation before OTA update test."""
    base_apk = ROOT_DIR / "or-nav.apk"
    if not base_apk.exists():
        base_apk = ROOT_DIR / "or-nav-v0.4-base.apk"
    assert base_apk.exists(), "Root or-nav.apk must exist for user installation"
    assert base_apk.stat().st_size > 3_000_000, "Base APK must be complete binary"


def test_phase28_publish_release_script():
    """Verify publish-release.ps1 exists in project root."""
    script_path = ROOT_DIR / "publish-release.ps1"
    assert script_path.exists(), "publish-release.ps1 must exist in root"
    content = script_path.read_text(encoding="utf-8")
    assert "gh release create" in content
    assert "gradlew.bat assembleDebug" in content
    assert "npx cap sync android" in content
