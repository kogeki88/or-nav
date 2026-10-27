"""
OR-Nav PHI Scrubber — Client/Edge Regex-Based PHI Removal.

Runs BEFORE any query hits the Hybrid Router. Defense-in-depth layer:
this module is mirrored in TypeScript on the client side.

CRITICAL DESIGN CONSTRAINT:
    Must NOT redact CVOR clinical terms that resemble PHI patterns:
    - Suture sizes: 3-0, 4-0, 7-0, 2-0, etc.
    - Blade numbers: #10, #11, #15
    - Tube/device sizes: 32Fr, 24Fr, 26Fr
    - OR coordinates: OR 21 A 2 C
    - Drug doses: 300 units/kg, 2.5 mg/kg, 1000u/mL
    - Phone extensions: x4-25663 (internal format, not external phone)
"""

import re
from typing import NamedTuple


REDACTION = "[REDACTED_PHI]"


class ScrubResult(NamedTuple):
    """Result of a PHI scrubbing operation."""
    text: str
    redaction_count: int


# ---------------------------------------------------------------------------
# 1. MRN Patterns
#    Matches: "MRN 1234567", "MRN: 12345678", "MRN#1234567890"
#    Does NOT match: bare digit sequences, suture sizes, OR coordinates
# ---------------------------------------------------------------------------
_MRN_PATTERN = re.compile(
    r'\bMRN\s*[#:]?\s*\d(?:[\d\s-]{4,12}\d)\b',
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# 2. SSN Patterns
#    Matches: 123-45-6789, 123 45 6789
#    Anchored with word boundaries to avoid matching inside longer numbers.
#    Does NOT match: phone numbers (different grouping), suture sizes.
# ---------------------------------------------------------------------------
_SSN_PATTERN = re.compile(
    r'\b\d{3}[-\s]\d{2}[-\s]\d{4}\b',
)

# ---------------------------------------------------------------------------
# 3. Date of Birth Patterns
#    Matches: "DOB 01/15/1980", "DOB: 1-15-1980", "date of birth 01/15/80"
#    Requires the DOB/date-of-birth prefix to avoid matching arbitrary dates
#    (surgical dates, procedure dates are NOT PHI in this context since
#    they relate to the procedure, not the patient identity).
# ---------------------------------------------------------------------------
_DOB_PATTERN = re.compile(
    r'(?:DOB|date\s+of\s+birth)\s*[:\s]\s*'
    r'\d{1,2}[-/]\d{1,2}[-/]\d{2,4}',
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# 4. External Phone Number Patterns
#    Matches: (555) 123-4567, 555-123-4567, 555.123.4567
#    Does NOT match:
#      - Internal extensions (x4-25663) — different format
#      - MH Hotline 1-800-644-9737 — kept; it's a public number, but we
#        err on the side of NOT scrubbing it since it's in orientation docs.
#        Actually, 1-800 numbers are public. We match 10-digit local numbers.
#    Strategy: match exactly 10-digit patterns with common US separators,
#    optionally preceded by +1 or 1-.
# ---------------------------------------------------------------------------
_PHONE_PATTERN = re.compile(
    r'(?<!\w)'                           # not preceded by word char (avoids x4-...)
    r'(?:\+?1[-.\s]?)?'                 # optional country code
    r'\(?\d{3}\)?[-.\s]?'               # area code
    r'\d{3}[-.\s]?'                      # exchange
    r'\d{4}'                             # subscriber
    r'(?!\w)',                           # not followed by word char
)

# We need to be careful: 1-800-644-9737 is an external number but it's a
# PUBLIC hotline. We'll match it but provide a whitelist mechanism.
_PUBLIC_PHONE_WHITELIST = {
    "18006449737",  # MHAUS MH Hotline
}


def _normalize_phone(match_text: str) -> str:
    """Strip a phone match to digits only for whitelist comparison."""
    return re.sub(r'\D', '', match_text)


# Eponymous surgical instruments & anatomical terms named after physicians.
# These MUST NEVER be redacted as patient PHI.
EPONYMOUS_INSTRUMENTS = {
    "debakey", "mayo", "metzenbaum", "adson", "weitlaner", "castaneda",
    "satinsky", "cooley", "bookwalter", "fogarty", "babcock", "kocher",
    "allis", "senn", "army navy", "army-navy", "kelly", "crile",
    "richardson", "deaver", "heaney", "poole", "yankauer", "foerster",
    "halsted", "cushing", "gerald", "potts", "carmalt", "duval", "gelpi",
}

# ---------------------------------------------------------------------------
# 5. Patient Name Patterns (Heuristic)
#    Matches: "patient John Smith", "patient named Sarah Connor", "pt Jane Doe"
#    Preserves: surgeon names ("Dr. Patel", "Doctor Chen"), eponymous instruments
# ---------------------------------------------------------------------------
_PATIENT_NAME_PATTERN = re.compile(
    r'\b(?:[Pp]atient|[Pp]t\.?)\s+'            # prefix
    r'(?:named\s+|called\s+)?'                  # optional "named" or "called"
    r'('
    r'[A-Z][a-z]+(?:\s+[A-Z]\.?)?'      # First name + optional middle initial
    r'\s+[A-Z][a-z]+'                    # Last name
    r')',
)

# Pattern to detect surgeon / physician references (must NOT be scrubbed)
_SURGEON_PREFIX_PATTERN = re.compile(
    r'\b(?:dr\.?|doctor)\s+[a-z]+',
    re.IGNORECASE,
)


def scrub_phi(text: str) -> ScrubResult:
    """
    Scrub Protected Health Information from text using regex patterns.

    Replaces detected PHI with [REDACTED_PHI]. Returns a ScrubResult with
    the cleaned text and the count of redactions made.

    Safe for CVOR clinical terms — suture sizes, blade numbers, device
    sizes, OR coordinates, drug doses, and internal phone extensions
    all pass through untouched.

    Args:
        text: Raw input text, potentially containing PHI.

    Returns:
        ScrubResult with scrubbed text and redaction count.
    """
    if not text:
        return ScrubResult(text="", redaction_count=0)

    count = 0
    result = text

    # --- Pass 1: MRN ---
    mrn_matches = _MRN_PATTERN.findall(result)
    count += len(mrn_matches)
    result = _MRN_PATTERN.sub(REDACTION, result)

    # --- Pass 2: SSN ---
    ssn_matches = _SSN_PATTERN.findall(result)
    count += len(ssn_matches)
    result = _SSN_PATTERN.sub(REDACTION, result)

    # --- Pass 3: DOB ---
    dob_matches = _DOB_PATTERN.findall(result)
    count += len(dob_matches)
    result = _DOB_PATTERN.sub(REDACTION, result)

    # --- Pass 4: External phone numbers (with whitelist check) ---
    def _phone_replacer(match: re.Match) -> str:
        nonlocal count
        digits = _normalize_phone(match.group())
        if digits in _PUBLIC_PHONE_WHITELIST:
            return match.group()  # Keep public hotline numbers
        count += 1
        return REDACTION

    result = _PHONE_PATTERN.sub(_phone_replacer, result)

    # --- Pass 5: Patient names (heuristic) ---
    def _name_replacer(match: re.Match) -> str:
        nonlocal count
        full_match = match.group(0)
        name_part = match.group(1).strip()
        name_lower = name_part.lower()

        # Extra safety: skip if the "name" is a known clinical term or eponymous instrument
        clinical_false_positives = {
            "patient positioning", "patient transport", "patient draping",
            "patient education", "patient safety", "patient warming",
            "patient transfer", "patient identification",
        }
        if full_match.lower() in clinical_false_positives:
            return full_match

        # Do not redact eponymous instruments
        if any(inst in name_lower for inst in EPONYMOUS_INSTRUMENTS):
            return full_match

        # Do not redact surgeon / physician names
        if re.search(r"\b(?:dr\.?|doctor)\b", full_match, re.IGNORECASE):
            return full_match

        count += 1
        # Redact only the name part, keep the "patient"/"pt" prefix
        prefix_end = match.start(1) - match.start(0)
        prefix = full_match[:prefix_end]
        return prefix + REDACTION

    result = _PATIENT_NAME_PATTERN.sub(_name_replacer, result)

    return ScrubResult(text=result, redaction_count=count)
