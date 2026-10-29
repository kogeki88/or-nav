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

_VALID_TENANT_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_\/]+$")


def validate_tenant_id(tenant_id: str) -> str:
    """
    Validate that tenant_id is strictly alphanumeric, underscores, or slashes.
    Rejects directory traversal (../, ..\\) and special characters.
    Normalizes double-colon notation (e.g. sacred_heart::or -> sacred_heart/or).
    """
    if not tenant_id or not tenant_id.strip():
        return 'or_main'

    clean = tenant_id.strip().replace("::", "/")
    if not _VALID_TENANT_ID_PATTERN.match(clean) or ".." in clean:
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


DEPARTMENTS = {
    "or_main": {
        "id": "or_main",
        "name": "Operating Room (OR)",
        "short_name": "OR",
        "category": "Multi-Specialty Surgical Suite",
        "placeholder": "Ask where an instrument/suture is, surgeon preferences, or report a move...",
        "notes_label": "Surgeon & Case Notes",
        "role_prompt": "Operating Room multi-specialty surgical circulator and scrub specialist",
        "vocab_hint": "DeBakey, Weitlaner, Prolene, Ti-Cron, Vicryl, Monocryl, Trocar, LigaSure, Dantrolene, Bovie, Heparin, Bone Wax, Gelfoam, Stryker, Pruitt",
    },
    "icu_critical_care": {
        "id": "icu_critical_care",
        "name": "ICU / Critical Care",
        "short_name": "ICU",
        "category": "Intensive Care Unit",
        "placeholder": "Find line kits, drip supplies, vent equipment, or check unit protocols...",
        "notes_label": "Clinical & Unit Notes",
        "role_prompt": "Intensive Care Unit (ICU) critical care nurse and clinician specialist",
        "vocab_hint": "Central line, Arterial line, GlideScope, Pleur-evac, CRRT, Norepinephrine, Propofol, ETT, Suction catheter, Transducer, Prismaflex",
    },
    "er_trauma": {
        "id": "er_trauma",
        "name": "Emergency Dept (ER)",
        "short_name": "ER",
        "category": "Emergency & Trauma Resuscitation",
        "placeholder": "Locate trauma trays, airway carts, RSI supplies, or check ED protocols...",
        "notes_label": "Clinical & Unit Notes",
        "role_prompt": "Emergency Department (ED) trauma nurse and emergency resuscitation specialist",
        "vocab_hint": "RSI tackle box, EZ-IO, Thoracotomy tray, Rapid infuser, SAM sling, Cricothyrotomy, C-collar, Narcan, Trauma bay, Belmont",
    },
    "pacu_periop": {
        "id": "pacu_periop",
        "name": "PACU / Pre-Op",
        "short_name": "PACU",
        "category": "Post-Anesthesia Care & Recovery",
        "placeholder": "Locate reversal agents, block cart supplies, airway kits, or phase criteria...",
        "notes_label": "Clinical & Unit Notes",
        "role_prompt": "PACU and Post-Anesthesia Care unit recovery nurse specialist",
        "vocab_hint": "Sugammadex, Nerve block, Bair Hugger, Trumpet airway, Aldrete, Ondansetron, Neostigmine, High-flow cannula, Reversal",
    },
}


def get_tenant(tenant_id: str) -> TenantConfig:
    """Load tenant configuration by ID. Supports flat and hierarchical facility/dept paths."""
    valid_id = validate_tenant_id(tenant_id)
    hospitals_resolved = HOSPITALS_DIR.resolve()

    # 1. Direct path e.g. hospitals/or_main or hospitals/general_memorial/or
    tenant_dir = (HOSPITALS_DIR / valid_id).resolve()

    # 2. If not found, attempt splitting underscore e.g. general_memorial_or -> general_memorial/or
    if not (tenant_dir.is_relative_to(hospitals_resolved) and tenant_dir.is_dir()):
        parts = valid_id.split("_")
        for i in range(1, len(parts)):
            fac_part = "_".join(parts[:i])
            dept_part = "_".join(parts[i:])
            candidate = (HOSPITALS_DIR / fac_part / dept_part).resolve()
            if candidate.is_relative_to(hospitals_resolved) and candidate.is_dir():
                tenant_dir = candidate
                break

    if not (tenant_dir.is_relative_to(hospitals_resolved) and tenant_dir.is_dir()):
        raise ValueError(f"Tenant directory not found: {valid_id}")

    dept_key = valid_id.split("/")[-1] if "/" in valid_id else valid_id.split("_")[-1]
    dept_info = DEPARTMENTS.get(valid_id) or DEPARTMENTS.get(dept_key) or DEPARTMENTS.get(f"{dept_key}_main")
    display_name = dept_info["name"] if dept_info else valid_id.replace("_", " ").title()

    return TenantConfig(
        tenant_id=valid_id,
        display_name=display_name,
        inventory_path=tenant_dir / "inventory.csv",
        orientation_path=tenant_dir / "orientation.md",
    )


def list_tenants() -> list[str]:
    """Return all available tenant IDs (subdirectories of /hospitals/)."""
    if not HOSPITALS_DIR.is_dir():
        return []
    found = [
        d.name for d in HOSPITALS_DIR.iterdir()
        if d.is_dir() and (d / "inventory.csv").exists()
    ]
    preferred_order = ["or_main", "icu_critical_care", "er_trauma", "pacu_periop"]
    ordered = [t for t in preferred_order if t in found]
    ordered.extend([t for t in found if t not in ordered])
    return ordered


# --- Environment-driven settings ---

class Settings(BaseModel):
    """Global application settings loaded from environment."""
    app_name: str = "OR-Nav"
    debug: bool = os.getenv("ORNAV_DEBUG", "false").lower() == "true"
    host: str = os.getenv("ORNAV_HOST", "0.0.0.0")
    port: int = int(os.getenv("ORNAV_PORT", "8000"))
    default_tenant: str = os.getenv("ORNAV_DEFAULT_TENANT", "or_main")
    # Phase 2: Gemini API key will be loaded here
    # gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    # Phase 4: LiveKit credentials
    # livekit_url: str = os.getenv("LIVEKIT_URL", "")
    # livekit_api_key: str = os.getenv("LIVEKIT_API_KEY", "")
    # livekit_api_secret: str = os.getenv("LIVEKIT_API_SECRET", "")


settings = Settings()
