"""
OR-Nav Semantic Intent & Slot-Parsing Router + Biased Clinical Listening Normalizer.

Replaces brittle string matching with a structured clinical NLP pipeline:
- Intents: FIND_INVENTORY, VIEW_PREFERENCE_CARD, MUTATE_INVENTORY, PEER_BROADCAST, GENERAL_QUERY
- Entities: item, gauge, category, location, action, surgeon, procedure
- Normalizes spoken phonetic and homophone variants (e.g. "four oh viker" -> "4-0 vicryl")
- Provides gauge disambiguation options for generic suture queries
"""

import re
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field

from app.services.lexicon_learning import detect_teaching_intent
from app.services.surgical_ontology import (
    strip_spoken_disfluencies,
    normalize_acoustic_speech,
    normalize_or_lingo,
)


class ClinicalIntent(str, Enum):
    FIND_INVENTORY = "FIND_INVENTORY"
    VIEW_PREFERENCE_CARD = "VIEW_PREFERENCE_CARD"
    MUTATE_INVENTORY = "MUTATE_INVENTORY"
    PEER_BROADCAST = "PEER_BROADCAST"
    TEACH_ALIAS = "TEACH_ALIAS"
    GENERAL_QUERY = "GENERAL_QUERY"


class ClinicalEntities(BaseModel):
    item: Optional[str] = None
    target_item: Optional[str] = None
    alias_term: Optional[str] = None
    gauge: Optional[str] = None
    category: Optional[str] = None
    location: Optional[str] = None
    action: Optional[str] = None  # "add", "move", "flag", "teach_alias"
    surgeon: Optional[str] = None
    procedure: Optional[str] = None
    learned_aliases: list[str] = Field(default_factory=list)
    notes: Optional[str] = None


class ParsedIntent(BaseModel):
    intent: ClinicalIntent
    confidence: float = 0.95
    entities: ClinicalEntities
    raw_query: str
    normalized_query: str
    user_preferred_term: Optional[str] = None
    search_expanded_query: Optional[str] = None
    spoken_transcript_correction: Optional[str] = None
    disambiguation_options: list[str] = Field(default_factory=list)


# Suture gauge spoken representations
SUTURE_GAUGE_MAP: list[tuple[re.Pattern, str]] = [
    # 7-0
    (re.compile(r"\b(?:seven[\s\-]*(?:oh|zero)|7[\s\-]*(?:oh|zero)|seventy)\b", re.IGNORECASE), "7-0"),
    # 6-0
    (re.compile(r"\b(?:six[\s\-]*(?:oh|zero)|6[\s\-]*(?:oh|zero)|sixty)\b", re.IGNORECASE), "6-0"),
    # 5-0
    (re.compile(r"\b(?:five[\s\-]*(?:oh|zero)|5[\s\-]*(?:oh|zero)|fifty)\b", re.IGNORECASE), "5-0"),
    # 4-0
    (re.compile(r"\b(?:four[\s\-]*(?:oh|zero|dash[\s\-]*zero)|4[\s\-]*(?:oh|zero|dash[\s\-]*zero)|forty)\b", re.IGNORECASE), "4-0"),
    # 3-0
    (re.compile(r"\b(?:three[\s\-]*(?:oh|zero|dash[\s\-]*zero)|3[\s\-]*(?:oh|zero|dash[\s\-]*zero)|thirty)\b", re.IGNORECASE), "3-0"),
    # 2-0
    (re.compile(r"\b(?:two[\s\-]*(?:oh|zero|dash[\s\-]*zero)|2[\s\-]*(?:oh|zero|dash[\s\-]*zero)|twenty)\b", re.IGNORECASE), "2-0"),
    # 0 (Zero / Aught)
    (re.compile(r"(?<![\d\-/])\b(?:size\s+)?(?:zero|aught|#0)\b(?!\s*[\-/]\s*\d)", re.IGNORECASE), "0"),
]

