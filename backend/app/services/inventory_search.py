"""
OR-Nav Tier 1 Local CSV Inventory Search & Crowdsourced Move Engine.
Upgraded in Phase 9 (v1.0 Hardened MVP) with:
    - OR Homophone Map + Double Metaphone phonetic hashing (`normalize_and_hash`)
    - 3-Stage Deterministic Cascade (<15ms, $0 LLM cost):
        Stage A: Exact normalized match
        Stage B: Double Metaphone phonetic_code match
        Stage C: RapidFuzz token_set_ratio / WRatio >= 82
    - Layer 3 Implicit Behavioral Verification (+0.5 per unflagged lookup -> auto-verified at 3.0)
    - Explicit Flag Wrong (`flag_wrong` -> drops score to 0.5, status = 'needs_reverification')
"""

import csv
import io
import os
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from metaphone import doublemetaphone
from rapidfuzz import fuzz

from app.config import TenantConfig
from app.services.surgical_ontology import (
    is_eponym_conflict,
    is_generic_class_only,
    normalize_or_lingo,
    extract_eponyms,
)
from app.services.lexicon_learning import (
    get_facility_id_from_tenant,
    resolve_spoken_alias,
    get_all_aliases_for_item,
    learn_alias,
    title_case_term,
)


# Minimum similarity score (0-100) to accept a Stage C fuzzy match in Tier 1.
_SIMILARITY_THRESHOLD = 82.0

# OR-Specific Homophone & Slang Normalization Dictionary
OR_HOMOPHONE_MAP: dict[str, str] = {
    "the bakery": "debakey",
    "de bakery": "debakey",
    "da bakery": "debakey",
    "bakery": "debakey",
    "debakeys": "debakey",
    "pro lean": "prolene",
    "pro-lean": "prolene",
    "proline": "prolene",
    "tie cron": "ti-cron",
    "tye cron": "ti-cron",
    "ticron": "ti-cron",
    "four oh": "4-0",
    "four-oh": "4-0",
    "four zero": "4-0",
    "four dash zero": "4-0",
    "three oh": "3-0",
    "three-oh": "3-0",
    "three zero": "3-0",
    "three dash zero": "3-0",
    "two oh": "2-0",
    "two-oh": "2-0",
    "two zero": "2-0",
    "two dash zero": "2-0",
    "five oh": "5-0",
    "five-oh": "5-0",
    "six oh": "6-0",
    "six-oh": "6-0",
    "seven oh": "7-0",
    "seven-oh": "7-0",
    "thirty silk": "3-0 silk",
    "30 silk": "3-0 silk",
    "twenty prolene": "2-0 prolene",
    "20 prolene": "2-0 prolene",
    "forty prolene": "4-0 prolene",
    "40 prolene": "4-0 prolene",
    "seventy prolene": "7-0 prolene",
    "70 prolene": "7-0 prolene",
    "white laner": "weitlaner",
    "white liner": "weitlaner",
    "white lainer": "weitlaner",
    "bovey": "bovie",
    "bo vie": "bovie",
    "heprin": "heparin",
}

_STOP_WORDS = {
    "where", "is", "are", "the", "a", "an", "find", "locate", "need",
    "get", "me", "do", "we", "have", "keep", "stored", "stocked",
    "show", "location", "of", "for", "in", "from", "please", "can",
    "you", "tell", "whats", "what",
}

# Conversational prefixes to strip before matching against item names/aliases.
_QUERY_PREFIXES = re.compile(
    r"^(?:"
    r"where\s+(?:is|are|can\s+i\s+find|do\s+we\s+keep)\s+(?:the\s+|a\s+|an\s+)?|"
    r"(?:can\s+you\s+)?(?:find|locate|get|grab|show)\s+(?:me\s+)?(?:the\s+|a\s+|an\s+)?|"
    r"(?:i\s+)?(?:need|want|looking\s+for)\s+(?:the\s+|a\s+|an\s+)?|"
    r"do\s+we\s+have\s+(?:any\s+|a\s+|an\s+)?|"
    r"what\s+is\s+the\s+location\s+of\s+(?:the\s+)?|"
    r"location\s+(?:of|for)\s+(?:the\s+)?"
    r")+",
    re.IGNORECASE,
)

# Keywords indicating a complex procedural / protocol / surgeon-preference query
_PROCEDURAL_INDICATORS = re.compile(
    r"\b(?:"
    r"how\s+(?:do|to|much|many)|"
    r"what\s+(?:is|are)\s+the\s+(?:protocol|dose|dosing|target|steps|procedure|ratio|settings|preference|checklist|prep|positioning)|"
    r"what\s+(?:sutures?|blades?|instruments?|cannula|wires?|size)\s+does\s+(?:dr\.?|doctor)|"
    r"(?:dr\.?|doctor)\s+[a-z]+(?:'s)?\s+(?:prefer|preference|protocol|like|use|want)|"
    r"prefer(?:s|ence|ences)?|"
    r"protocol|guideline|policy|checklist|orient(?:ation)?|"
    r"mayo\s+stand|tray\s+(?:breakdown|setup)|instrument\s+setup|suture\s+loading|"
    r"activate\s+mtp|massive\s+transfusion|"
    r"malignant\s+hyperthermia|dantrolene\s+(?:dose|dosing|protocol|mixing|reconstitution)|"
    r"heparin\s+(?:dose|dosing|target|act|protocol)|"
    r"protamine\s+(?:dose|dosing|protocol|ratio|reversal)|"
    r"act\s+target|target\s+act|"
    r"bypass\s+readiness|crash[\s-]on|"
    r"pneumatic\s+tube|tube\s+(?:.*?\s+)?station|tube\s+blood|tube\s+specimen|can\s+i\s+tube|blood\s+gas|"
    r"when\s+(?:to|should)|why\s+(?:do|is)|explain|describe|"
    r"cranial\s+nerve|carotid\s+endarterectomy|cabg\s+prep|bladder\s+decompression"
    r")\b",
    re.IGNORECASE,
)

# Natural language move reporting pattern
_MOVE_PATTERN = re.compile(
    r"^(?:the\s+)?(?P<item>.+?)\s+"
    r"(?:was\s+moved|moved|relocated|is\s+now\s+at|is\s+now\s+in)\s+"
    r"(?:to\s+)?"
    r"(?P<location>(?:(?:OR|room|bay|pod|trauma\s+bay|trauma|icu|er|ed|pacu)\b|Core\s+Supply|Pump\s+Room).+?)\s*\.?$",
    re.IGNORECASE,
)

_SPOKEN_NUMBER_WORDS = [
    ("twenty one", "21"),
    ("twenty-one", "21"),
    ("twenty two", "22"),
    ("twenty-two", "22"),
    ("twenty three", "23"),
    ("twenty-three", "23"),
    ("twenty four", "24"),
    ("twenty-four", "24"),
    ("twenty five", "25"),
    ("twenty-five", "25"),
    ("twenty", "20"),
    ("nineteen", "19"),
    ("eighteen", "18"),
    ("seventeen", "17"),
    ("sixteen", "16"),
    ("fifteen", "15"),
    ("fourteen", "14"),
    ("thirteen", "13"),
    ("twelve", "12"),
    ("eleven", "11"),
    ("ten", "10"),
    ("nine", "9"),
    ("eight", "8"),
    ("seven", "7"),
    ("six", "6"),
    ("five", "5"),
    ("four", "4"),
    ("three", "3"),
    ("two", "2"),
    ("one", "1"),
    ("zero", "0"),
]

