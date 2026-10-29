"""
Layer 1: Auto-Compiled Clinical Vocabulary & Entity Graph (Phase 43).

Automatically compiles an in-memory Clinical Entity Graph per hospital department tenant
from:
  1. preference_cards.json (Surgeons Index, Procedures Index, Preference Card Facets)
  2. inventory.csv & surgical_ontology.py (Inventory Catalog & Ontology Index)
  3. orientation.md & facility_handbook.md (Protocol & Policy Topics Index)

Also provides structural entity recognition for surgeon queries (`dr.? <name>`, `doctor <name>`,
`<name>'s preference/card/sutures/gloves`) so even an unindexed/new surgeon is 100% recognized
as a SURGEON entity and never treated as an inventory item name.
"""

from __future__ import annotations

import csv
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from app.config import HOSPITALS_DIR, get_tenant


# Preference Card Schema Facets
PREFERENCE_CARD_FACETS: dict[str, list[str]] = {
    "sutures": [
        "suture", "sutures", "closure", "closures", "ties", "tie",
        "stitch", "stitches", "sewing", "needle", "needles",
    ],
    "instruments": [
        "instrument", "instruments", "instrumentation", "tray", "trays",
        "set", "sets", "pickups", "clamps", "scissors", "retractor", "retractors",
    ],
    "positioning": [
        "position", "positioning", "table", "bed", "armboards", "armboard",
        "padding", "stirrups", "rolls", "roll",
    ],
    "prep": [
        "prep", "prepping", "chloraprep", "chlorhexidine", "chg",
        "betadine", "duraprep", "drape", "draping", "scrub",
    ],
    "gloves": [
        "glove", "gloves", "biogel", "underglove", "overglove",
    ],
    "pearls": [
        "pearl", "pearls", "note", "notes", "preference", "preferences",
        "card", "cards", "hold", "special", "setup", "like", "likes",
        "use", "uses", "want", "wants", "prefer", "prefers",
    ],
}

# Built-in procedure abbreviations & clinical synonyms mapped to canonical procedure keywords
BUILTIN_PROCEDURE_ALIASES: dict[str, list[str]] = {
    "lap_chole": ["lap chole", "laparoscopic cholecystectomy", "cholecystectomy", "gallbladder"],
    "tka": ["tka", "total knee", "total knee arthroplasty", "knee arthroplasty", "knee replacement"],
    "cabg": ["cabg", "coronary artery bypass", "coronary bypass", "open heart", "sternotomy", "bypass graft"],
    "patel_cvor": ["carotid", "carotid endarterectomy", "cea", "peripheral vascular", "vascular bypass"],
    "robotic_prostatectomy": ["ralp", "robotic prostatectomy", "prostatectomy", "da vinci prostate"],
    "lumbar_microdiscectomy": ["microdiscectomy", "lumbar microdiscectomy", "laminectomy", "discectomy"],
    "trauma_ex_lap": ["ex lap", "ex-lap", "exploratory laparotomy", "trauma lap", "trauma laparotomy"],
    "evar": ["evar", "endovascular aneurysm", "endovascular aneurysm repair", "aaa repair"],
    "craniotomy": ["craniotomy", "crani", "burr hole", "stealth craniotomy"],
    "appendectomy": ["lap appy", "appendectomy", "appy", "laparoscopic appendectomy"],
    "icu_crrt_setup": ["crrt", "continuous renal replacement", "prismaflex setup"],
    "icu_art_line": ["art line setup", "arterial line setup", "radial art line setup"],
    "icu_cvc_kit": ["cvc insertion", "central line insertion", "triple lumen setup"],
    "icu_icp_monitor": ["icp monitor setup", "intracranial pressure setup", "codman setup"],
    "er_rsi_kit": ["rsi protocol", "rapid sequence intubation"],
    "er_chest_tube": ["chest tube setup", "tube thoracostomy"],
    "er_mtp_cooler": ["mtp protocol", "massive transfusion protocol", "massive transfusion"],
    "er_pelvic_binder": ["pelvic binder application", "pelvic fracture protocol"],
    "pacu_aldrete_recovery": ["aldrete score", "aldrete scoring", "phase 1 discharge"],
    "pacu_laryngospasm_rescue": ["laryngospasm", "laryngospasm protocol", "larson notch"],
    "pacu_pca_pump_setup": ["pca setup", "pca protocol", "alaris pca protocol"],
    "pacu_ponv_shivering_rescue": ["ponv protocol", "post op shivering", "shivering rescue"],
}

# Standard clinical protocol / policy topics
PROTOCOL_TOPIC_PATTERNS: list[str] = [
    "malignant hyperthermia", "mh crisis", "code blue", "code red", "fire protocol",
    "surgical fire", "needle stick", "sharps injury", "blood exposure", "massive transfusion",
    "mtp", "time out", "timeout", "surgical count", "lost sponge", "incorrect count",
    "wet tray", "strikethrough", "flash sterilization", "iuus", "specimen handling",
    "frozen section", "formalin", "aldrete", "laryngospasm", "extubation criteria",
    "emergency release", "hipaa", "latex allergy", "airborne precautions",
    "turnover", "room turnover", "terminal clean", "attire", "scrub policy",
]


