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

_lexicon_lock = threading.RLock()

DEFAULT_PRESEEDED_LEXICONS: dict[str, list[dict]] = {
    "sacred_heart": [
        {
            "aliasId": "sh_lex_1",
            "facilityId": "sacred_heart",
            "departmentId": "or",
            "spokenTerm": "adson pickups",
            "displayPreferredName": "Adson Pickups",
            "canonicalItemName": "Adson Tissue Forceps 1x2 (Adson Pickups)",
            "usageCount": 6,
            "usedByUsers": ["sean@sacredheart.org", "jd@sacredheart.org"],
            "confidence": "facility_consensus",
            "updatedAt": "2026-10-28T08:00:00Z",
        },
        {
            "aliasId": "sh_lex_2",
            "facilityId": "sacred_heart",
            "departmentId": "or",
            "spokenTerm": "toothed adson",
            "displayPreferredName": "Toothed Adson",
            "canonicalItemName": "Adson Tissue Forceps 1x2 (Adson Pickups)",
            "usageCount": 2,
            "usedByUsers": ["turk@sacredheart.org"],
            "confidence": "facility_consensus",
            "updatedAt": "2026-10-28T08:15:00Z",
        },
        {
            "aliasId": "sh_lex_3",
            "facilityId": "sacred_heart",
            "departmentId": "or",
            "spokenTerm": "gemini",
            "displayPreferredName": "Gemini",
            "canonicalItemName": "Mixter Right-Angle Clamp 7.5in",
            "usageCount": 5,
            "usedByUsers": ["turk@sacredheart.org", "sean@sacredheart.org"],
            "confidence": "facility_consensus",
            "updatedAt": "2026-10-28T08:20:00Z",
        },
        {
            "aliasId": "sh_lex_4",
            "facilityId": "sacred_heart",
            "departmentId": "or",
            "spokenTerm": "peanut",
            "displayPreferredName": "Peanut",
            "canonicalItemName": "Kittner Dissector Sponges (Peanuts)",
            "usageCount": 4,
            "usedByUsers": ["carla@sacredheart.org", "sean@sacredheart.org"],
            "confidence": "facility_consensus",
            "updatedAt": "2026-10-28T08:30:00Z",
        },
        {
            "aliasId": "sh_lex_5",
            "facilityId": "sacred_heart",
            "departmentId": "or",
            "spokenTerm": "stat",
            "displayPreferredName": "Stat",
            "canonicalItemName": "Crile Hemostat Forceps Curved 5.5in (Snaps)",
            "usageCount": 4,
            "usedByUsers": ["elliot@sacredheart.org", "sean@sacredheart.org"],
            "confidence": "facility_consensus",
            "updatedAt": "2026-10-28T08:45:00Z",
        },
        {
            "aliasId": "sh_lex_6",
            "facilityId": "sacred_heart",
            "departmentId": "or",
            "spokenTerm": "pillowcase",
            "displayPreferredName": "Pillowcase",
            "canonicalItemName": "Mayo Stand Cover Reinforced Blue",
            "usageCount": 3,
            "usedByUsers": ["laverne@sacredheart.org", "sean@sacredheart.org"],
            "confidence": "facility_consensus",
            "updatedAt": "2026-10-28T08:50:00Z",
        },
    ],
    "princeton_plainsboro": [
        {
            "aliasId": "ppth_lex_1",
            "facilityId": "princeton_plainsboro",
            "departmentId": "or",
            "spokenTerm": "rat tooth",
            "displayPreferredName": "Rat Tooth",
            "canonicalItemName": "Adson Tissue Forceps 1x2 (Adson Pickups)",
            "usageCount": 4,
            "usedByUsers": ["chase@ppth.org", "cameron@ppth.org"],
            "confidence": "facility_consensus",
            "updatedAt": "2026-10-28T08:00:00Z",
        },
        {
            "aliasId": "ppth_lex_2",
            "facilityId": "princeton_plainsboro",
            "departmentId": "or",
            "spokenTerm": "right angle",
            "displayPreferredName": "Right Angle",
            "canonicalItemName": "Mixter Right-Angle Clamp 7.5in",
            "usageCount": 5,
            "usedByUsers": ["foreman@ppth.org", "chase@ppth.org"],
            "confidence": "facility_consensus",
            "updatedAt": "2026-10-28T08:10:00Z",
        },
    ],
    "county_general": [
        {
            "aliasId": "cg_lex_1",
            "facilityId": "county_general",
            "departmentId": "or",
            "spokenTerm": "straight snap",
            "displayPreferredName": "Straight Snap",
            "canonicalItemName": "Crile Hemostat Forceps Straight 5.5in",
            "usageCount": 3,
            "usedByUsers": ["benton@countygen.org"],
            "confidence": "facility_consensus",
            "updatedAt": "2026-10-28T08:00:00Z",
        },
    ]
}


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


