"""
Phase 38: Master Surgical Ontology Engine & Strict Eponym Guard.

Eliminates dangerous false positives between surgical instruments:
- Maps OR lingo/slang to canonical instruments (pickups -> forceps, metz -> metzenbaum scissors, snaps -> hemostat, etc.).
- Eponym Registry: Distinguishes eponymous specifiers (Adson, DeBakey, Gerald, Russian, Metzenbaum, Mayo, etc.).
- Generic Class Words: Generic words (forceps, scissors, clamp, retractor) alone cannot trigger matches.
- Strict Eponym Guard: If query specifies an eponym, any candidate with a different (or missing) eponym is vetoed (score = 0).
- Acoustic/STT Map: Fixes common speech-to-text mishearings ("add son" -> "adson", "the bakey" -> "debakey", etc.).
"""

import re
from typing import Set, Tuple, Optional

# ---------------------------------------------------------------------------
# 1. OR Lingo & Slang Equivalence Map
# ---------------------------------------------------------------------------
OR_LINGO_EQUIVALENCE = {
    "pickups": "forceps",
    "pickup": "forceps",
    "metz": "metzenbaum scissors",
    "snaps": "crile hemostat clamp",
    "snap": "crile hemostat clamp",
    "hemostat": "hemostat clamp",
    "peanut": "kittner dissector sponge",
    "peanuts": "kittner dissector sponge",
    "cherry": "kittner dissector sponge",
    "cherries": "kittner dissector sponge",
    "raytec": "ray-tec sponge",
    "ray-tec": "ray-tec sponge",
    "ray tec": "ray-tec sponge",
    "raytech": "ray-tec sponge",
    "ratec": "ray-tec sponge",
    "lap": "laparotomy sponge",
    "laps": "laparotomy sponge",
    "lap sponge": "laparotomy sponge",
    "lap sponges": "laparotomy sponge",
    "cottonoid": "neurosurgical cottonoid patties",
    "cottonoids": "neurosurgical cottonoid patties",
    "patties": "neurosurgical cottonoid patties",
    "patty": "neurosurgical cottonoid patties",
    "bovie": "electrosurgical bovie pencil",
    "castro": "castroviejo needle holder",
    "right angle": "mixter right-angle clamp",
    "right-angle": "mixter right-angle clamp",
    "rightangle": "mixter right-angle clamp",
    "tonsil": "schnidt tonsil clamp",
    "tonsil snap": "schnidt tonsil clamp",
    "army navy": "army-navy retractor",
    "army-navy": "army-navy retractor",
    "us army": "army-navy retractor",
    "rich": "richardson retractor",
    "richardson": "richardson retractor",
    "malleable": "malleable ribbon retractor",
    "ribbon": "malleable ribbon retractor",
    "cat paw": "senn retractor",
    "cats paw": "senn retractor",
    "cat's paw": "senn retractor",
    "bookwalter": "bookwalter retractor",
    "omni": "omni-tract retractor",
    "omni tract": "omni-tract retractor",
    "omnitract": "omni-tract retractor",
    "balfour": "balfour retractor",
    "finochietto": "finochietto rib spreader",
    "sweetheart": "harrington sweetheart retractor",
    "kerrison": "kerrison rongeur",
    "leksell": "leksell rongeur",
    "pituitary": "pituitary rongeur",
    "cobb": "cobb elevator",
    "freer": "freer elevator",
    "penfield": "penfield dissector",
    "yankauer": "yankauer suction",
    "frazier": "frazier suction",
    "poole": "poole suction",
    "vein retractor": "weitlaner retractor",
    "saphenous retractor": "weitlaner retractor",
}

