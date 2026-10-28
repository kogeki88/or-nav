"""
Phase 39: 2-Tier Adaptive Facility Lexicon & Implicit Learning Engine.

Enables the assistant to:
1. Preserve user's preferred terms (e.g. "Adson pickups" instead of forcing "Adson forceps").
2. Self-learn facility-wide slang across multiple users without overwriting individual speech styles.
3. Support multi-alias item mapping: multiple local names can map to the exact same catalog item.
4. Enforce strict facility isolation (Sacred Heart slang does not leak to County General).
"""

import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from pydantic import BaseModel, Field

# Root directory of the repository
ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
HOSPITALS_DIR = ROOT_DIR / "hospitals"

_lexicon_lock = threading.Lock()


class LearnedAliasEntry(BaseModel):
    aliasId: str
    facilityId: str
    departmentId: str = "or"
    spokenTerm: str
    displayPreferredName: str
    canonicalItemName: str
    usageCount: int = 1
    usedByUsers: List[str] = Field(default_factory=list)
    confidence: str = "personal"  # "personal" | "facility_learned" | "facility_consensus"
    updatedAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))


def get_facility_id_from_tenant(tenant_id: str) -> Tuple[str, str]:
    """
    Extract (facility_id, department_id) from tenant_id string.
    e.g.:
      'sacred_heart::or' -> ('sacred_heart', 'or')
      'princeton_plainsboro::er' -> ('princeton_plainsboro', 'er')
      'general_memorial_cvor' -> ('general_memorial', 'cvor')
      'or_main' -> ('general_memorial', 'or')
      'sacred_heart' -> ('sacred_heart', 'or')
    """
    clean = (tenant_id or "").strip().lower()
    if "::" in clean:
        parts = clean.split("::", 1)
        return parts[0].strip(), parts[1].strip()

    if clean.startswith("sacred_heart"):
        return "sacred_heart", clean.replace("sacred_heart_", "") or "or"
    if clean.startswith("princeton_plainsboro"):
        return "princeton_plainsboro", clean.replace("princeton_plainsboro_", "") or "or"
    if clean.startswith("county_general"):
        return "county_general", clean.replace("county_general_", "") or "or"
    if clean.startswith("duke_regional"):
        return "duke_regional", clean.replace("duke_regional_", "") or "or"
    if clean.startswith("metro_medical"):
        return "metro_medical", clean.replace("metro_medical_", "") or "or"
    if clean in ("general_memorial_cvor", "or_main", "pacu_periop", "er_trauma", "icu_critical_care"):
        dept = clean.split("_")[0]
        return "general_memorial", dept

    return clean or "sacred_heart", "or"


def _get_facility_lexicon_path(facility_id: str) -> Path:
    """Return path to hospitals/{facility_id}/learned_lexicon.json."""
    clean_fac = re.sub(r"[^a-zA-Z0-9_-]", "", facility_id.lower())
    fac_dir = HOSPITALS_DIR / clean_fac
    fac_dir.mkdir(parents=True, exist_ok=True)
    return fac_dir / "learned_lexicon.json"


def load_facility_lexicon(facility_id: str) -> List[dict]:
    """Load all learned aliases for a facility from disk."""
    path = _get_facility_lexicon_path(facility_id)
    with _lexicon_lock:
        if not path.exists():
            return []
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return data
            return []
        except Exception:
            return []


def save_facility_lexicon(facility_id: str, entries: List[dict]) -> None:
    """Save learned aliases for a facility to disk atomically."""
    path = _get_facility_lexicon_path(facility_id)
    with _lexicon_lock:
        temp_path = path.with_suffix(".tmp")
        temp_path.write_text(json.dumps(entries, indent=2, ensure_ascii=False), encoding="utf-8")
        temp_path.replace(path)


def reset_facility_lexicons() -> None:
    """Clear all facility lexicon files (used in tests)."""
    with _lexicon_lock:
        for fac in ["sacred_heart", "princeton_plainsboro", "county_general"]:
            p = _get_facility_lexicon_path(fac)
            if p.exists():
                try:
                    p.unlink()
                except Exception:
                    pass