# Clinical term & phonetic corrections
CLINICAL_TERM_CORRECTIONS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\b(?:viker|vickryl|vickrel|vikryl|vicral|vikel)\b", re.IGNORECASE), "vicryl"),
    (re.compile(r"\b(?:pro\s*lean|pro\-lean|proline|prolyne)\b", re.IGNORECASE), "prolene"),
    (re.compile(r"\b(?:the\s+bakery|de\s+bakery|da\s+bakery|bakery|debakeys|de\s*bakey)\b", re.IGNORECASE), "debakey"),
    (re.compile(r"\b(?:tie\s*cron|tye\s*cron|ticron)\b", re.IGNORECASE), "ti-cron"),
    (re.compile(r"\b(?:white\s*laner|white\s*liner|white\s*lainer|weit\s*laner)\b", re.IGNORECASE), "weitlaner"),
    (re.compile(r"\b(?:bovey|bo\s*vie|bovie\s*pencil)\b", re.IGNORECASE), "bovie"),
    (re.compile(r"\b(?:heprin|heparine)\b", re.IGNORECASE), "heparin"),
    (re.compile(r"\b(?:add\s*son|ad\s+son)\b", re.IGNORECASE), "adson"),
    (re.compile(r"\b(?:metzenbaum\s+scissors?)\b", re.IGNORECASE), "metzenbaum"),
    (re.compile(r"\b(?:trochar|trochars)\b", re.IGNORECASE), "trocar"),
    (re.compile(r"\b(?:monacryl|monocrile)\b", re.IGNORECASE), "monocryl"),
    (re.compile(r"\b(?:cromatic|chromick)\b", re.IGNORECASE), "chromic"),
    (re.compile(r"\b(?:yankaur|yankur|yank\s*auer)\b", re.IGNORECASE), "yankauer"),
    (re.compile(r"\b(?:lap\s+pad|lap\s+sponge|laparotomy\s+pad)\b", re.IGNORECASE), "lap sponge"),
    (re.compile(r"\b(?:raytec|raytech|ray\s*tec)\b", re.IGNORECASE), "raytec"),
]

# Peer Broadcast query trigger patterns
PEER_BROADCAST_PATTERNS = re.compile(
    r"\b(?:"
    r"question\s+for\s+(?:the\s+)?(?:unit|team|peers|nurses|everyone|or|cvor)|"
    r"can\s+(?:someone|anyone)\s+tell\s+me|"
    r"(?:orientee|new\s+grad)\s+question|"
    r"ask\s+(?:the\s+)?(?:unit|peers|team|department)|"
    r"peer\s+ping|"
    r"has\s+anyone\s+seen|"
    r"does\s+anyone\s+know\s+(?:where|what|who|if)"
    r")\b",
    re.IGNORECASE,
)

# Mutation (Add/Move/Flag) trigger patterns and coordinate parsing (Phase 40)
PACKED_COORD_REGEX = re.compile(
    r"(?:\b(?:to|into|in|at|on|inside|under|location:?|loc:?)\s+)?"
    r"\b(?P<prefix>or|icu|er|ed|pacu|cvor|core|rm|room|bay|cart|pump|pod)[\s-]*"
    r"(?P<unit>\d{1,2})\s*"
    r"(?P<cab>[a-zA-Z])\s*"
    r"(?P<shelf>\d{1,2})"
    r"(?:\s*(?P<bin>[a-zA-Z]))?\b",
    re.IGNORECASE,
)

SPACED_COORD_REGEX = re.compile(
    r"(?:\b(?:to|into|in|at|on|inside|under|location:?|loc:?)\s+)?"
    r"\b(?P<coord>(?:OR|room|bay|pod|trauma\s+bay|trauma|icu|er|ed|pacu|cvor|core(?:\s+supply)?|pump(?:\s+room)?|rack|shelf|cabinet|cart|bin)"
    r"\b[\s\w·\-\/]+?)(?=[,.;]|$|\band\b)",
    re.IGNORECASE,
)