_SPOKEN_LETTER_WORDS = [
    (r"\b(?:eh|ay|aye)\b", "a"),
    (r"\b(?:bee|be)\b", "b"),
    (r"\b(?:see|sea)\b", "c"),
    (r"\b(?:dee)\b", "d"),
    (r"\b(?:ee)\b", "e"),
    (r"\b(?:ef)\b", "f"),
    (r"\b(?:gee)\b", "g"),
    (r"\b(?:aitch)\b", "h"),
    (r"\b(?:jay)\b", "j"),
    (r"\b(?:kay)\b", "k"),
    (r"\b(?:el)\b", "l"),
    (r"\b(?:em)\b", "m"),
    (r"\b(?:en)\b", "n"),
    (r"\b(?:oh)\b", "o"),
    (r"\b(?:pee)\b", "p"),
    (r"\b(?:cue)\b", "q"),
    (r"\b(?:ar)\b", "r"),
    (r"\b(?:ess)\b", "s"),
    (r"\b(?:tee)\b", "t"),
    (r"\b(?:you)\b", "u"),
    (r"\b(?:vee)\b", "v"),
    (r"\b(?:double\s+you)\b", "w"),
    (r"\b(?:ex)\b", "x"),
    (r"\b(?:why)\b", "y"),
    (r"\b(?:zee|zed)\b", "z"),
]


def _format_room_canonical(unit: Optional[str], num: Optional[str], core: Optional[str], pump: Optional[str]) -> str:
    if core:
        return "Core Supply"
    if pump:
        return "Pump Room"
    u = (unit or "").lower().strip()
    if u in ("or", "room"):
        return f"OR {num}" if num else "OR"
    elif u in ("trauma bay", "trauma"):
        return f"Trauma Bay {num}" if num else "Trauma"
    elif u == "bay":
        return f"Bay {num}" if num else "Bay"
    elif "icu" in u:
        return f"ICU {num}" if num else ("ICU Supply" if "supply" in u else "ICU")
    elif u in ("er", "ed"):
        return f"ER {num}" if num else "ER"
    elif "pacu" in u:
        return f"PACU {num}" if num else ("PACU Med Room" if "med" in u else "PACU")
    elif u == "pod":
        return f"Pod {num}" if num else "Pod"
    return u.title()


def normalize_location_coordinate(loc_raw: str) -> Optional[str]:
    """
    Parse and canonicalize natural voice, spoken words, or lowercase location into uppercase 4-part coordinate:
      'or 21 b 1 a' -> 'OR 21 B 1 A'
      'the 3-0 silk moved to or twenty one bee two see' -> 'OR 21 B 2 C'
      'room twenty one cab dee shelf three bin eh' -> 'OR 21 D 3 A'
      'or 21 be 1 sea' -> 'OR 21 B 1 C'
      'core supply d 1 a' -> 'Core Supply D 1 A'
      'pump room h 2 a' -> 'Pump Room H 2 A'
      'The EZ-IO needles moved to Bay 2 Cart A Shelf 1 Bin B' -> 'Bay 2 A 1 B'
      'bay 2 a 1 b' -> 'Bay 2 A 1 B'
      'icu a 2 b' -> 'ICU A 2 B'
    """
    text = (loc_raw or "").strip().rstrip(".")
    if not text:
        return None

    # Pre-normalize spoken numbers (e.g. "twenty one" -> "21", "two" -> "2")
    for word, digit in _SPOKEN_NUMBER_WORDS:
        text = re.sub(rf"\b{word}\b", digit, text, flags=re.IGNORECASE)

    # Pre-normalize spoken letter homophones (e.g. "bee" -> "b", "see" -> "c", "eh" -> "a")
    for pattern, letter in _SPOKEN_LETTER_WORDS:
        text = re.sub(pattern, letter, text, flags=re.IGNORECASE)

    # Natural phrasing with words (e.g. room 21 cabinet b shelf 1 bin a, Bay 2 Cart A Shelf 1 Bin B)
    nat = re.search(
        r"(?:(trauma\s+bay|trauma|bay|pod|icu(?:\s+supply)?|er|ed|pacu(?:\s+med\s+room)?|or|room)(?:\s*(\d+))?|(core\s+supply)|(pump\s+room))\s*"
        r"(?:cart|cabinet|cab|rack|pyxis|alcove)?\s*([a-zA-Z])\s*"
        r"(?:shelf|drawer)?\s*(\d+)\s*"
        r"(?:bin|container)?\s*([a-zA-Z])",
        text,
        re.IGNORECASE,
    )
    if nat:
        u, num, core, pump, cab, shelf, bin_letter = nat.groups()
        room = _format_room_canonical(u, num, core, pump)
        return f"{room} {cab.upper()} {shelf} {bin_letter.upper()}"

    # Standard format: (OR 21|Core Supply|Pump Room|Bay 2|ICU) B 1 A
    std = re.search(
        r"(?:(trauma\s+bay|trauma|bay|pod|icu(?:\s+supply)?|er|ed|pacu(?:\s+med\s+room)?|or|room)(?:\s*(\d+))?|(core\s+supply)|(pump\s+room))\s+"
        r"([a-zA-Z])\s+(\d+)\s+([a-zA-Z])",
        text,
        re.IGNORECASE,
    )
    if std:
        u, num, core, pump, cab, shelf, bin_letter = std.groups()
        room = _format_room_canonical(u, num, core, pump)
        return f"{room} {cab.upper()} {shelf} {bin_letter.upper()}"

    return None


_CORRECTION_PIVOTS = re.compile(
    r"\b(?:"
    r"wait\s+no|no\s+wait|"
    r"sorry\s+(?:i\s+)?meant?|"
    r"i\s+mean|"
    r"actually\s+no|no\s+actually|"
    r"scratch\s+that|"
    r"make\s+that|"
    r"correction|"
    r"no\s+i\s+need"
    r")\b[\s,:-]*",
    re.IGNORECASE,
)

_TRAILING_NEGATION = re.compile(
    r"\b(?:not|instead\s+of|rather\s+than)\s+[^,;]+$",
    re.IGNORECASE,
)


def preprocess_voice_query(query: str) -> str:
    """
    Handle clinical mid-sentence voice self-corrections and trailing negations:
      - 'Where is 3-0 silk wait no 4-0 prolene' -> '4-0 prolene'
      - 'Find 2-0 prolene sorry I meant 3-0 silk' -> '3-0 silk'
      - 'Where is 4-0 prolene not 3-0' -> 'Where is 4-0 prolene'
      - 'Find 3-0 silk instead of 2-0' -> 'Find 3-0 silk'
    """
    text = (query or "").strip()
    if not text:
        return ""

    splits = _CORRECTION_PIVOTS.split(text)
    if len(splits) > 1:
        corrected = splits[-1].strip()
        if corrected:
            text = corrected

    text = _TRAILING_NEGATION.sub("", text).strip()
    return text


_BARE_SIZE_REGEX = re.compile(
    r"^(?:#?\d+[-/](?:0|zero|oh)|#?\d{2}|\d+(?:\.\d+)?\s*(?:fr|french|in|mm|gauge|g)|(?:0|zero|aught))$",
    re.IGNORECASE,
)

_PROTECTED_MEDICAL_ACRONYMS = re.compile(
    r"\b(?:i\s*&\s*d|d\s*&\s*c|t\s*&\s*c)\b",
    re.IGNORECASE,
)