def title_case_term(term: str) -> str:
    """Format user phrase cleanly into title case (e.g. 'adson pickups' -> 'Adson Pickups')."""
    words = term.strip().split()
    return " ".join(w.capitalize() if not w.isupper() else w for w in words)


def learn_alias(
    facility_id: str,
    department_id: str,
    spoken_term: str,
    canonical_item: str,
    user_id: str = "anonymous",
    display_name: Optional[str] = None,
    confidence_override: Optional[str] = None,
) -> dict:
    """
    Record or increment a learned alias entry for a facility.
    Upgrades confidence to 'facility_consensus' when usageCount >= 2 or usedByUsers.length >= 2.
    """
    norm_term = spoken_term.strip().lower()
    if not norm_term or not canonical_item:
        raise ValueError("Both spoken_term and canonical_item are required.")

    entries = load_facility_lexicon(facility_id)
    existing_entry: Optional[dict] = None

    for entry in entries:
        if entry.get("spokenTerm", "").lower() == norm_term:
            existing_entry = entry
            break

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    clean_user = (user_id or "anonymous").strip().lower()
    disp_name = display_name or title_case_term(spoken_term)

    if existing_entry:
        # Increment usage
        existing_entry["usageCount"] = int(existing_entry.get("usageCount", 1)) + 1
        users = set(existing_entry.get("usedByUsers", []))
        if clean_user and clean_user != "anonymous":
            users.add(clean_user)
        existing_entry["usedByUsers"] = sorted(list(users))
        existing_entry["updatedAt"] = now_iso
        existing_entry["canonicalItemName"] = canonical_item  # Update if re-bound
        existing_entry["displayPreferredName"] = disp_name

        # Confidence promotion logic: >= 2 uses or >= 2 distinct users
        if confidence_override:
            existing_entry["confidence"] = confidence_override
        elif len(users) >= 2 or existing_entry["usageCount"] >= 2:
            existing_entry["confidence"] = "facility_consensus"
        else:
            existing_entry["confidence"] = "facility_learned"

        save_facility_lexicon(facility_id, entries)
        return existing_entry

    # Create new entry
    alias_id = f"{facility_id}_{int(datetime.now(timezone.utc).timestamp())}_{len(entries) + 1}"
    new_entry = {
        "aliasId": alias_id,
        "facilityId": facility_id,
        "departmentId": department_id or "or",
        "spokenTerm": norm_term,
        "displayPreferredName": disp_name,
        "canonicalItemName": canonical_item,
        "usageCount": 1,
        "usedByUsers": [clean_user] if (clean_user and clean_user != "anonymous") else [],
        "confidence": confidence_override or ("facility_consensus" if clean_user in ("admin", "sean@sacredheart.org") else "personal"),
        "updatedAt": now_iso,
    }
    entries.append(new_entry)
    save_facility_lexicon(facility_id, entries)
    return new_entry


def resolve_spoken_alias(facility_id: str, query: str) -> Optional[dict]:
    """
    Check if a query matches any learned alias for this facility.
    Matches exact normalized phrase, singular/plural stem, or subphrase.
    """
    if not query:
        return None
    norm_q = query.strip().lower()
    entries = load_facility_lexicon(facility_id)

    # 1. Exact match on spokenTerm or singular/plural stem
    for entry in entries:
        term = entry.get("spokenTerm", "").lower()
        if term == norm_q:
            return entry
        if term.rstrip("s") == norm_q.rstrip("s") and len(term.rstrip("s")) >= 3:
            return entry

    # 2. Query equals displayPreferredName
    for entry in entries:
        disp = entry.get("displayPreferredName", "").lower()
        if disp == norm_q:
            return entry
        if disp.rstrip("s") == norm_q.rstrip("s") and len(disp.rstrip("s")) >= 3:
            return entry

    # 3. Word-bounded subphrase match (e.g. "where can i find adson pickups in or 21" or "where is the gemini")
    for entry in entries:
        term = entry.get("spokenTerm", "").lower()
        if len(term) >= 3:
            if re.search(rf"\b{re.escape(term)}\b", norm_q):
                return entry
            stem = term.rstrip("s")
            if len(stem) >= 3 and re.search(rf"\b{re.escape(stem)}(?:s)?\b", norm_q):
                return entry

    return None