ALIAS_CLAUSE_REGEX = re.compile(
    r"(?:[,;.\(\)]|\band\b)?\s*"
    r"(?:they(?:'re|\'re|re|\s+are)|it(?:'s|\'s|s|\s+is)|we|people)?\s*"
    r"(?:also\s+)?"
    r"(?:call(?:ed|s| it| them)?|known as|alias(?:ed)?(?: as)?|aka|or called)\s+"
    r"['\"]?([a-zA-Z0-9\s\-/]+?)['\"]?"
    r"(?=[,.;\)]|$|\band\b)",
    re.IGNORECASE,
)

NOTE_CLAUSE_REGEX = re.compile(
    r"(?:[,;.\(\)]|\band\b)?\s*"
    r"(?:notes?(?::|\s+that|\s+is|\s+are)?)\s+"
    r"['\"]?([a-zA-Z0-9\s\-/'\"#]+?)['\"]?"
    r"(?=[.;\)]|$)",
    re.IGNORECASE,
)


def extract_and_normalize_coordinate(text: str) -> tuple[Optional[str], str]:
    """
    Detect and unpack packed or natural clinical coordinates from text,
    and excise the coordinate span (and any preceding preposition) from the remaining text.
    Returns (normalized_coordinate, cleaned_text).
    e.g. 'add malleable retractor to or21c1f' -> ('OR 21 C 1 F', 'add malleable retractor')
    """
    if not text:
        return None, ""

    # 1. Packed coordinate (e.g. or21c1f, icu2b1, pump2a1, core1b2c)
    m = PACKED_COORD_REGEX.search(text)
    if m:
        p = m.group("prefix").upper()
        if p == "RM":
            p = "ROOM"
        elif p == "PUMP":
            p = "Pump Room"
        elif p == "CORE":
            p = "Core Supply"
        u = m.group("unit")
        c = m.group("cab").upper()
        s = m.group("shelf")
        bin_val = m.group("bin")
        b = f" {bin_val.upper()}" if bin_val else ""
        norm_coord = f"{p} {u} {c} {s}{b}".replace("  ", " ").strip()
        cleaned = text[:m.start()] + text[m.end():]
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        cleaned = re.sub(r"^[,\s]+|[,\s]+$", "", cleaned)
        return norm_coord, cleaned

    # 2. Spaced / Natural coordinate
    m2 = SPACED_COORD_REGEX.search(text)
    if m2:
        coord_raw = m2.group("coord").strip()
        # Clean coordinates using uppercase normalization if standard
        from app.services.inventory_search import normalize_location_coordinate
        norm_coord = normalize_location_coordinate(coord_raw) or coord_raw.upper()
        cleaned = text[:m2.start()] + text[m2.end():]
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        cleaned = re.sub(r"^[,\s]+|[,\s]+$", "", cleaned)
        return norm_coord, cleaned

    return None, text


MUTATE_FLAG_PATTERN = re.compile(
    r"\b(?:flag|report\s+missing|report\s+empty|location\s+wrong|not\s+in\s+bin)\b",
    re.IGNORECASE,
)

# Preference Card trigger patterns
PREFERENCE_CARD_PATTERNS = re.compile(
    r"\b(?:"
    r"(?:pull\s+up|show\s+me|open|get|view|display|check)\s+(?:dr\.?|doctor)?\s*([a-z]+(?:'s)?)?\s*(?:preference\s*cards?|preferences?)|"
    r"preference\s*cards?\s+(?:for\s+)?|"
    r"dr\.?\s+([a-z]+)'s?\s+(?:lap\s+chole|chole|knee|total\s+knee|cabg|prostatectomy|ralp|discectomy|appendectomy|preferences?)|"
    r"(?:mayo\s+stand|instrument\s+tray|back\s+table|tray\s+setup|tray\s+breakdown)\s+for\s+"
    r")\b",
    re.IGNORECASE,
)