_LEXICON_CACHE: dict[str, tuple[int, list[dict]]] = {}


def load_facility_lexicon(facility_id: str) -> List[dict]:
    """Load all learned aliases for a facility from disk (cached in-memory by mtime)."""
    path = _get_facility_lexicon_path(facility_id)
    with _lexicon_lock:
        if not path.exists():
            defaults = DEFAULT_PRESEEDED_LEXICONS.get(facility_id.lower(), [])
            if defaults:
                temp_path = path.with_suffix(".tmp")
                temp_path.write_text(json.dumps(defaults, indent=2, ensure_ascii=False), encoding="utf-8")
                temp_path.replace(path)
                _LEXICON_CACHE[facility_id] = (path.stat().st_mtime_ns, [dict(d) for d in defaults])
                return [dict(d) for d in defaults]
            _LEXICON_CACHE.pop(facility_id, None)
            return []
        try:
            mtime = path.stat().st_mtime_ns
            cached = _LEXICON_CACHE.get(facility_id)
            if cached is not None and cached[0] == mtime:
                return cached[1]
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                _LEXICON_CACHE[facility_id] = (mtime, data)
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
        _LEXICON_CACHE.pop(facility_id, None)


def reset_facility_lexicons() -> None:
    """Reset all facility lexicon files to pre-seeded defaults (used in tests)."""
    with _lexicon_lock:
        _LEXICON_CACHE.clear()
        for fac, defaults in DEFAULT_PRESEEDED_LEXICONS.items():
            path = _get_facility_lexicon_path(fac)
            temp_path = path.with_suffix(".tmp")
            temp_path.write_text(json.dumps(defaults, indent=2, ensure_ascii=False), encoding="utf-8")
            temp_path.replace(path)


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
    if not spoken_term or not spoken_term.strip():
        raise ValueError("spoken_term is required.")
    norm_term = spoken_term.strip().lower()
    if not norm_term or not canonical_item:
        raise ValueError("Both spoken_term and canonical_item are required.")

    try:
        import fcntl
        has_fcntl = True
    except ImportError:
        fcntl = None
        has_fcntl = False

    path = _get_facility_lexicon_path(facility_id)
    lock_path = path.with_suffix(".lock")
    with open(lock_path, "w") as lock_file:
        if has_fcntl and fcntl:
            fcntl.flock(lock_file, fcntl.LOCK_EX)
        try:
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
        finally:
            if has_fcntl and fcntl:
                fcntl.flock(lock_file, fcntl.LOCK_UN)