def split_compound_query(query: str) -> list[str]:
    """
    Split compound queries on 'and', 'plus', '&' with spaces, or commas,
    preserving medical abbreviations (I&D, D&C) and resolving elliptical shared-noun
    constructions (e.g., 'where is 2-0 and 3-0 prolene' -> ['2-0 prolene', '3-0 prolene']).
    """
    text = preprocess_voice_query(query).strip()
    if not text:
        return []

    if _PROTECTED_MEDICAL_ACRONYMS.search(text) and not re.search(r"\s+(?:and|plus)\s+", text, re.IGNORECASE):
        return [text]

    raw_chunks = re.split(r"\s+(?:and|&|plus)\s+|,\s*", text)
    chunks = [c.strip() for c in raw_chunks if c.strip()]
    if len(chunks) <= 1:
        return [text]

    cleaned_chunks: list[str] = []
    for c in chunks:
        c_clean = re.sub(
            r"^(?:where\s+(?:is|are)|find|locate|need|grab|show)\s+(?:the\s+|a\s+|an\s+)?",
            "",
            c,
            flags=re.IGNORECASE,
        ).strip().rstrip("?!.,;:").strip()
        cleaned_chunks.append(c_clean if c_clean else c.rstrip("?!.,;:").strip())

    # Backward pass: chunk i inherits noun from chunk i+1
    for i in range(len(cleaned_chunks) - 2, -1, -1):
        c_curr = cleaned_chunks[i]
        c_next = cleaned_chunks[i + 1]
        if _BARE_SIZE_REGEX.match(c_curr):
            noun_match = re.search(
                r"^(?:#?\d+[-/](?:0|zero|oh)|#?\d{2}|\d+\s*(?:fr|french|in|mm|gauge|g))\s+(.+)$",
                c_next,
                re.IGNORECASE,
            )
            noun_part = noun_match.group(1).strip() if noun_match else ""
            if not noun_part and not _BARE_SIZE_REGEX.match(c_next):
                noun_part = c_next
            if noun_part:
                cleaned_chunks[i] = f"{c_curr} {noun_part}"

    # Forward pass: chunk i inherits noun from chunk i-1
    for i in range(1, len(cleaned_chunks)):
        c_curr = cleaned_chunks[i]
        c_prev = cleaned_chunks[i - 1]
        if _BARE_SIZE_REGEX.match(c_curr):
            noun_match = re.search(
                r"^(?:#?\d+[-/](?:0|zero|oh)|#?\d{2}|\d+\s*(?:fr|french|in|mm|gauge|g))\s+(.+)$",
                c_prev,
                re.IGNORECASE,
            )
            noun_part = noun_match.group(1).strip() if noun_match else ""
            if noun_part:
                cleaned_chunks[i] = f"{c_curr} {noun_part}"

    return cleaned_chunks