# ---------------------------------------------------------------------------
# 2. Master Surgical Eponym Registry
# ---------------------------------------------------------------------------
# Distinguishing named specifiers in surgery. If a query contains one of these,
# candidates with a different eponym are strictly vetoed.
SURGICAL_EPONYMS: Set[str] = {
    # Tissue Forceps / Pickups
    "adson",
    "brown-adson",
    "debakey",
    "gerald",
    "russian",
    "ferris-smith",
    "bonney",
    "potts-smith",
    "cushing",
    "singley",
    "bipolar",
    "bayonet",
    # Scissors
    "metzenbaum",
    "mayo",
    "iris",
    "tenotomy",
    "stevens",
    "jorgenson",
    "lister",
    "potts",
    # Clamps & Hemostats
    "mosquito",
    "halsted",
    "crile",
    "kelly",
    "pean",
    "rochester-pean",
    "kocher",
    "ochsner",
    "allis",
    "babcock",
    "mixter",
    "schnidt",
    "heaney",
    "satinsky",
    "cooley",
    "fogarty",
    "bulldog",
    "glover",
    "crafoord",
    "dandy",
    # Needle Holders / Drivers
    "mayo-hegar",
    "crile-wood",
    "ryder",
    "castroviejo",
    "webster",
    "baumgartner",
    "olsen-hegar",
    # Retractors
    "army-navy",
    "senn",
    "richardson",
    "richardson-eastman",
    "deaver",
    "weitlaner",
    "gelpi",
    "bookwalter",
    "omni-tract",
    "balfour",
    "finochietto",
    "harrington",
    "green",
    "beckman",
    "jansen",
    "mastoid",
    "langenbeck",
    "volkmann",
    "ragnell",
    # Rongeurs, Bone, & Elevators
    "kerrison",
    "leksell",
    "ruskin",
    "stille-luer",
    "pituitary",
    "love-gruenwald",
    "spurling",
    "cobb",
    "freer",
    "penfield",
    "lambotte",
    "brun",
    "key",
    # Sponges, Suctions & Dissectors
    "kittner",
    "ray-tec",
    "yankauer",
    "frazier",
    "poole",
    "barron",
    "andrews-pynchon",
}

# ---------------------------------------------------------------------------
# 3. Generic Instrument Class Words
# ---------------------------------------------------------------------------
# Words that describe an instrument category but NOT its specific type.
# A query cannot match an inventory row solely on these words.
GENERIC_INSTRUMENT_CLASSES: Set[str] = {
    "forceps",
    "pickup",
    "pickups",
    "scissor",
    "scissors",
    "clamp",
    "clamps",
    "hemostat",
    "hemostats",
    "snap",
    "snaps",
    "retractor",
    "retractors",
    "needle holder",
    "needle driver",
    "needle-holder",
    "needle-driver",
    "driver",
    "drivers",
    "holder",
    "holders",
    "sponge",
    "sponges",
    "suction",
    "suctions",
    "tube",
    "tubes",
    "tip",
    "tips",
    "wand",
    "wands",
    "rongeur",
    "rongeurs",
    "elevator",
    "elevators",
    "dissector",
    "dissectors",
    "spreader",
    "spreaders",
    "curette",
    "curettes",
    "osteotome",
    "osteotomes",
    "chisel",
    "chisels",
    "punch",
    "punches",
    "hook",
    "hooks",
    "probe",
    "probes",
    "speculum",
    "speculums",
    "cannula",
    "cannulas",
    "wire",
    "wires",
    "knife",
    "blade",
    "blades",
    "saw",
    "saws",
    "drill",
    "drills",
    "instrument",
    "instruments",
    "tray",
    "trays",
}