def get_all_aliases_for_item(facility_id: str, canonical_item: str) -> List[str]:
    """
    Return all learned display aliases for a canonical item in this facility.
    e.g. ['Adson Pickups', 'Toothed Adson', '1x2 Pickups']
    """
    if not canonical_item:
        return []
    entries = load_facility_lexicon(facility_id)
    canonical_norm = canonical_item.strip().lower()

    aliases = []
    seen = set()
    for entry in entries:
        if entry.get("canonicalItemName", "").strip().lower() == canonical_norm:
            disp = entry.get("displayPreferredName") or title_case_term(entry.get("spokenTerm", ""))
            if disp.lower() not in seen:
                seen.add(disp.lower())
                aliases.append(disp)

    return aliases


# ---------------------------------------------------------------------------
# Conversational Teaching Intent Detection (Pathway A)
# ---------------------------------------------------------------------------

TEACH_PATTERNS = [
    # "[X] is called [Y]" / "[X] are called [Y]"
    re.compile(r"(?:the\s+)?(.+?)\s+(?:is|are)\s+called\s+(?:an?|the)?\s*([a-zA-Z0-9\s-]+?)(?:\.|$)", re.IGNORECASE),
    # "In this facility, [X] is called [Y]"
    re.compile(r"in\s+this\s+(?:facility|hospital|unit|or|department)\s*,\s*(?:the\s+)?(.+?)\s+(?:is|are)\s+called\s+(?:an?|the)?\s*([a-zA-Z0-9\s-]+?)(?:\.|$)", re.IGNORECASE),
    # "Remember that [X] are called [Y]" / "Remember that [X] is [Y]"
    re.compile(r"remember\s+that\s+(?:the\s+)?(.+?)\s+(?:are\s+called|is\s+called|means|is|are)\s+(?:an?|the)?\s*([a-zA-Z0-9\s-]+?)(?:\.|$)", re.IGNORECASE),
    # "Alias [X] to [Y]"
    re.compile(r"alias\s+(?:the\s+)?(.+?)\s+to\s+(?:an?|the)?\s*([a-zA-Z0-9\s-]+?)(?:\.|$)", re.IGNORECASE),
    # "Here we call [X] a/an/the/as [Y]"
    re.compile(r"(?:here\s+)?we\s+call\s+(?:the\s+)?(.+?)\s+(?:a|an|the|as)\s+([a-zA-Z0-9\s-]+?)(?:\.|$)", re.IGNORECASE),
    # "We call [X forceps/clamp/scissors/etc] [Y]"
    re.compile(r"(?:here\s+)?we\s+call\s+(?:the\s+)?(.+?\b(?:forceps|scissors|clamps?|retractors?|needle\s+drivers?|needle\s+holders?|sponges?|elevators?|rongeurs?|suction|tubes?))\s+([a-zA-Z0-9\s-]+?)(?:\.|$)", re.IGNORECASE),
    # Generic "Here we call [X] [Y]" fallback
    re.compile(r"(?:here\s+)?(?:we|i)\s+call\s+(?:the\s+)?([a-zA-Z0-9\s-]+?)\s+([a-zA-Z0-9\s-]+?)(?:\.|$)", re.IGNORECASE),
]


def detect_teaching_intent(text: str) -> Optional[Tuple[str, str]]:
    """
    Detect if text is a conversational teaching phrase.
    Returns (raw_part_a, raw_part_b) if matched, else None.
    e.g. 'We call Adson forceps Adson pickups' -> ('Adson forceps', 'Adson pickups')
    """
    clean = text.strip().rstrip(".")
    for pat in TEACH_PATTERNS:
        m = pat.match(clean)
        if m:
            part_a = m.group(1).strip()
            part_b = m.group(2).strip()
            if part_a and part_b and len(part_a) >= 2 and len(part_b) >= 2:
                # Filter out generic questions like "is called" in questions
                if not any(q in clean.lower() for q in ("what is", "why is", "who is", "where is")):
                    return part_a, part_b
    return None