# Procedural / General question patterns
GENERAL_QUERY_PATTERNS = re.compile(
    r"\b(?:"
    r"protocol|guideline|policy|checklist|orient(?:ation)?|"
    r"what\s+(?:is|are)\s+the\s+(?:protocol|steps|policy|checklist|dosing|dose|target|positioning|prep)|"
    r"how\s+(?:do|to|much|many)|"
    r"surgical\s+safety\s+time[\s\-]*out|sign[\s\-]*out|"
    r"malignant\s+hyperthermia|dantrolene|"
    r"heparin|protamine|act\s+target|"
    r"scrub\s+roles?|circulator\s+roles?|preceptor|"
    r"aldrete|blood\s+bank|code\s+blue"
    r")\b",
    re.IGNORECASE,
)

COMMON_SUTURE_FAMILIES = ["vicryl", "prolene", "silk", "ti-cron", "monocryl", "ethibond", "pds", "nylon", "chromic"]


def normalize_clinical_speech(text: str) -> tuple[str, Optional[str]]:
    """
    Apply clinical voice speech biasing:
    - Strips vocal disfluencies (e.g. "umm", "uhh", "er", "you know")
    - Suture gauge representations (e.g. "four oh" -> "4-0")
    - Phonetic typo corrections (e.g. "viker" -> "vicryl")
    - Inverted gauge phrasing (e.g. "prolene 3-0" -> "3-0 prolene")
    Returns (normalized_text, transcript_correction_pill_text_if_changed).
    """
    original = text.strip()
    norm = strip_spoken_disfluencies(original)

    # 1. Gauge map (e.g. "four oh" -> "4-0", "thirty" -> "3-0")
    for pat, gauge in SUTURE_GAUGE_MAP:
        norm = pat.sub(gauge, norm)

    # 2. Clinical term corrections (e.g. "proline" -> "prolene", "viker" -> "vicryl")
    for pat, replacement in CLINICAL_TERM_CORRECTIONS:
        norm = pat.sub(replacement, norm)

    # 3. Re-arrange inverted phrases like "prolene 3-0" -> "3-0 prolene"
    for fam in COMMON_SUTURE_FAMILIES:
        norm = re.sub(
            rf"\b({fam})\s+(\d+[\-/]0|0)\b",
            r"\2 \1",
            norm,
            flags=re.IGNORECASE,
        )

    # Format transcript correction if changed noticeably
    correction_pill = None
    if norm.lower() != original.lower():
        correction_pill = f'Recognized: "{norm}"'

    return norm, correction_pill