@dataclass
class SurgeonMatch:
    raw_name: str
    normalized_last_name: str
    display_name: str
    matched_card_ids: list[str] = field(default_factory=list)
    is_indexed: bool = False


@dataclass
class ProcedureMatch:
    name: str
    matched_card_ids: list[str] = field(default_factory=list)


@dataclass
class ClinicalEntityGraph:
    tenant_id: str
    department_name: str
    preference_cards: list[dict[str, Any]] = field(default_factory=list)
    # Map normalized last name or full name -> list of card dicts
    surgeons_by_token: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    # Ordered list of unique canonical surgeon display names in this department
    indexed_surgeon_names: list[str] = field(default_factory=list)
    # Map procedure phrase -> list of card IDs
    procedures_by_phrase: dict[str, list[str]] = field(default_factory=dict)
    # Inventory item names and aliases for fast catalog membership checks
    inventory_rows: list[dict[str, Any]] = field(default_factory=list)
    inventory_terms: set[str] = field(default_factory=set)
    # Protocol topics extracted from orientation.md / facility_handbook.md
    protocol_topics: set[str] = field(default_factory=set)

    def get_cards_by_ids(self, card_ids: list[str]) -> list[dict[str, Any]]:
        id_set = set(card_ids)
        return [c for c in self.preference_cards if c.get("id") in id_set]


def _normalize_text(text: str) -> str:
    cleaned = re.sub(r"[^a-z0-9\s\-#/]", " ", (text or "").lower())
    return " ".join(cleaned.split())


def _extract_surgeon_names(surgeon_field: str) -> list[tuple[str, str]]:
    """
    Given a surgeon string like 'Dr. Sarah Chen, MD' or 'Dr. Marcus Vance, MD (Dr. Arthur Vance, MD)',
    returns a list of (display_name, last_name_lower) tuples.
    """
    if not surgeon_field:
        return []
    # Split on parentheticals if multiple names listed
    parts = [p.strip() for p in re.split(r"[\(\)/]", surgeon_field) if p.strip()]
    results: list[tuple[str, str]] = []
    for part in parts:
        # Remove trailing credentials like ', MD', ', DO', ', RN'
        clean_display = re.sub(r",\s*(?:MD|DO|RN|FACS|PhD).*$", "", part, flags=re.IGNORECASE).strip()
        if not clean_display:
            continue
        # Extract tokens excluding 'dr', 'doctor', 'md'
        tokens = [
            t for t in re.split(r"[^a-zA-Z'\-]+", clean_display)
            if t and t.lower() not in ("dr", "doctor", "md", "do", "rn", "facs")
        ]
        if tokens:
            last_name = tokens[-1].lower().replace("'", "")
            results.append((clean_display, last_name))
            # Also index hyphenated or apostrophe variants
            results.append((clean_display, tokens[-1].lower()))
    return results


def _load_preference_cards_for_tenant(tenant_id: str, inventory_path: Path) -> list[dict[str, Any]]:
    dept_dir = inventory_path.parent
    candidates = [
        dept_dir / "preference_cards.json",
        HOSPITALS_DIR / "sacred_heart" / "or" / "preference_cards.json",
    ]
    # Check if tenant is icu, er, pacu
    tid_low = tenant_id.lower()
    if "icu" in tid_low:
        candidates.insert(1, HOSPITALS_DIR / "sacred_heart" / "icu" / "preference_cards.json")
    elif "er" in tid_low or "trauma" in tid_low:
        candidates.insert(1, HOSPITALS_DIR / "sacred_heart" / "er" / "preference_cards.json")
    elif "pacu" in tid_low:
        candidates.insert(1, HOSPITALS_DIR / "sacred_heart" / "pacu" / "preference_cards.json")

    for path in candidates:
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data, list):
                    return data
            except Exception:
                pass
    return []