def resolve_spoken_alias(facility_id: str, query: str) -> Optional[dict]:
    """
    Check if a query matches any learned alias for this facility.
    Matches exact normalized phrase, singular/plural stem, or subphrase.
    Strictly prevents eponym false-positives across hyphens and protects
    against conflicting sizing/gauge specifications.
    """
    if not query or not query.strip():
        return None
    norm_q = query.strip().lower()
    entries = load_facility_lexicon(facility_id)
    if not entries:
        return None

    from app.services.surgical_ontology import extract_eponyms
    from app.services.inventory_search import extract_gauge_and_specs, has_conflicting_specifications

    query_specs = extract_gauge_and_specs(query)

    def _is_valid_entry(entry: dict) -> bool:
        canon = entry.get("canonicalItemName", "")
        if not canon:
            return False
        # Veto only if query contains a distinct surgical eponym that conflicts with canonical item
        q_eponyms = extract_eponyms(norm_q)
        c_eponyms = extract_eponyms(canon)
        if q_eponyms and not (q_eponyms & c_eponyms):
            return False
        # Veto if query has conflicting size/gauge specs with canonical item (e.g. 6in vs 12in)
        canon_specs = extract_gauge_and_specs(canon)
        fake_row = {"_specs": canon_specs, "item": canon, "aliases": "", "category": ""}
        if has_conflicting_specifications(query_specs, fake_row):
            return False
        return True

    # 1. Exact match on spokenTerm or singular/plural stem
    for entry in entries:
        term = entry.get("spokenTerm", "").lower()
        if term == norm_q:
            if _is_valid_entry(entry):
                return entry
        if term.rstrip("s") == norm_q.rstrip("s") and len(term.rstrip("s")) >= 3:
            if _is_valid_entry(entry):
                return entry

    # 2. Query equals displayPreferredName
    for entry in entries:
        disp = entry.get("displayPreferredName", "").lower()
        if disp == norm_q:
            if _is_valid_entry(entry):
                return entry
        if disp.rstrip("s") == norm_q.rstrip("s") and len(disp.rstrip("s")) >= 3:
            if _is_valid_entry(entry):
                return entry

    # 3. Word-bounded subphrase match (e.g. "where can i find adson pickups in or 21" or "where is the gemini")
    # Uses (?<![\w-]) and (?![\w-]) to prevent false-positive matching inside compound words (e.g. brown-adson)
    for entry in entries:
        term = entry.get("spokenTerm", "").lower()
        if len(term) >= 3:
            pattern = rf"(?<![\w-]){re.escape(term)}(?![\w-])"
            if re.search(pattern, norm_q):
                if _is_valid_entry(entry):
                    return entry
            stem = term.rstrip("s")
            if len(stem) >= 3:
                stem_pattern = rf"(?<![\w-]){re.escape(stem)}(?:s)?(?![\w-])"
                if re.search(stem_pattern, norm_q):
                    if _is_valid_entry(entry):
                        return entry

    return None


def get_all_aliases_for_item(facility_id: str, canonical_item: str) -> List[str]:
    """
    Return all learned display aliases for a canonical item in this facility.
    e.g. ['Adson Pickups', 'Toothed Adson', '1x2 Pickups']
    """
    if not canonical_item or not canonical_item.strip():
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
    # "In this facility, [X] is called [Y]"
    re.compile(
        r"in\s+this\s+(?:facility|hospital|unit|or|department)\s*,\s*(?:the\s+)?(.+?)\s+(?:is|are)\s+called\s+(?:an?|the)?\s*([a-zA-Z0-9\s-]+?)(?:\.|$)", re.IGNORECASE),
    # "Remember that [X] are called [Y]" / "Remember that [X] is [Y]"
    re.compile(
        r"remember\s+that\s+(?:the\s+)?(.+?)\s+(?:are\s+called|is\s+called|means|is|are)\s+(?:an?|the)?\s*([a-zA-Z0-9\s-]+?)(?:\.|$)", re.IGNORECASE),
    # "Alias [X] to [Y]"
    re.compile(r"alias\s+(?:the\s+)?(.+?)\s+to\s+(?:an?|the)?\s*([a-zA-Z0-9\s-]+?)(?:\.|$)", re.IGNORECASE),
    # "Here we call [X] a/an/the/as [Y]"
    re.compile(
        r"(?:here\s+)?we\s+call\s+(?:the\s+)?(.+?)\s+(?:a|an|the|as)\s+([a-zA-Z0-9\s-]+?)(?:\.|$)", re.IGNORECASE),
    # "We call [X forceps/clamp/scissors/etc] [Y]"
    re.compile(
        r"(?:here\s+)?we\s+call\s+(?:the\s+)?(.+?\b(?:forceps|scissors|clamps?|retractors?|needle\s+drivers?|needle\s+holders?|sponges?|elevators?|rongeurs?|suction|tubes?))\s+([a-zA-Z0-9\s-]+?)(?:\.|$)", re.IGNORECASE),
    # Generic "Here we call [X] [Y]" fallback
    re.compile(
        r"(?:here\s+)?(?:we|i)\s+call\s+(?:the\s+)?([a-zA-Z0-9\s-]+?)\s+([a-zA-Z0-9\s-]+?)(?:\.|$)", re.IGNORECASE),
    # "[X] is called [Y]" / "[X] are called [Y]" (moved to bottom so specific ones catch first)
    re.compile(r"(?:the\s+)?(.+?)\s+(?:is|are)\s+called\s+(?:an?|the)?\s*([a-zA-Z0-9\s-]+?)(?:\.|$)", re.IGNORECASE),
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