def parse_clinical_intent(query: str, clinical_role: Optional[str] = None) -> ParsedIntent:
    """
    Parse natural text or spoken transcript into structured clinical intent and slots.
    """
    normalized_query, correction = normalize_clinical_speech(query)
    cleaned = re.sub(r"\[REDACTED_PHI\]", "", normalized_query, flags=re.IGNORECASE).strip()

    # 0. Check TEACH_ALIAS intent (e.g. "Here we call Mixter clamps Geminis", "Adson forceps are called Adson pickups")
    teach_match = detect_teaching_intent(cleaned)
    if teach_match:
        part_a, part_b = teach_match
        return ParsedIntent(
            intent=ClinicalIntent.TEACH_ALIAS,
            confidence=0.98,
            entities=ClinicalEntities(
                target_item=part_a,
                alias_term=part_b,
                action="teach_alias",
            ),
            raw_query=query,
            normalized_query=normalized_query,
            user_preferred_term=part_b,
            search_expanded_query=part_a,
            spoken_transcript_correction=correction,
        )

    # 1. Check PEER_BROADCAST intent first
    if PEER_BROADCAST_PATTERNS.search(cleaned):
        item_match = re.search(r"(?:where\s+(?:the\s+)?|seen\s+(?:the\s+)?)(.+?)(?:\?|$)", cleaned, re.IGNORECASE)
        item_text = item_match.group(1).strip() if item_match else None
        return ParsedIntent(
            intent=ClinicalIntent.PEER_BROADCAST,
            confidence=0.98,
            entities=ClinicalEntities(
                item=item_text,
                action="broadcast",
            ),
            raw_query=query,
            normalized_query=normalized_query,
            spoken_transcript_correction=correction,
        )

    # 2. Check MUTATE_INVENTORY intent (Add / Move / Flag) via Multi-Clause Decomposer
    is_add_intent = bool(re.search(r"\b(?:add|insert|register|new\s+item)\b", cleaned, re.IGNORECASE))
    is_move_intent = bool(re.search(r"\b(?:was\s+moved|moved|relocated|is\s+now\s+at|is\s+now\s+in|transfer\s+to|move\s+to)\b", cleaned, re.IGNORECASE))

    if is_add_intent:
        working = cleaned
        learned_aliases: list[str] = []
        notes: Optional[str] = None

        # Decompose secondary alias clause
        m_al = ALIAS_CLAUSE_REGEX.search(working)
        if m_al:
            learned_aliases.append(m_al.group(1).strip())
            working = working[:m_al.start()] + working[m_al.end():]
            working = re.sub(r"\s+", " ", working).strip()

        # Decompose secondary note clause
        m_nt = NOTE_CLAUSE_REGEX.search(working)
        if m_nt:
            notes = m_nt.group(1).strip()
            working = working[:m_nt.start()] + working[m_nt.end():]
            working = re.sub(r"\s+", " ", working).strip()

        # Extract & excise coordinate
        loc, working = extract_and_normalize_coordinate(working)

        # Extract target item
        item_clean = re.sub(r"^(?:please\s+|can\s+you\s+)?(?:add|insert|register|new\s+item)\s+", "", working, flags=re.IGNORECASE).strip()
        item_clean = re.sub(r"^(?:an?\s+|the\s+)", "", item_clean, flags=re.IGNORECASE).strip()
        item_clean = re.sub(r"\s+(?:to\s+(?:the\s+)?(?:list|inventory|system|database|stock|catalog))$", "", item_clean, flags=re.IGNORECASE).strip()
        item_clean = re.sub(r"[,;.\(\)\s]+$", "", item_clean).strip()

        return ParsedIntent(
            intent=ClinicalIntent.MUTATE_INVENTORY,
            confidence=0.96,
            entities=ClinicalEntities(
                item=item_clean,
                action="add",
                location=loc,
                learned_aliases=learned_aliases,
                notes=notes,
            ),
            raw_query=query,
            normalized_query=normalized_query,
            spoken_transcript_correction=correction,
        )

    if is_move_intent and not cleaned.endswith("?"):
        working = cleaned
        learned_aliases: list[str] = []
        notes: Optional[str] = None

        # Decompose secondary alias clause
        m_al = ALIAS_CLAUSE_REGEX.search(working)
        if m_al:
            learned_aliases.append(m_al.group(1).strip())
            working = working[:m_al.start()] + working[m_al.end():]
            working = re.sub(r"\s+", " ", working).strip()

        # Decompose secondary note clause
        m_nt = NOTE_CLAUSE_REGEX.search(working)
        if m_nt:
            notes = m_nt.group(1).strip()
            working = working[:m_nt.start()] + working[m_nt.end():]
            working = re.sub(r"\s+", " ", working).strip()

        # Extract & excise coordinate
        loc, working = extract_and_normalize_coordinate(working)

        # Extract target item
        item_clean = re.sub(r"\b(?:was\s+moved|moved|relocated|is\s+now\s+at|is\s+now\s+in|transfer\s+to|move\s+to)\b.*$", "", working, flags=re.IGNORECASE).strip()
        item_clean = re.sub(r"^(?:please\s+|can\s+you\s+)?(?:move|transfer)\s+", "", item_clean, flags=re.IGNORECASE).strip()
        item_clean = re.sub(r"^(?:an?\s+|the\s+)", "", item_clean, flags=re.IGNORECASE).strip()
        item_clean = re.sub(r"[,;.\(\)\s]+$", "", item_clean).strip()

        return ParsedIntent(
            intent=ClinicalIntent.MUTATE_INVENTORY,
            confidence=0.96,
            entities=ClinicalEntities(
                item=item_clean,
                action="move",
                location=loc,
                learned_aliases=learned_aliases,
                notes=notes,
            ),
            raw_query=query,
            normalized_query=normalized_query,
            spoken_transcript_correction=correction,
        )

    if MUTATE_FLAG_PATTERN.search(cleaned):
        # Flagging query
        item_cand = re.sub(r"\b(?:flag|report\s+missing|report\s+empty|location\s+wrong|is\s+empty)\b", "", cleaned, flags=re.IGNORECASE).strip()
        return ParsedIntent(
            intent=ClinicalIntent.MUTATE_INVENTORY,
            confidence=0.92,
            entities=ClinicalEntities(
                item=item_cand,
                action="flag",
            ),
            raw_query=query,
            normalized_query=normalized_query,
            spoken_transcript_correction=correction,
        )

    # 3. Check VIEW_PREFERENCE_CARD intent
    pref_match = PREFERENCE_CARD_PATTERNS.search(cleaned)
    if pref_match:
        surgeon = None
        surg_match = re.search(r"\b(?:dr\.?|doctor)\s+([a-zA-Z]+)\b", cleaned, re.IGNORECASE)
        if surg_match:
            surgeon = f"Dr. {surg_match.group(1).capitalize()}"

        proc = None
        for p in ["lap chole", "cholecystectomy", "total knee", "knee arthroplasty", "cabg", "prostatectomy", "ralp", "discectomy"]:
            if p in cleaned.lower():
                proc = p
                break

        return ParsedIntent(
            intent=ClinicalIntent.VIEW_PREFERENCE_CARD,
            confidence=0.95,
            entities=ClinicalEntities(
                surgeon=surgeon,
                procedure=proc,
                action="view_card",
            ),
            raw_query=query,
            normalized_query=normalized_query,
            spoken_transcript_correction=correction,
        )

    # 4. Check GENERAL_QUERY (procedural protocols, orientation, role definitions)
    if GENERAL_QUERY_PATTERNS.search(cleaned):
        return ParsedIntent(
            intent=ClinicalIntent.GENERAL_QUERY,
            confidence=0.90,
            entities=ClinicalEntities(),
            raw_query=query,
            normalized_query=normalized_query,
            spoken_transcript_correction=correction,
        )

    # 5. Default to FIND_INVENTORY (lookups, coordinates)
    # Extract gauge and check for suture family disambiguation
    gauge_match = re.search(r"\b(\d+[\-/]0|0)\b", normalized_query)
    gauge_val = gauge_match.group(1).replace("/", "-") if gauge_match else None

    # Check for suture family without gauge:
    disambiguation: list[str] = []
    for fam in COMMON_SUTURE_FAMILIES:
        if re.search(rf"\b{fam}\b", normalized_query, re.IGNORECASE):
            if not gauge_val:
                # User asked for "Vicryl", "Prolene", "Silk" without a gauge
                disambiguation = ["0", "2-0", "3-0", "4-0", "5-0"]
            break

    # Extract target item
    item_part = re.sub(
        r"^(?:where\s+(?:is|are|can\s+i\s+find|do\s+we\s+keep)\s+(?:the\s+|a\s+|an\s+)?|"
        r"(?:can\s+you\s+)?(?:find|locate|get|grab|show)\s+(?:me\s+)?(?:the\s+|a\s+|an\s+)?|"
        r"(?:i\s+)?(?:need|want|looking\s+for)\s+(?:the\s+|a\s+|an\s+)?|"
        r"do\s+we\s+have\s+(?:any\s+|a\s+|an\s+)?)+",
        "",
        cleaned,
        flags=re.IGNORECASE,
    ).strip()

    return ParsedIntent(
        intent=ClinicalIntent.FIND_INVENTORY,
        confidence=0.94,
        entities=ClinicalEntities(
            item=item_part or cleaned,
            gauge=gauge_val,
        ),
        raw_query=query,
        normalized_query=normalized_query,
        spoken_transcript_correction=correction,
        disambiguation_options=disambiguation,
    )