# ---------------------------------------------------------------------------
# 4. Phonetic & STT Mishearing Map (Voice Biasing)
# ---------------------------------------------------------------------------
EPONYM_PHONETIC_STT_MAP = {
    "add son": "adson",
    "ad son": "adson",
    "at son": "adson",
    "atson": "adson",
    "ad son's": "adson",
    "adsons": "adson",
    "the bakey": "debakey",
    "the bake": "debakey",
    "the bake e": "debakey",
    "de bacey": "debakey",
    "dee bakey": "debakey",
    "dee bake e": "debakey",
    "debakeys": "debakey",
    "bakery": "debakey",
    "geralt": "gerald",
    "gerold": "gerald",
    "metz in bomb": "metzenbaum",
    "metzen bomb": "metzenbaum",
    "metzen baum": "metzenbaum",
    "mets": "metz",
    "casting": "castroviejo",
    "castro viejo": "castroviejo",
    "castro vie ho": "castroviejo",
    "carry son": "kerrison",
    "kerr ison": "kerrison",
    "lexel": "leksell",
    "lex ell": "leksell",
    "white laner": "weitlaner",
    "white liner": "weitlaner",
    "white lainer": "weitlaner",
    "gel py": "gelpi",
    "gel pee": "gelpi",
    "book walter": "bookwalter",
    "fino ketto": "finochietto",
    "fino chetto": "finochietto",
    "kit ner": "kittner",
    "kitner": "kittner",
    "kitners": "kittner",
    "ray tec": "ray-tec",
    "raytech": "ray-tec",
    "ratec": "ray-tec",
    "yank our": "yankauer",
    "yank hour": "yankauer",
    "yank tower": "yankauer",
    "frasier": "frazier",
    "frazer": "frazier",
    "pool suction": "poole suction",
    "cool ey": "cooley",
    "sat in ski": "satinsky",
    "satinski": "satinsky",
    "richard son": "richardson",
    "koch er": "kocher",
    "coker": "kocher",
    "cry le": "crile",
    "cryle": "crile",
    "alliss": "allis",
    "bab cock": "babcock",
    "babcok": "babcock",
    "bovey": "bovie",
    "bo vie": "bovie",
    "heprin": "heparin",
    "proline": "prolene",
    "pro lean": "prolene",
    "mono cryl": "monocryl",
    "vye cril": "vicryl",
    "tie cron": "ti-cron",
    "ticron": "ti-cron",
}

_STOP_WORDS = {
    "where", "is", "are", "the", "a", "an", "find", "locate", "need",
    "get", "me", "do", "we", "have", "keep", "stored", "stocked",
    "show", "location", "of", "for", "in", "from", "please", "can",
    "you", "tell", "whats", "what", "give", "bring", "grab", "hand",
}

# ---------------------------------------------------------------------------
# 5. Core Ontology Engine Functions
# ---------------------------------------------------------------------------

def normalize_or_lingo(text: str) -> str:
    """
    Rewrite speech-to-text acoustic mishearings and OR slang into canonical medical terminology.
    e.g. 'ad son pickups' -> 'adson forceps'
         'the bakey pickups' -> 'debakey forceps'
         'metz' -> 'metzenbaum scissors'
         'snaps' -> 'crile hemostat clamp'
         'peanut' -> 'kittner dissector sponge'
    """
    if not text:
        return ""
    res = text.lower().strip()

    # 1. Phonetic STT Mishearings (longest keys first)
    for err, canonical in sorted(EPONYM_PHONETIC_STT_MAP.items(), key=lambda kv: len(kv[0]), reverse=True):
        pattern = re.compile(r"(?<!\w)" + re.escape(err) + r"(?!\w)", re.IGNORECASE)
        res = pattern.sub(canonical, res)

    # 2. OR Lingo / Slang Substitutions (longest keys first)
    for slang, standard in sorted(OR_LINGO_EQUIVALENCE.items(), key=lambda kv: len(kv[0]), reverse=True):
        pattern = re.compile(r"(?<!\w)" + re.escape(slang) + r"(?!\w)", re.IGNORECASE)
        res = pattern.sub(standard, res)

    # Clean double spaces
    return re.sub(r"\s+", " ", res).strip()


