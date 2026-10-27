"""
OR-Nav Application Configuration.

Multi-tenant settings and environment variable loading.
"""

import os
import re
from pathlib import Path
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

# Project root: two levels up from this file (backend/app/config.py -> or-nav/)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
HOSPITALS_DIR = PROJECT_ROOT / "hospitals"

_VALID_TENANT_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_]+$")


def validate_tenant_id(tenant_id: str) -> str:
    """
    Validate that tenant_id is strictly alphanumeric and underscores.
    Rejects directory traversal (../, ..\\) and special characters.
    """
    clean = (tenant_id or "").strip()
    if not clean or not _VALID_TENANT_ID_PATTERN.match(clean):
        raise ValueError(
            f"Invalid tenant_id '{tenant_id}'. Must be non-empty alphanumeric with underscores only."
        )
    return clean


class TenantConfig(BaseModel):
    """Configuration for a single hospital tenant."""
    tenant_id: str
    display_name: str
    inventory_path: Path
    orientation_path: Path


def get_tenant(tenant_id: str) -> TenantConfig:
    """Load tenant configuration by ID. Tenant folders live under /hospitals/."""
    valid_id = validate_tenant_id(tenant_id)
    tenant_dir = (HOSPITALS_DIR / valid_id).resolve()
    hospitals_resolved = HOSPITALS_DIR.resolve()

    if not tenant_dir.is_relative_to(hospitals_resolved):
        raise ValueError(f"Path traversal detected: {tenant_id}")
    if not tenant_dir.is_dir():
        raise ValueError(f"Tenant directory not found: {valid_id}")

    return TenantConfig(
        tenant_id=valid_id,
        display_name=valid_id.replace("_", " ").title(),
        inventory_path=tenant_dir / "inventory.csv",
        orientation_path=tenant_dir / "orientation.md",
    )


def list_tenants() -> list[str]:
    """Return all available tenant IDs (subdirectories of /hospitals/)."""
    if not HOSPITALS_DIR.is_dir():
        return []
    return [
        d.name for d in HOSPITALS_DIR.iterdir()
        if d.is_dir() and (d / "inventory.csv").exists()
    ]


# --- Environment-driven settings ---

class Settings(BaseModel):
    """Global application settings loaded from environment."""
    app_name: str = "OR-Nav"
    debug: bool = os.getenv("ORNAV_DEBUG", "false").lower() == "true"
    host: str = os.getenv("ORNAV_HOST", "0.0.0.0")
    port: int = int(os.getenv("ORNAV_PORT", "8000"))
    default_tenant: str = os.getenv("ORNAV_DEFAULT_TENANT", "general_memorial_cvor")
    # Phase 2: Gemini API key will be loaded here
    # gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    # Phase 4: LiveKit credentials
    # livekit_url: str = os.getenv("LIVEKIT_URL", "")
    # livekit_api_key: str = os.getenv("LIVEKIT_API_KEY", "")
    # livekit_api_secret: str = os.getenv("LIVEKIT_API_SECRET", "")


settings = Settings()