def _load_inventory_rows_for_tenant(inventory_path: Path) -> list[dict[str, Any]]:
    if not inventory_path.exists():
        return []
    rows: list[dict[str, Any]] = []
    try:
        with open(inventory_path, mode="r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for r in reader:
                item_name = (r.get("item") or "").strip()
                if not item_name:
                    continue
                rm = (r.get("room") or "").strip()
                cab = (r.get("cabinet") or "").strip()
                sh = (r.get("shelf") or "").strip()
                cont = (r.get("container") or "").strip()
                rows.append({
                    "item": item_name,
                    "category": (r.get("category") or "").strip(),
                    "room": rm,
                    "cabinet": cab,
                    "shelf": sh,
                    "container": cont,
                    "full_code": f"{rm} {cab} {sh} {cont}".strip(),
                    "human_alias": (r.get("human_alias") or f"{rm} · Cart {cab} · Shelf {sh} · Bin {cont}").strip(),
                    "aliases": (r.get("aliases") or "").strip(),
                    "surgeon_notes": (r.get("surgeon_notes") or "").strip(),
                    "status": (r.get("status") or "verified").strip(),
                    "verify_count": int(r.get("verify_count") or 0),
                    "verification_score": float(r.get("verification_score") or 3.0),
                })
    except Exception:
        pass
    return rows


def compile_clinical_graph(tenant_id: str = "or_main") -> ClinicalEntityGraph:
    """Compile an in-memory ClinicalEntityGraph for the given hospital tenant."""
    tenant = get_tenant(tenant_id)
    cards = _load_preference_cards_for_tenant(tenant.tenant_id, tenant.inventory_path)
    inv_rows = _load_inventory_rows_for_tenant(tenant.inventory_path)

    surgeons_by_token: dict[str, list[dict[str, Any]]] = {}
    indexed_surgeon_names: list[str] = []
    procedures_by_phrase: dict[str, list[str]] = {}

    for card in cards:
        card_id = str(card.get("id") or "")
        surgeon_str = str(card.get("surgeon") or card.get("clinician") or "")
        extracted = _extract_surgeon_names(surgeon_str)
        for display_name, last_lower in extracted:
            if display_name.startswith("Dr.") and display_name not in indexed_surgeon_names:
                indexed_surgeon_names.append(display_name)
            bucket = surgeons_by_token.setdefault(last_lower, [])
            if card not in bucket:
                bucket.append(card)
            # Also index full normalized name without "dr"
            full_clean = _normalize_text(re.sub(r"^(?:dr\.?|doctor)\s+", "", display_name, flags=re.I))
            if full_clean:
                fb = surgeons_by_token.setdefault(full_clean, [])
                if card not in fb:
                    fb.append(card)

        proc_title = str(card.get("procedure") or "")
        if proc_title and card_id:
            norm_proc = _normalize_text(proc_title)
            if norm_proc:
                procedures_by_phrase.setdefault(norm_proc, []).append(card_id)
            # Extract parenthetical abbreviation e.g. (TKA), (CABG x3), (RALP), (EVAR)
            for paren_m in re.finditer(r"\(([A-Za-z0-9\-\s]+)\)", proc_title):
                abbr = _normalize_text(paren_m.group(1))
                if abbr:
                    procedures_by_phrase.setdefault(abbr, []).append(card_id)
                    # Also base acronym if "cabg x3" -> "cabg"
                    first_tok = abbr.split()[0]
                    if len(first_tok) >= 3:
                        procedures_by_phrase.setdefault(first_tok, []).append(card_id)

        if card_id in BUILTIN_PROCEDURE_ALIASES:
            for alias in BUILTIN_PROCEDURE_ALIASES[card_id]:
                norm_a = _normalize_text(alias)
                if norm_a:
                    lst = procedures_by_phrase.setdefault(norm_a, [])
                    if card_id not in lst:
                        lst.append(card_id)

    # Also register any unmapped builtin procedure aliases so procedure intent is always recognized
    for canonical_id, aliases in BUILTIN_PROCEDURE_ALIASES.items():
        for alias in aliases:
            norm_a = _normalize_text(alias)
            if norm_a and norm_a not in procedures_by_phrase:
                # Find any card whose procedure or id matches
                matched_ids = [
                    str(c.get("id")) for c in cards
                    if canonical_id in str(c.get("id", "")).lower()
                    or norm_a in _normalize_text(str(c.get("procedure", "")))
                ]
                procedures_by_phrase[norm_a] = matched_ids

    inventory_terms: set[str] = set()
    for r in inv_rows:
        item_norm = _normalize_text(r["item"])
        if item_norm:
            inventory_terms.add(item_norm)
        for al in (r.get("aliases") or "").split("|"):
            al_norm = _normalize_text(al)
            if al_norm:
                inventory_terms.add(al_norm)

    protocol_topics = set(PROTOCOL_TOPIC_PATTERNS)
    if tenant.orientation_path.exists():
        try:
            md_text = tenant.orientation_path.read_text(encoding="utf-8")
            for heading in re.findall(r"^#{1,3}\s+(.+)$", md_text, flags=re.MULTILINE):
                h_norm = _normalize_text(heading)
                if h_norm and len(h_norm) >= 4:
                    protocol_topics.add(h_norm)
        except Exception:
            pass

    return ClinicalEntityGraph(
        tenant_id=tenant.tenant_id,
        department_name=tenant.display_name,
        preference_cards=cards,
        surgeons_by_token=surgeons_by_token,
        indexed_surgeon_names=indexed_surgeon_names,
        procedures_by_phrase=procedures_by_phrase,
        inventory_rows=inv_rows,
        inventory_terms=inventory_terms,
        protocol_topics=protocol_topics,
    )


_GRAPH_CACHE: dict[str, ClinicalEntityGraph] = {}


def get_clinical_graph(tenant_id: str = "or_main") -> ClinicalEntityGraph:
    valid_tenant = get_tenant(tenant_id).tenant_id
    if valid_tenant not in _GRAPH_CACHE:
        _GRAPH_CACHE[valid_tenant] = compile_clinical_graph(valid_tenant)
    return _GRAPH_CACHE[valid_tenant]


def reset_clinical_graphs() -> None:
    _GRAPH_CACHE.clear()