def extract_eponyms(text: str) -> Set[str]:
    """
    Extract any surgical eponyms present in the text, handling compound hyphenated names.
    e.g. 'Brown-Adson pickups' -> {'brown-adson'}
         'Adson 1x2 forceps' -> {'adson'}
         'DeBakey Forceps' -> {'debakey'}
         'Mayo-Hegar needle driver' -> {'mayo-hegar'}
    """
    if not text:
        return set()

    lowered = text.lower()
    # Replace space in compound eponyms so they are treated as single tokens
    lowered = re.sub(r"\bbrown\s+adson\b", "brown-adson", lowered)
    lowered = re.sub(r"\barmy\s+navy\b", "army-navy", lowered)
    lowered = re.sub(r"\bmayo\s+hegar\b", "mayo-hegar", lowered)
    lowered = re.sub(r"\bcrile\s+wood\b", "crile-wood", lowered)
    lowered = re.sub(r"\bferris\s+smith\b", "ferris-smith", lowered)
    lowered = re.sub(r"\bpotts\s+smith\b", "potts-smith", lowered)
    lowered = re.sub(r"\brochester\s+pean\b", "rochester-pean", lowered)
    lowered = re.sub(r"\bomni\s+tract\b", "omni-tract", lowered)
    lowered = re.sub(r"\brichardson\s+eastman\b", "richardson-eastman", lowered)
    lowered = re.sub(r"\bray\s+tec\b", "ray-tec", lowered)

    found: Set[str] = set()
    # Check compound eponyms first
    for ep in sorted(SURGICAL_EPONYMS, key=lambda s: len(s), reverse=True):
        pattern = re.compile(r"(?<!\w)" + re.escape(ep) + r"(?!\w)", re.IGNORECASE)
        if pattern.search(lowered):
            # If compound matched (e.g. brown-adson), do not add single parts (adson)
            if any(ep in c and ep != c for c in found):
                continue
            found.add(ep)

    # Also resolve slang that implies an eponym
    for word in lowered.split():
        clean_word = re.sub(r"[^a-z0-9-]", "", word)
        if clean_word == "metz":
            found.add("metzenbaum")
        elif clean_word == "castro":
            found.add("castroviejo")
        elif clean_word in ("peanut", "peanuts", "cherry"):
            found.add("kittner")
        elif clean_word == "snaps":
            found.add("crile")
        elif clean_word == "rich":
            found.add("richardson")

    return found


def is_generic_class_only(text: str) -> bool:
    """
    Return True if the text contains ONLY generic instrument class words and stop words.
    e.g. 'forceps' -> True, 'pickups' -> True, 'scissors' -> True
         'adson pickups' -> False, '4-0 prolene' -> False
    """
    if not text:
        return False
    norm = normalize_or_lingo(text).lower()
    tokens = [t for t in re.findall(r"[a-z0-9-]+", norm) if t not in _STOP_WORDS]
    if not tokens:
        return False
    # If all tokens belong to GENERIC_INSTRUMENT_CLASSES
    return all(t in GENERIC_INSTRUMENT_CLASSES for t in tokens)


def is_eponym_conflict(query: str, candidate_text: str) -> bool:
    """
    Strict Eponym & Generic Guard:
    Returns True if:
      1. Query contains a surgical eponym Eq and candidate has a DIFFERENT eponym Er (Eq != Er).
      2. Query explicitly requests an eponymous instrument (e.g. 'Adson pickups'),
         and candidate has NO eponym (e.g. 'Tissue Forceps' or generic 'Forceps').
      3. Query contains non-generic modifier words (e.g. 'unobtanium laser forceps')
         and NONE of those non-generic words match the candidate — meaning candidate
         would match purely on the generic class word ('forceps').
    """
    if not query or not candidate_text:
        return False

    q_norm = normalize_or_lingo(query)
    c_norm = normalize_or_lingo(candidate_text)

    q_eponyms = extract_eponyms(q_norm)
    c_eponyms = extract_eponyms(c_norm)

    # Rule 1 & 2: Query has an eponym
    if q_eponyms:
        # If candidate has a different eponym or no eponym at all -> CONFLICT!
        if not (q_eponyms & c_eponyms):
            return True
        return False

    # Rule 3: Query does NOT have an eponym, but contains non-generic words
    # e.g. "unobtanium laser forceps"
    q_tokens = set(re.findall(r"[a-z0-9-]+", q_norm)) - _STOP_WORDS
    non_generic_q_tokens = {t for t in q_tokens if t not in GENERIC_INSTRUMENT_CLASSES}

    if non_generic_q_tokens:
        c_tokens = set(re.findall(r"[a-z0-9-]+", c_norm))
        # If none of the distinguishing non-generic tokens match candidate:
        if not (non_generic_q_tokens & c_tokens):
            return True

    return False