def normalize_and_hash(query: str) -> tuple[str, str]:
    """
    Normalize a clinical item query using OR_HOMOPHONE_MAP and compute its
    Double Metaphone phonetic signature.

    Returns:
        (normalized_text, phonetic_code)
    """
    text = query.lower().strip()
    text = re.sub(r"\[redacted_phi\]", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"[?!.,;:\"'()\[\]]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()

    # Apply multi-word and single-word homophone substitutions (longest keys first)
    for src, target in sorted(OR_HOMOPHONE_MAP.items(), key=lambda kv: len(kv[0]), reverse=True):
        pattern = re.compile(r"(?<!\w)" + re.escape(src) + r"(?!\w)", re.IGNORECASE)
        text = pattern.sub(target, text)

    # Filter out conversational stop-words while keeping clinical/numeric tokens
    raw_tokens = text.split()
    kept_tokens = [t for t in raw_tokens if t not in _STOP_WORDS]
    if not kept_tokens:
        kept_tokens = raw_tokens

    normalized_text = " ".join(kept_tokens).strip()

    # Compute Double Metaphone code per token
    phonetic_parts: list[str] = []
    for tok in kept_tokens:
        # Preserve size/numeric tokens like 3-0, 4-0, 10, 12in, 32fr
        if re.match(r"^\d+(?:-\d+)?$", tok):
            phonetic_parts.append(tok)
            continue
        num_prefix = re.match(r"^#?(\d+)(?:fr|in|mm)?$", tok)
        if num_prefix:
            phonetic_parts.append(num_prefix.group(1))
            continue

        # Strip hyphens for phonetic hashing (e.g. ti-cron -> ticron -> TKRN)
        clean_alpha = re.sub(r"[^a-z]", "", tok)
        if clean_alpha:
            primary, _ = doublemetaphone(clean_alpha)
            if primary:
                phonetic_parts.append(primary)

    phonetic_code = " ".join(phonetic_parts).strip()
    return normalized_text, phonetic_code


SUTURE_MATERIALS = {
    "silk", "prolene", "vicryl", "monocryl", "ethibond",
    "ti-cron", "ticron", "pds", "nylon", "chromic", "gut",
}

# Surgical Needle Codes (Ethicon & Covidien)
NEEDLE_CODES = {
    "rb-1", "rb-2", "sh", "sh-1", "ct-1", "ct-2", "ctx", "bv-1",
    "bv-100", "c-1", "v-5", "v-7", "da", "ps-2", "ur-6", "ks",
    "tf", "bb", "mo-6", "cp-1", "tp-1",
}


def extract_gauge_and_specs(text: str) -> dict:
    """
    Extract clinical sizing & material specifications from query or inventory text:
      - suture_gauges: e.g. {'2-0', '3-0', '4-0', '5-0', '7-0', '0'}
      - suture_materials: e.g. {'silk', 'prolene', 'ti-cron'}
      - needle_codes: e.g. {'rb-1', 'sh', 'ctx'}
      - french_sizes: e.g. {'18fr', '24fr', '32fr'}
      - gauge_sizes: e.g. {'18g', '20g', '22g'}
      - mm_sizes: e.g. {'18mm', '25mm', '2.0mm'}
      - blade_numbers: e.g. {'10', '11', '12', '15'}
      - lengths: e.g. {'12in', '8in'}
    """
    lowered = text.lower()
    # Normalize hyphens/slashes for suture gauges
    raw_gauges = set(re.findall(r"\b\d+[-/](?:0|zero|oh)\b", lowered))
    gauges = {g.replace("/", "-") for g in raw_gauges}

    # Zero-suture detection: "0 silk", "zero silk", "aught silk", "0 vicryl", "0 prolene", etc.
    # Must NOT match "3-0 silk", "2-0 silk", etc. (negative lookbehind for digits, hyphens, slashes)
    zero_suture_match = re.search(
        r"(?<![\d\-/])\b(?:size\s+)?(?:0|zero|aught)\s*(?:silk|prolene|vicryl|ti-cron|ticron|monocryl|pds|ethibond|nylon|chromic|plain|suture|ties?)\b"
        r"|\b(?:silk|prolene|vicryl|ti-cron|ticron|monocryl|pds|ethibond|nylon|chromic)\s+(?:size\s+)?(?:0|zero|aught)\b"
        r"|(?<![\d\-/])\b(?:#0|0\s+suture|aught\s+suture)\b",
        lowered,
    )
    if zero_suture_match:
        gauges.add("0")

    # Suture materials
    materials = {m for m in SUTURE_MATERIALS if re.search(r"\b" + re.escape(m) + r"\b", lowered)}

    # Needle codes (e.g. RB-1, SH, CT-1)
    needle_matches = re.findall(
        r"\b(rb-1|rb-2|sh-1|sh|ct-1|ct-2|ctx|bv-100|bv-1|c-1|v-5|v-7|da|ps-2|ur-6|ks|tf|bb|mo-6|cp-1|tp-1)\b",
        lowered,
    )
    needle_codes = set(needle_matches)

    # French sizes (e.g. 18fr, 32 french)
    fr_matches = re.findall(r"\b(\d+)\s*(?:fr|french)\b", lowered)
    french_sizes = {f"{f}fr" for f in fr_matches}

    # Gauge sizes (e.g. 18g, 18 gauge, 20g)
    g_matches = re.findall(r"\b(\d+)\s*(?:g|ga|gauge)\b", lowered)
    gauge_sizes = {f"{g}g" for g in g_matches}

    # Millimeter sizes (e.g. 18mm, 25mm, 2.0mm, 1.5mm)
    mm_matches = re.findall(r"\b(\d+(?:\.\d+)?)\s*mm\b", lowered)
    mm_sizes = {f"{m}mm" for m in mm_matches}

    # Blade numbers (e.g. #10, #11, #15, 10 blade, 11 blade)
    blade_matches = re.findall(r"\b(?:#|\bblade\s*)(\d{2})\b|\b(\d{2})\s*blade\b", lowered)
    blade_numbers = set()
    for b1, b2 in blade_matches:
        b = b1 or b2
        if b in ("10", "11", "12", "15", "20"):
            blade_numbers.add(b)

    # Lengths (e.g. 12in, 8in, 12 inch)
    len_matches = re.findall(r"\b(\d+)\s*(?:in|inch|inches)\b", lowered)
    lengths = {f"{l}in" for l in len_matches}

    return {
        "suture_gauges": gauges,
        "suture_materials": materials,
        "needle_codes": needle_codes,
        "french_sizes": french_sizes,
        "gauge_sizes": gauge_sizes,
        "mm_sizes": mm_sizes,
        "blade_numbers": blade_numbers,
        "lengths": lengths,
    }


def has_conflicting_specifications(query_specs: dict, row: dict) -> bool:
    """
    Return True if the query explicitly specifies a gauge, size, or material
    that conflicts with the inventory row.
    """
    row_specs = row.get("_specs")
    if not row_specs:
        row_specs = extract_gauge_and_specs(
            f"{row.get('item', '')} {row.get('aliases', '')} {row.get('surgeon_notes', '')}"
        )

    # 1. Suture Gauge Guard
    q_gauges = query_specs.get("suture_gauges", set())
    r_gauges = row_specs.get("suture_gauges", set())
    if q_gauges:
        if r_gauges and not (q_gauges & r_gauges):
            return True
        # If query asks for a suture gauge (e.g. 5-0 or 0) and row is in 'Sutures' but lacks this gauge
        if row.get("category", "").lower() == "sutures" and not (q_gauges & r_gauges):
            return True

    # 2. Suture Material Guard (e.g. silk vs prolene vs ti-cron)
    q_mats = query_specs.get("suture_materials", set())
    r_mats = row_specs.get("suture_materials", set())
    if q_mats and r_mats and not (q_mats & r_mats):
        return True

    # 3. Needle Code Guard (e.g. RB-1 vs SH)
    q_needles = query_specs.get("needle_codes", set())
    r_needles = row_specs.get("needle_codes", set())
    if q_needles and r_needles and not (q_needles & r_needles):
        return True

    # 4. French Size Guard (e.g. 18Fr vs 32Fr)
    q_fr = query_specs.get("french_sizes", set())
    r_fr = row_specs.get("french_sizes", set())
    if q_fr and r_fr and not (q_fr & r_fr):
        return True

    # 5. Gauge Size Guard (e.g. 18g vs 20g)
    q_gauges_num = query_specs.get("gauge_sizes", set())
    r_gauges_num = row_specs.get("gauge_sizes", set())
    if q_gauges_num and r_gauges_num and not (q_gauges_num & r_gauges_num):
        return True

    # 6. Suture vs Millimeter Metric Guard (Vector A: 2.0mm shunt/tip vs 2-0 suture)
    q_mm = query_specs.get("mm_sizes", set())
    r_mm = row_specs.get("mm_sizes", set())
    if q_mm and (row.get("category", "").lower() == "sutures" or r_gauges):
        return True
    if q_gauges and (r_mm and not r_gauges):
        return True

    # 7. Millimeter Size Guard (e.g. 2.0mm vs 2.5mm vs 18mm vs 25mm)
    if q_mm and r_mm and not (q_mm & r_mm):
        return True

    # 8. Cross-Unit Collisions (18g vs 18Fr vs 18in vs 18mm)
    q_all_units = {
        ("g", x[:-1]) for x in q_gauges_num
    } | {
        ("fr", x[:-2]) for x in q_fr
    } | {
        ("in", x[:-2]) for x in query_specs.get("lengths", set())
    } | {
        ("mm", x[:-2]) for x in q_mm
    }

    r_all_units = {
        ("g", x[:-1]) for x in r_gauges_num
    } | {
        ("fr", x[:-2]) for x in r_fr
    } | {
        ("in", x[:-2]) for x in row_specs.get("lengths", set())
    } | {
        ("mm", x[:-2]) for x in r_mm
    }

    for q_unit, q_val in q_all_units:
        for r_unit, r_val in r_all_units:
            if q_val == r_val and q_unit != r_unit:
                return True

    # 9. Blade Number Guard (e.g. #10 vs #11 vs #15)
    q_blades = query_specs.get("blade_numbers", set())
    r_blades = row_specs.get("blade_numbers", set())
    if q_blades and r_blades and not (q_blades & r_blades):
        return True

    # 10. Length Guard (e.g. 8in vs 12in)
    q_lens = query_specs.get("lengths", set())
    r_lens = row_specs.get("lengths", set())
    if q_lens and r_lens and not (q_lens & r_lens):
        return True

    return False


def sanitize_csv_cell(val: str) -> str:
    """
    Neutralize spreadsheet formula injection triggers (=, @, +, -, tab, cr).
    Preserves idempotent round-trip integrity: never double-escapes strings
    that already start with a protective single-quote, and avoids escaping
    standard clinical notes starting with bullets/hyphens or temperatures (e.g. '- Use on redo').
    """
    s = str(val or "")
    if not s:
        return s
    # Idempotence: if already escaped, do not accumulate additional quotes
    if s.startswith("'"):
        return s
    # 1. Direct formula triggers (=, @, tab, cr)
    if s[0] in ("=", "@", "\t", "\r"):
        return f"'{s}"
    # 2. Leading '+' or '-' only escaped if followed by a formula function, command, or arithmetic expression
    if s[0] in ("+", "-"):
        if re.match(r"^[+-](?:[a-zA-Z_@=]|\d+[+\-*/])", s):
            return f"'{s}"
    return s


def unescape_csv_cell(val: str) -> str:
    """Remove leading formula escaping single-quote if present."""
    s = str(val or "")
    if s.startswith("'") and len(s) > 1 and s[1] in ("=", "+", "-", "@", "\t", "\r"):
        return s[1:]
    return s


class AttrDict(dict):
    """Dict subclass supporting both dict['key'] and dict.key access for backwards compatibility."""
    def __getattr__(self, key: str):
        try:
            return self[key]
        except KeyError:
            raise AttributeError(f"'AttrDict' object has no attribute '{key}'")


class InventoryService:
    """
    Thread-safe in-memory CSV inventory manager for a single hospital tenant.
    """

    CSV_FIELDNAMES = [
        "item",
        "category",
        "room",
        "cabinet",
        "shelf",
        "container",
        "aliases",
        "pending_location",
        "verify_count",
        "surgeon_notes",
        "human_alias",
        "verification_score",
        "status",
        "last_verified_at",
    ]

    REQUIRED_INGEST_COLUMNS = {"item", "room", "cabinet", "shelf", "container"}

    def __init__(self, tenant: Union[TenantConfig, str], cooldown_seconds: float = 0.0):
        if isinstance(tenant, str):
            from app.config import get_tenant
            tenant = get_tenant(tenant)
        self.tenant = tenant
        self.cooldown_seconds = cooldown_seconds
        self._lock = threading.RLock()
        self._rows: list[dict] = []
        self._load_csv()

    # -------------------------------------------------------------------
    # CSV I/O
    # -------------------------------------------------------------------

    def _enrich_row(self, row: dict) -> dict:
        """Populate default governance fields, pre-compute phonetic hashes, and sizing specs."""
        room = unescape_csv_cell((row.get("room") or "").strip())
        cabinet = unescape_csv_cell((row.get("cabinet") or "").strip())
        shelf = unescape_csv_cell((row.get("shelf") or "").strip())
        container = unescape_csv_cell((row.get("container") or "").strip())

        human_alias = unescape_csv_cell((row.get("human_alias") or "").strip())
        if not human_alias:
            human_alias = f"{room} · Cart {cabinet} · Shelf {shelf} · Bin {container}"

        try:
            verification_score = float(row.get("verification_score") or 3.0)
        except (ValueError, TypeError):
            verification_score = 3.0

        status = unescape_csv_cell((row.get("status") or "").strip())
        if status not in ("verified", "provisional", "needs_reverification"):
            status = "verified" if verification_score >= 3.0 else "provisional"

        last_verified_at = unescape_csv_cell((row.get("last_verified_at") or "").strip())
        if not last_verified_at:
            last_verified_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        item_name = unescape_csv_cell((row.get("item") or "").strip())
        aliases_raw = unescape_csv_cell((row.get("aliases") or "").strip())
        alias_list = [a.strip() for a in aliases_raw.split("|") if a.strip()]

        norm_item, phon_item = normalize_and_hash(item_name)
        norm_aliases: list[str] = []
        phon_aliases: list[str] = []
        for alias in alias_list:
            na, pa = normalize_and_hash(alias)
            if na:
                norm_aliases.append(na)
            if pa:
                phon_aliases.append(pa)

        specs = extract_gauge_and_specs(f"{item_name} {aliases_raw} {(row.get('surgeon_notes') or '')}")

        return {
            "item": item_name,
            "category": unescape_csv_cell((row.get("category") or "").strip()),
            "room": room,
            "cabinet": cabinet,
            "shelf": shelf,
            "container": container,
            "aliases": aliases_raw,
            "pending_location": unescape_csv_cell((row.get("pending_location") or "").strip()),
            "verify_count": int(row.get("verify_count") or 0),
            "surgeon_notes": unescape_csv_cell((row.get("surgeon_notes") or "").strip()),
            "human_alias": human_alias,
            "verification_score": verification_score,
            "status": status,
            "last_verified_at": last_verified_at,
            "normalized_name": norm_item,
            "phonetic_code": phon_item,
            "_norm_aliases": norm_aliases,
            "_phon_aliases": phon_aliases,
            "_specs": specs,
        }

    def _load_csv(self) -> None:
        """Load inventory.csv into memory with pre-computed phonetic indices."""
        path = self.tenant.inventory_path
        if not path.exists():
            self._rows = []
            return

        with path.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            rows = [self._enrich_row(row) for row in reader if any(v.strip() for v in row.values() if v)]

        self._rows = rows

    def _save_csv(self) -> None:
        """Persist in-memory inventory rows atomically back to inventory.csv with formula sanitization."""
        path = self.tenant.inventory_path
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_name(f".{path.name}.tmp.{uuid.uuid4().hex}")
        try:
            with tmp_path.open("w", encoding="utf-8", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=self.CSV_FIELDNAMES)
                writer.writeheader()
                for row in self._rows:
                    writer.writerow({
                        "item": sanitize_csv_cell(row["item"]),
                        "category": sanitize_csv_cell(row["category"]),
                        "room": sanitize_csv_cell(row["room"]),
                        "cabinet": sanitize_csv_cell(row["cabinet"]),
                        "shelf": sanitize_csv_cell(row["shelf"]),
                        "container": sanitize_csv_cell(row["container"]),
                        "aliases": sanitize_csv_cell(row["aliases"]),
                        "pending_location": sanitize_csv_cell(row["pending_location"]),
                        "verify_count": str(row["verify_count"]),
                        "surgeon_notes": sanitize_csv_cell(row["surgeon_notes"]),
                        "human_alias": sanitize_csv_cell(row["human_alias"]),
                        "verification_score": f"{float(row['verification_score']):.1f}",
                        "status": sanitize_csv_cell(row["status"]),
                        "last_verified_at": sanitize_csv_cell(row["last_verified_at"]),
                    })
                f.flush()
                os.fsync(f.fileno())

            for attempt in range(5):
                try:
                    os.replace(tmp_path, path)
                    break
                except PermissionError:
                    if attempt == 4:
                        raise
                    time.sleep(0.01 * (attempt + 1))
        finally:
            if tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    pass

    def reload(self) -> None:
        """Reload CSV from disk (thread-safe)."""
        with self._lock:
            self._load_csv()

    def ingest_csv(self, csv_text: str) -> int:
        """
        Replace the tenant's inventory.csv with new CSV content and reload.
        Validates headers, handles UTF-8 BOM, and rejects malformed CSVs.
        """
        clean_text = csv_text.lstrip("\ufeff").strip()
        if not clean_text:
            raise ValueError("Uploaded CSV is empty.")

        f = io.StringIO(clean_text)
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise ValueError("Uploaded CSV has no header row.")

        header_map = {fn.strip().lower(): fn for fn in reader.fieldnames if fn}
        if "item_name" in header_map and "item" not in header_map:
            header_map["item"] = header_map["item_name"]

        missing = [col for col in self.REQUIRED_INGEST_COLUMNS if col not in header_map]
        if missing:
            raise ValueError(f"Uploaded CSV is missing required columns: {', '.join(missing)}")

        new_rows = []
        for raw_row in reader:
            normalized_row = {
                (k.strip().lower() if k else ""): (v or "").strip() for k, v in raw_row.items()
            }
            if "item_name" in normalized_row and "item" not in normalized_row:
                normalized_row["item"] = normalized_row["item_name"]

            item_val = normalized_row.get("item", "")
            if not item_val:
                continue
            new_rows.append(self._enrich_row(normalized_row))

        if not new_rows:
            raise ValueError("Uploaded CSV contains no valid data rows.")

        with self._lock:
            self._rows = new_rows
            self._save_csv()

        return len(new_rows)

    def get_sync_payload(self) -> list[dict]:
        """Return all inventory items for Layer-1 Offline PWA IndexedDB sync."""
        with self._lock:
            return [self._row_to_card(r) for r in self._rows]

    # -------------------------------------------------------------------
    # Query Classification & Cleaning
    # -------------------------------------------------------------------

    @staticmethod
    def is_procedural_query(query: str) -> bool:
        """
        Return True if the query is a procedural, clinical protocol, or
        surgeon preference question that should bypass Tier 1 and go to Tier 2.
        """
        return bool(_PROCEDURAL_INDICATORS.search(query))

    @staticmethod
    def _clean_query(query: str) -> str:
        """
        Strip conversational filler, punctuation, and PHI redaction stubs
        to isolate the target item name.
        """
        text = re.sub(r"\[REDACTED_PHI\]", " ", query, flags=re.IGNORECASE)
        text = re.sub(r"\b(?:from|in)\s+(?:or|room)\s*\d+\b", " ", text, flags=re.IGNORECASE)
        text = re.sub(r"[?!.,;:\"'()]+", " ", text)
        text = re.sub(r"\s+", " ", text).strip()

        text = _QUERY_PREFIXES.sub("", text).strip()
        text = re.sub(
            r"^.*?\b(?:where\s+(?:is|are)|find|locate|needs?|looking\s+for)\s+(?:the\s+|a\s+|an\s+)?",
            "",
            text,
            flags=re.IGNORECASE,
        ).strip()

        text = re.sub(
            r"^(?:patient|pt|mrn|dob|needs?|wants?|for|case)\s+",
            "",
            text,
            flags=re.IGNORECASE,
        ).strip()
        while re.match(r"^(?:patient|pt|mrn|dob|needs?|wants?|for|case)\s+", text, re.IGNORECASE):
            text = re.sub(
                r"^(?:patient|pt|mrn|dob|needs?|wants?|for|case)\s+",
                "",
                text,
                flags=re.IGNORECASE,
            ).strip()

        return text.lower().strip()

    # -------------------------------------------------------------------
    # 3-Stage Deterministic Cascade Search (<15ms, $0 LLM Cost)
    # -------------------------------------------------------------------

    @staticmethod
    def _compute_match_score(cleaned_query: str, row: dict) -> float:
        """
        Compute the best match score (0-100) between a cleaned query and
        an inventory row's item name + pipe-separated aliases.
        """
        if not cleaned_query:
            return 0.0

        candidates = [row["item"].lower()]
        if row["aliases"]:
            candidates.extend(
                alias.strip().lower()
                for alias in row["aliases"].split("|")
                if alias.strip()
            )

        row_text_all = " ".join(candidates)
        if is_eponym_conflict(cleaned_query, row_text_all):
            return 0.0

        size_tokens = re.findall(r"\b\d+-(?:0|zero|oh)\b|\b\d+\s*fr\b|\b#\d+\b", cleaned_query)

        best_score = 0.0
        for candidate in candidates:
            if cleaned_query == candidate:
                return 100.0

            w_score = fuzz.WRatio(cleaned_query, candidate)
            ts_score = fuzz.token_set_ratio(cleaned_query, candidate)
            score = max(w_score, ts_score * 0.95)

            if size_tokens:
                for st in size_tokens:
                    st_norm = st.replace(" ", "")
                    if st_norm not in row_text_all.replace(" ", ""):
                        score -= 25.0

            if score > best_score:
                best_score = score

        return best_score

    def _find_matching_row(self, query: str) -> tuple[Optional[dict], str]:
        """
        Execute the 3-Stage Deterministic Cascade with Clinical Spec & Gauge Guards:
            Stage A: Exact normalized match
            Stage B: Double Metaphone phonetic_code match
            Stage C: RapidFuzz >= 82
        """
        cleaned = self._clean_query(query)
        if not cleaned or len(cleaned) < 2:
            return None, ""

        if is_generic_class_only(cleaned):
            return None, ""

        norm_query, query_phonetic = normalize_and_hash(cleaned)
        query_specs = extract_gauge_and_specs(f"{norm_query} {cleaned} {query}")
        norm_lingo = normalize_or_lingo(cleaned)

        # --- STAGE A: Exact Normalized Match ---
        for row in self._rows:
            if has_conflicting_specifications(query_specs, row):
                continue
            row_full = f"{row.get('item', '')} {row.get('aliases', '')}"
            if is_eponym_conflict(cleaned, row_full):
                continue
            if norm_query == row["normalized_name"] or norm_query in row["_norm_aliases"]:
                return row, "STAGE_A_EXACT"
            if norm_lingo == row["normalized_name"] or norm_lingo in row["_norm_aliases"]:
                return row, "STAGE_A_EXACT"

        # Check leading prefix match (e.g. "3-0 silk" matching "3-0 silk suture")
        for row in self._rows:
            if has_conflicting_specifications(query_specs, row):
                continue
            row_full = f"{row.get('item', '')} {row.get('aliases', '')}"
            if is_eponym_conflict(cleaned, row_full):
                continue
            if row["normalized_name"].startswith(norm_query + " ") and len(norm_query) >= 4:
                return row, "STAGE_A_EXACT"
            if row["normalized_name"].startswith(norm_lingo + " ") and len(norm_lingo) >= 4:
                return row, "STAGE_A_EXACT"

        # Check subphrase word-bounded match for items/aliases within longer clinical queries
        # (e.g. "Patient Robert Miller ... needs 4-0 Prolene RB-1 and Heparin 300 units/kg for ACT over 480")
        for row in self._rows:
            if has_conflicting_specifications(query_specs, row):
                continue
            row_full = f"{row.get('item', '')} {row.get('aliases', '')}"
            if is_eponym_conflict(cleaned, row_full):
                continue
            for cand in [row["normalized_name"]] + row["_norm_aliases"]:
                if len(cand) >= 4 and (
                    re.search(r"\b" + re.escape(cand) + r"\b", norm_query)
                    or re.search(r"\b" + re.escape(cand) + r"\b", norm_lingo)
                ):
                    return row, "STAGE_A_EXACT"

        # --- STAGE B: Double Metaphone Phonetic Match ---
        if query_phonetic:
            query_phon_tokens = query_phonetic.split()
            for row in self._rows:
                if has_conflicting_specifications(query_specs, row):
                    continue
                row_full = f"{row.get('item', '')} {row.get('aliases', '')}"
                if is_eponym_conflict(cleaned, row_full):
                    continue
                if query_phonetic == row["phonetic_code"] or query_phonetic in row["_phon_aliases"]:
                    return row, "STAGE_B_PHONETIC"

            # Check prefix/subset phonetic match when phonetic token is highly specific (e.g. TPK, TKRN, ATLN, PRLN)
            for row in self._rows:
                if has_conflicting_specifications(query_specs, row):
                    continue
                row_full = f"{row.get('item', '')} {row.get('aliases', '')}"
                if is_eponym_conflict(cleaned, row_full):
                    continue
                row_phon_set = set(row["phonetic_code"].split())
                for pa in row["_phon_aliases"]:
                    row_phon_set.update(pa.split())

                if query_phon_tokens and any(len(tok) >= 3 for tok in query_phon_tokens) and all(tok in row_phon_set for tok in query_phon_tokens):
                    return row, "STAGE_B_PHONETIC"

        # --- STAGE C: RapidFuzz Token Set / WRatio >= 82 ---
        best_row: Optional[dict] = None
        best_score = 0.0

        for idx, row in enumerate(self._rows):
            if has_conflicting_specifications(query_specs, row):
                continue
            row_full = f"{row.get('item', '')} {row.get('aliases', '')}"
            if is_eponym_conflict(cleaned, row_full):
                continue
            for candidate_q in (norm_query, cleaned, norm_lingo):
                score = self._compute_match_score(candidate_q, row)
                if score >= _SIMILARITY_THRESHOLD and (
                    score > best_score
                    or (score == best_score and best_row is not None and idx < self._rows.index(best_row))
                ):
                    best_score = score
                    best_row = row

        if best_row is not None:
            return best_row, "STAGE_C_FUZZY"

        return None, ""

    def search(
        self,
        query: str,
        record_implicit_verification: bool = True,
        cooldown_seconds: Optional[float] = None,
        user_id: Optional[str] = None,
    ) -> Optional[dict]:
        """
        Search inventory for a matching item using the 3-Stage Cascade and Facility Lexicon.
        If `record_implicit_verification` is True and the matched item is
        provisional (`verification_score < 3.0`), increments its score by +0.5
        and promotes to `verified` at 3.0, protected by an optional cooldown
        per item to prevent score inflation from rapid lookups.
        """
        if self.is_procedural_query(query):
            return None

        with self._lock:
            facility_id, department_id = get_facility_id_from_tenant(self.tenant.tenant_id)
            alias_entry = resolve_spoken_alias(facility_id, query)
            matched_row = None
            stage = ""

            # Check learned facility lexicon first
            if alias_entry:
                canon_norm = alias_entry["canonicalItemName"].strip().lower()
                for r in self._rows:
                    if r["item"].strip().lower() == canon_norm or r["normalized_name"] == canon_norm:
                        matched_row = r
                        stage = "STAGE_A_LEXICON_ALIAS"
                        matched_row["_user_preferred_term"] = alias_entry.get("displayPreferredName") or title_case_term(alias_entry["spokenTerm"])
                        matched_row["_facility_aliases"] = get_all_aliases_for_item(facility_id, r["item"])
                        matched_row["_facility_name"] = facility_id.replace("_", " ").title()
                        learn_alias(
                            facility_id=facility_id,
                            department_id=department_id,
                            spoken_term=alias_entry["spokenTerm"],
                            canonical_item=r["item"],
                            user_id=user_id or "anonymous",
                            display_name=alias_entry.get("displayPreferredName"),
                        )
                        break

            if matched_row is None:
                matched_row, stage = self._find_matching_row(query)
                if matched_row is not None:
                    cleaned_q = self._clean_query(query)
                    user_pref = title_case_term(cleaned_q)
                    matched_row["_facility_aliases"] = get_all_aliases_for_item(facility_id, matched_row["item"])
                    matched_row["_facility_name"] = facility_id.replace("_", " ").title()
                    # If user asked with a slang / local variant (not identical to item name)
                    if cleaned_q.lower() != matched_row["item"].lower():
                        matched_row["_user_preferred_term"] = user_pref
                        learn_alias(
                            facility_id=facility_id,
                            department_id=department_id,
                            spoken_term=cleaned_q,
                            canonical_item=matched_row["item"],
                            user_id=user_id or "anonymous",
                            display_name=user_pref,
                        )
                    else:
                        matched_row["_user_preferred_term"] = matched_row["item"]

            if matched_row is None:
                return None

            matched_row["_last_match_stage"] = stage

            if record_implicit_verification and (
                matched_row.get("status") == "provisional"
                or float(matched_row.get("verification_score", 3.0)) < 3.0
            ):
                effective_cd = self.cooldown_seconds if cooldown_seconds is None else cooldown_seconds
                now_ts = time.time()
                item_key = f"{self.tenant.tenant_id}::{matched_row['item'].lower()}"
                last_ts = _implicit_verification_cooldown.get(item_key, 0.0)

                # Rate guard cooldown window check
                if effective_cd > 0 and (now_ts - last_ts < effective_cd):
                    return self._row_to_card(matched_row)

                _implicit_verification_cooldown[item_key] = now_ts
                new_score = round(min(3.0, float(matched_row.get("verification_score", 1.0)) + 0.5), 2)
                matched_row["verification_score"] = new_score
                matched_row["last_verified_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                if new_score >= 3.0:
                    matched_row["status"] = "verified"
                self._save_csv()

            return self._row_to_card(matched_row)

    def search_family(self, query: str, max_results: int = 4) -> list[dict]:
        """
        Return all inventory items matching a generic family query (no gauge/size specified).
        For example: 'prolene' -> [2-0 Prolene, 4-0 Prolene, 7-0 Prolene]
                     'blades' -> [#10 Blade, #11 Blade, #15 Blade]
        """
        if self.is_procedural_query(query):
            return []

        cleaned = self._clean_query(query)
        if not cleaned or len(cleaned) < 3:
            return []

        specs = extract_gauge_and_specs(f"{cleaned} {query}")
        has_spec = any(bool(specs.get(k)) for k in ("suture_gauges", "french_sizes", "needle_codes", "blade_numbers", "gauge_sizes", "mm_sizes", "lengths"))
        if has_spec:
            # Not a generic family query - has explicit size/gauge
            return []

        stem = cleaned.rstrip("s").lower()
        norm_q = cleaned.lower()

        matched_cards: list[dict] = []
        with self._lock:
            for row in self._rows:
                row_norm = row["normalized_name"]
                row_aliases = row["_norm_aliases"]
                cat = row.get("category", "").lower()

                # Check if query or stem is a distinct word in row name, aliases, or category
                words = set(re.findall(r"[a-z0-9\-]+", f"{row_norm} {' '.join(row_aliases)} {cat}"))
                if norm_q in words or stem in words:
                    matched_cards.append(self._row_to_card(row))
                    if len(matched_cards) >= max_results:
                        break

        return matched_cards

    def flag_wrong(self, item_query: str, reason: str = "") -> Optional[dict]:
        """
        Explicitly flag an item as wrong/empty/moved:
        Immediately drops `verification_score` to 0.5 and sets
        `status = 'needs_reverification'`.
        """
        with self._lock:
            matched_row, stage = self._find_matching_row(item_query)
            if matched_row is None:
                return None

            matched_row["verification_score"] = 0.5
            matched_row["status"] = "needs_reverification"
            matched_row["last_verified_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            matched_row["_last_match_stage"] = stage or "STAGE_A_EXACT"
            self._save_csv()
            return self._row_to_card(matched_row)

    @staticmethod
    def _row_to_card(row: dict) -> AttrDict:
        """Convert an internal CSV row dict into an AttrDict CoordinateCard response."""
        room = row["room"]
        cabinet = row["cabinet"]
        shelf = row["shelf"]
        container = row["container"]
        return AttrDict({
            "item": row["item"],
            "user_preferred_term": row.get("_user_preferred_term"),
            "facility_aliases": row.get("_facility_aliases", []),
            "facility_name": row.get("_facility_name"),
            "category": row["category"],
            "room": room,
            "cabinet": cabinet,
            "shelf": shelf,
            "container": container,
            "full_code": f"{room} {cabinet} {shelf} {container}",
            "human_alias": row.get("human_alias") or f"{room} · Cart {cabinet} · Shelf {shelf} · Bin {container}",
            "aliases": row["aliases"],
            "pending_location": row["pending_location"],
            "new_location": row["pending_location"],
            "verify_count": row["verify_count"],
            "committed": False,
            "surgeon_notes": row["surgeon_notes"],
            "verification_score": float(row.get("verification_score", 3.0)),
            "status": row.get("status", "verified"),
            "last_verified_at": row.get("last_verified_at", "2026-10-20T08:00:00Z"),
            "phonetic_code": row.get("phonetic_code", ""),
            "match_stage": row.get("_last_match_stage", "STAGE_A_EXACT"),
        })

    # -------------------------------------------------------------------
    # Crowdsourced Move Reporting & 3-Peer Verification Consensus
    # -------------------------------------------------------------------

    @staticmethod
    def parse_move_command(query: str) -> Optional[tuple[str, str]]:
        """
        Check if a natural language query is reporting an item relocation.
        Rejects questions, interrogatives, and speculative queries.
        Canonicalizes lowercase voice coordinates and natural phrasing:
          'the 3-0 silk moved to or 21 b 1 a' -> ('3-0 silk', 'OR 21 B 1 A')
          '3-0 silk moved to room 21 cabinet b shelf 1 bin a' -> ('3-0 silk', 'OR 21 B 1 A')
        """
        if "?" in query:
            return None

        cleaned = re.sub(r"\[REDACTED_PHI\]", "", query, flags=re.IGNORECASE).strip()
        if "?" in cleaned:
            return None

        # Interrogative check: questions asking about moves are NOT move commands!
        if re.search(
            r"^(?:why|did|was|is|are|who|where|how|check\s+if|has|have|can\s+you\s+check)\b",
            cleaned,
            re.IGNORECASE,
        ):
            return None

        match = _MOVE_PATTERN.match(cleaned)
        if not match:
            return None

        item_part = match.group("item").strip()
        raw_loc = match.group("location").strip()
        canonical_loc = normalize_location_coordinate(raw_loc)
        if not canonical_loc:
            # Fallback to standard token uppercase
            loc_tokens = re.sub(r"\s+", " ", raw_loc).split()
            if len(loc_tokens) >= 4:
                canonical_loc = " ".join([t.upper() if len(t) == 1 else t for t in loc_tokens])
            else:
                return None

        return item_part, canonical_loc

    def report_move(self, item_query: str, new_location: str) -> Optional[dict]:
        """
        Initiate or update a crowdsourced move report for an item.
        Vector 3: If a different destination is reported while a move is pending,
        resets pending destination and verify_count = 1 to prevent split-brain.
        """
        canonical_loc = normalize_location_coordinate(new_location) or new_location.strip()
        with self._lock:
            matched_row, _ = self._find_matching_row(item_query)
            if matched_row is None:
                return None

            # Reset verify_count to 1 if the destination changed
            if matched_row["pending_location"] and matched_row["pending_location"] != canonical_loc:
                matched_row["verify_count"] = 1
            elif not matched_row["pending_location"]:
                matched_row["verify_count"] = 1

            matched_row["pending_location"] = canonical_loc
            matched_row["verification_score"] = 1.0
            matched_row["status"] = "provisional"
            matched_row["last_verified_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            self._save_csv()
            return self._row_to_card(matched_row)

    def verify_move(self, item_name: str, expected_location: Optional[str] = None) -> Optional[dict]:
        """
        Increment verify_count for an item's pending move.
        Vector 3: Rejects confirmations from outdated widgets if expected_location
        no longer matches active pending_location.
        When verify_count reaches 3:
            - Parses pending_location into room, cabinet, shelf, container
            - Updates primary coordinates & regenerates human_alias cleanly (Vector 2)
            - Clears pending_location = "" and resets verify_count = 0
            - Sets verification_score = 3.0 and status = 'verified'
            - Invalidates RAG cache so ground truth updates immediately (Vector 4)
        """
        with self._lock:
            target_row: Optional[dict] = None
            for row in self._rows:
                if row["item"].lower() == item_name.strip().lower():
                    target_row = row
                    break

            if target_row is None:
                target_row, _ = self._find_matching_row(item_name)

            if target_row is None:
                return None

            if not target_row["pending_location"]:
                card = self._row_to_card(target_row)
                card["committed"] = False
                return card

            # Vector 3: Guard against split-brain / stale confirmations from scrollback
            if expected_location:
                norm_exp = normalize_location_coordinate(expected_location) or expected_location.strip()
                norm_act = normalize_location_coordinate(target_row["pending_location"]) or target_row["pending_location"].strip()
                if norm_exp.lower() != norm_act.lower():
                    card = self._row_to_card(target_row)
                    card["committed"] = False
                    card["superseded"] = True
                    return card

            target_row["verify_count"] += 1
            committed = False

            if target_row["verify_count"] >= 3:
                loc_tokens = target_row["pending_location"].strip().split()
                if len(loc_tokens) >= 4:
                    container = loc_tokens[-1].upper()
                    shelf = loc_tokens[-2]
                    cabinet = loc_tokens[-3].upper()
                    room = " ".join(loc_tokens[:-3])
                    target_row["room"] = room
                    target_row["cabinet"] = cabinet
                    target_row["shelf"] = shelf
                    target_row["container"] = container
                    # Vector 2: Cleanly regenerate human_alias to match new coordinate
                    target_row["human_alias"] = f"{room} · Cart {cabinet} · Shelf {shelf} · Bin {container}"

                target_row["pending_location"] = ""
                target_row["verify_count"] = 0
                target_row["verification_score"] = 3.0
                target_row["status"] = "verified"
                target_row["last_verified_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                committed = True

                # Vector 4: Invalidate RAG cache when move commits to primary coordinates
                try:
                    from app.services.rag_fallback import get_rag_service
                    get_rag_service(self.tenant.tenant_id).reload()
                except Exception:
                    pass

            self._save_csv()
            card = self._row_to_card(target_row)
            card["committed"] = committed
            return card

    def add_inventory_item(
        self,
        item: str,
        location_str: str,
        category: str = "Supplies",
        surgeon_notes: str = "",
        status: str = "verified",
    ) -> dict:
        """
        Add a new inventory item or update an existing item's location atomically.
        Parses location into room, cabinet, shelf, container, enriches row, saves CSV,
        and invalidates RAG cache so updates reflect immediately.
        """
        canonical_loc = normalize_location_coordinate(location_str) or location_str.strip()
        tokens = canonical_loc.split()
        if len(tokens) >= 4:
            room = " ".join(tokens[:-3])
            cab = tokens[-3].upper()
            shelf = tokens[-2]
            container = tokens[-1].upper()
        elif len(tokens) == 3:
            room = "Core Supply"
            cab = tokens[0].upper()
            shelf = tokens[1]
            container = tokens[2].upper()
        else:
            room = "Core Supply"
            cab = "A"
            shelf = "1"
            container = "A"
            m_cab = re.search(r"\b(?:cart|cabinet|cab|rack|alcove)\s*([a-zA-Z0-9]+)\b", location_str, re.I)
            if m_cab:
                cab = m_cab.group(1).upper()
            m_sh = re.search(r"\b(?:shelf|drawer)\s*([0-9]+)\b", location_str, re.I)
            if m_sh:
                shelf = m_sh.group(1)
            m_bin = re.search(r"\b(?:bin|container|shelf)\s*([a-zA-Z])\b", location_str, re.I)
            if m_bin:
                container = m_bin.group(1).upper()

        new_row_dict = {
            "item": item.strip().title(),
            "category": category,
            "room": room,
            "cabinet": cab,
            "shelf": shelf,
            "container": container,
            "human_alias": f"{room} · Cart {cab} · Shelf {shelf} · Bin {container}",
            "aliases": "",
            "pending_location": "",
            "verify_count": 0,
            "surgeon_notes": surgeon_notes,
            "verification_score": 3.0,
            "status": status,
            "last_verified_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        enriched = self._enrich_row(new_row_dict)
        with self._lock:
            existing_idx = None
            for idx, r in enumerate(self._rows):
                if r["item"].lower() == item.strip().lower():
                    existing_idx = idx
                    break
            if existing_idx is not None:
                self._rows[existing_idx] = enriched
            else:
                self._rows.append(enriched)
            self._save_csv()
            try:
                from app.services.rag_fallback import get_rag_service
                get_rag_service(self.tenant.tenant_id).reload()
            except Exception:
                pass
            return self._row_to_card(enriched)



# ---------------------------------------------------------------------------
# Module-level service cache (one instance per tenant) & Verification Cooldown
# ---------------------------------------------------------------------------

_services: dict[str, InventoryService] = {}
_services_lock = threading.Lock()
_implicit_verification_cooldown: dict[str, float] = {}


def get_inventory_service(tenant_id: str) -> InventoryService:
    """Get or create an InventoryService for the given tenant."""
    with _services_lock:
        if tenant_id not in _services:
            from app.config import get_tenant
            _services[tenant_id] = InventoryService(get_tenant(tenant_id))
        return _services[tenant_id]


def reset_inventory_services() -> None:
    """Clear all cached InventoryService instances (used in testing)."""
    with _services_lock:
        _services.clear()
        _implicit_verification_cooldown.clear()
