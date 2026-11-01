"""
Layer 2 & Layer 3: Unified Clinical Query Planner & Relational Execution Engine (Phase 43).

Replaces ad-hoc regex routing with a deterministic 3-Layer Clinical Query Planner:
- Decomposes every clinical utterance into structured entities:
  - `surgeon`: matched or unindexed surgeon entity (`Dr. Patel`, `Dr. Chen`, `Dr. Unknown`)
  - `procedure`: matched surgical procedure (`CABG`, `Lap Chole`, `TKA`, `EVAR`, etc.)
  - `card_facet`: requested preference card section (`sutures`, `instruments`, `positioning`, `prep`, `gloves`, `pearls`, `all`)
  - `inventory_candidate_terms`: clean physical item terms stripped of surgeon/procedure/locative framing
  - `has_explicit_locative`: whether the clinician explicitly asked `where is / locate / find`
- Deterministically classifies `intent` into:
  - `PREFERENCE_CARD_LOOKUP`
  - `PREFERENCE_INVENTORY_JOIN`
  - `PROTOCOL_GUIDELINE_LOOKUP`
  - `INVENTORY_LOOKUP`
- Executes relational joins between Preference Cards (`preference_cards.json`) and live department
  inventory (`inventory.csv`) so surgeon suture/instrument preferences automatically surface
  exact `Room • Cabinet/Rack • Shelf • Bin` coordinates inline!
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal, Optional

from app.services.clinical_graph import (
    PREFERENCE_CARD_FACETS,
    ClinicalEntityGraph,
    ProcedureMatch,
    SurgeonMatch,
    get_clinical_graph,
)


ClinicalIntentType = Literal[
    "PREFERENCE_CARD_LOOKUP",
    "PREFERENCE_INVENTORY_JOIN",
    "INVENTORY_LOOKUP",
    "PROTOCOL_GUIDELINE_LOOKUP",
]

CardFacetType = Literal[
    "sutures",
    "instruments",
    "positioning",
    "prep",
    "gloves",
    "pearls",
    "all",
]


@dataclass
class ClinicalQueryPlan:
    raw_query: str
    intent: ClinicalIntentType
    surgeon: Optional[SurgeonMatch] = None
    procedure: Optional[ProcedureMatch] = None
    card_facet: Optional[CardFacetType] = None
    inventory_candidate_terms: list[str] = field(default_factory=list)
    has_explicit_locative: bool = False


# Structural regexes for Surgeon Entity extraction
_DR_PREFIX_RE = re.compile(
    r"\b(?:dr\.?|doctor)\s+([a-z][a-z'\-]+?)(?:'s)?(?:\s+([a-z][a-z'\-]+?)(?:'s)?)?\b",
    re.IGNORECASE,
)
_POSSESSIVE_SURGEON_RE = re.compile(
    r"\b([a-z][a-z'\-]+)'s\s+(?:preference|preferences|card|cards|suture|sutures|glove|gloves|position|positioning|prep|setup|tray|instruments?)\b",
    re.IGNORECASE,
)

# Common clinical/non-name words that could follow "dr." if someone misspoke or in compound tokens
_NON_SURGEON_NEXT_WORDS = {
    "suture", "sutures", "preference", "preferences", "card", "cards",
    "glove", "gloves", "size", "position", "positioning", "prep", "setup",
    "tray", "trays", "instrument", "instruments", "custom", "vascular",
    "stapler", "prolene", "vicryl", "silk", "monocryl", "ethibond", "pds",
    "ti-cron", "ticron", "debakey", "castroviejo", "weitlaner", "adson",
    "like", "likes", "use", "uses", "want", "wants", "prefer", "prefers",
    "for", "in", "on", "with", "and", "or", "the", "a", "an",
    "lap", "chole", "cabg", "tka", "ralp", "evar", "trauma", "ex",
}

_EXPLICIT_LOCATIVE_RE = re.compile(
    r"^\s*(?:where\s+(?:is|are|can\s+i\s+find|do\s+we\s+keep)|locate\b|location\s+of\b|find\b|which\s+(?:room|cart|cabinet|shelf|bin)\b)",
    re.IGNORECASE,
)

_QUESTION_FRAMING_NOISE_RE = re.compile(
    r"\b(?:what|which|where|how|who|when|is|are|was|were|do|does|did|can|could|should|would|"
    r"we|you|they|he|she|i|me|my|our|the|a|an|for|in|on|at|to|of|with|by|from|"
    r"like|likes|use|uses|using|want|wants|prefer|prefers|preferred|need|needs|take|takes|"
    r"keep|kept|stored|stocked|located|find|locate|show|tell|give|get|pull|grab|"
    r"size|kind|type|routine|standard|typical|usual)\b",
    re.IGNORECASE,
)


def _detect_surgeon_in_query(query: str, graph: ClinicalEntityGraph) -> tuple[Optional[SurgeonMatch], str]:
    """
    Detect a surgeon entity in `query` using both:
      1. Structural pattern (`dr. <name>`, `doctor <name>`, `<name>'s preference/card/...`)
      2. Direct lookup against `graph.surgeons_by_token` when accompanied by preference/procedure context.
    Returns `(SurgeonMatch | None, remaining_query_without_surgeon_span)`.
    """
    m = _DR_PREFIX_RE.search(query)
    if m:
        first_tok = m.group(1)
        second_tok = m.group(2)
        # Check if second_tok is actually a clinical/procedure/item word rather than a last name
        if second_tok and (
            second_tok.lower() in _NON_SURGEON_NEXT_WORDS
            or second_tok.lower() in graph.procedures_by_phrase
            or any(second_tok.lower() in syn_list for syn_list in PREFERENCE_CARD_FACETS.values())
        ):
            second_tok = None

        # Determine if first_tok or second_tok matches an indexed surgeon
        cand_last = (second_tok or first_tok).lower().replace("'", "")
        first_low = first_tok.lower().replace("'", "")

        matched_cards = (
            graph.surgeons_by_token.get(cand_last)
            or graph.surgeons_by_token.get(first_low)
            or []
        )
        # If first_tok matched directly and second_tok didn't, only consume first_tok!
        if not graph.surgeons_by_token.get(cand_last) and graph.surgeons_by_token.get(first_low):
            second_tok = None
            cand_last = first_low

        raw_surgeon_name = f"Dr. {first_tok.capitalize()}" + (f" {second_tok.capitalize()}" if second_tok else "")
        display_name = raw_surgeon_name
        if matched_cards:
            # Prefer canonical display name from card
            card_surg = str(matched_cards[0].get("surgeon") or "")
            if card_surg:
                display_name = re.sub(r",\s*(?:MD|DO).*$", "", card_surg.split("(")[0]).strip()

        # Strip only the matched Dr. + name tokens (plus optional possessive 's)
        pattern_to_strip = (
            r"\b(?:dr\.?|doctor)\s+"
            + re.escape(first_tok)
            + (r"\s+" + re.escape(second_tok) if second_tok else "")
            + r"(?:'s|\b)"
        )
        remaining = re.sub(pattern_to_strip, " ", query, count=1, flags=re.IGNORECASE)
        return (
            SurgeonMatch(
                raw_name=raw_surgeon_name,
                normalized_last_name=cand_last,
                display_name=display_name,
                matched_card_ids=[str(c.get("id")) for c in matched_cards if c.get("id")],
                is_indexed=len(matched_cards) > 0,
            ),
            remaining,
        )

    # Check `<name>'s preference/card/sutures...` without "Dr."
    m_poss = _POSSESSIVE_SURGEON_RE.search(query)
    if m_poss:
        name_tok = m_poss.group(1)
        last_low = name_tok.lower().replace("'", "")
        if last_low not in _NON_SURGEON_NEXT_WORDS:
            matched_cards = graph.surgeons_by_token.get(last_low, [])
            raw_surgeon_name = f"Dr. {name_tok.capitalize()}"
            display_name = raw_surgeon_name
            if matched_cards:
                card_surg = str(matched_cards[0].get("surgeon") or "")
                if card_surg:
                    display_name = re.sub(r",\s*(?:MD|DO).*$", "", card_surg.split("(")[0]).strip()
            remaining = re.sub(r"\b" + re.escape(name_tok) + r"'s\b", " ", query, count=1, flags=re.IGNORECASE)
            return (
                SurgeonMatch(
                    raw_name=raw_surgeon_name,
                    normalized_last_name=last_low,
                    display_name=display_name,
                    matched_card_ids=[str(c.get("id")) for c in matched_cards if c.get("id")],
                    is_indexed=len(matched_cards) > 0,
                ),
                remaining,
            )

    # Check bare indexed last name when query also mentions card/preference/facet
    q_low = query.lower()
    has_facet_or_card_word = any(
        re.search(r"\b" + re.escape(w) + r"\b", q_low)
        for facet_words in PREFERENCE_CARD_FACETS.values()
        for w in facet_words
    )
    if has_facet_or_card_word:
        for tok, cards in graph.surgeons_by_token.items():
            if len(tok) >= 4 and re.search(r"\b" + re.escape(tok) + r"(?:'s)?\b", q_low):
                card_surg = str(cards[0].get("surgeon") or "")
                display_name = re.sub(r",\s*(?:MD|DO).*$", "", card_surg.split("(")[0]).strip() or f"Dr. {tok.capitalize()}"
                remaining = re.sub(r"\b" + re.escape(tok) + r"(?:'s)?\b", " ", query, count=1, flags=re.IGNORECASE)
                return (
                    SurgeonMatch(
                        raw_name=display_name,
                        normalized_last_name=tok,
                        display_name=display_name,
                        matched_card_ids=[str(c.get("id")) for c in cards if c.get("id")],
                        is_indexed=True,
                    ),
                    remaining,
                )

    return None, query


def _detect_procedure_in_query(query: str, graph: ClinicalEntityGraph) -> tuple[Optional[ProcedureMatch], str]:
    """Detect a surgical procedure name or abbreviation in `query`."""
    q_norm = re.sub(r"[^a-z0-9\s\-]", " ", query.lower())
    q_norm = " ".join(q_norm.split())

    # Sort candidate phrases longest-first so "lap chole" matches before "chole"
    sorted_phrases = sorted(graph.procedures_by_phrase.keys(), key=len, reverse=True)
    for phrase in sorted_phrases:
        if len(phrase) < 3:
            continue
        pattern = r"\b" + re.escape(phrase) + r"\b"
        if re.search(pattern, q_norm):
            card_ids = graph.procedures_by_phrase.get(phrase, [])
            remaining = re.sub(pattern, " ", query, flags=re.IGNORECASE)
            return ProcedureMatch(name=phrase.upper() if len(phrase) <= 4 else phrase.title(), matched_card_ids=card_ids), remaining

    return None, query


def _detect_card_facet(query: str) -> tuple[Optional[CardFacetType], str]:
    """
    Detect if the query asks for a specific preference card section (`sutures`, `instruments`,
    `positioning`, `prep`, `gloves`, `pearls`, or `all`).
    """
    q_low = query.lower()
    remaining = query
    detected_specific: Optional[CardFacetType] = None

    # Check specific facets first (sutures, gloves, positioning, prep, instruments)
    priority_order: list[CardFacetType] = ["gloves", "positioning", "prep", "sutures", "instruments"]
    for facet_key in priority_order:
        keywords = PREFERENCE_CARD_FACETS[facet_key]
        for kw in keywords:
            pat = r"\b" + re.escape(kw) + r"\b"
            if re.search(pat, q_low):
                if detected_specific is None:
                    detected_specific = facet_key
                remaining = re.sub(pat, " ", remaining, flags=re.IGNORECASE)

    # Also strip general pearl/preference/card words
    has_general_card_word = False
    for kw in PREFERENCE_CARD_FACETS["pearls"]:
        pat = r"\b" + re.escape(kw) + r"\b"
        if re.search(pat, q_low):
            has_general_card_word = True
            remaining = re.sub(pat, " ", remaining, flags=re.IGNORECASE)

    # Notice: "glove size" -> "size" is part of glove size when gloves is detected
    if detected_specific == "gloves":
        remaining = re.sub(r"\bsize\b", " ", remaining, flags=re.IGNORECASE)

    if detected_specific:
        return detected_specific, remaining
    if has_general_card_word:
        return "all", remaining
    return None, remaining


def _extract_inventory_candidate_terms(remaining_query: str) -> list[str]:
    """
    Clean remaining query after stripping surgeon, procedure, facet keywords, and question framing
    to see if a specific physical inventory item (e.g. `prolene`, `custom vascular stapler`, `debakey`)
    remains.
    """
    cleaned = re.sub(r"^\s*(?:where\s+(?:is|are|can\s+i\s+find|do\s+we\s+keep)|locate|location\s+of|find)\b", " ", remaining_query, flags=re.IGNORECASE)
    cleaned = _QUESTION_FRAMING_NOISE_RE.sub(" ", cleaned)
    cleaned = re.sub(r"[^a-zA-Z0-9\s\-#/\.]", " ", cleaned)
    cleaned = " ".join(cleaned.split()).strip()
    if not cleaned or len(cleaned) < 2:
        return []
    return [cleaned]


def plan_clinical_query(query: str, graph: Optional[ClinicalEntityGraph] = None, tenant_id: str = "or_main") -> ClinicalQueryPlan:
    """
    Layer 2: Deterministically decompose a clinical query into a `ClinicalQueryPlan`.
    """
    if query is not None and not isinstance(query, str):
        raise ValueError(f"Expected query to be a string, got {type(query)}")

    if graph is None:
        graph = get_clinical_graph(tenant_id)

    raw_query = (query or "").strip()
    if not raw_query:
        return ClinicalQueryPlan(raw_query="", intent="INVENTORY_LOOKUP")

    has_explicit_locative = bool(_EXPLICIT_LOCATIVE_RE.search(raw_query))

    # 1. Extract Surgeon Entity
    surgeon, rem_after_surgeon = _detect_surgeon_in_query(raw_query, graph)

    # 2. Extract Procedure Entity
    procedure, rem_after_proc = _detect_procedure_in_query(rem_after_surgeon, graph)

    # 3. Extract Preference Card Facet
    # Wait: before stripping facet words like "suture" or "stapler", check if there is a specific
    # suture material / gauge or specific instrument in rem_after_proc!
    # E.g. "where is 3-0 prolene suture" -> no surgeon, no procedure -> pure INVENTORY_LOOKUP!
    # E.g. "what size prolene does dr chen use for cabg" -> surgeon=Dr. Chen, procedure=CABG, candidate="prolene"
    card_facet, rem_after_facet = _detect_card_facet(rem_after_proc)

    # 4. Extract Candidate Physical Inventory Terms
    candidate_terms = _extract_inventory_candidate_terms(rem_after_facet)

    # Check if the raw query directly matches a physical item in the department's inventory catalog!
    q_norm = re.sub(r"[^a-z0-9\s\-]", " ", raw_query.lower())
    q_norm = " ".join(q_norm.split())
    cleaned_for_catalog = re.sub(
        r"^\s*(?:where\s+(?:is|are|can\s+i\s+find|do\s+we\s+keep)|locate|location\s+of|find)\s+(?:the\s+|a\s+|an\s+)?",
        "",
        q_norm,
        flags=re.IGNORECASE,
    ).strip()

    if surgeon is None and (q_norm in graph.inventory_terms or cleaned_for_catalog in graph.inventory_terms):
        return ClinicalQueryPlan(
            raw_query=raw_query,
            intent="INVENTORY_LOOKUP",
            inventory_candidate_terms=[raw_query],
            has_explicit_locative=has_explicit_locative,
        )

    if surgeon is None and procedure is None:
        # Check protocol / policy topics (unless explicit "where is <item>" for a stocked drug like dantrolene)
        is_protocol = False
        if not has_explicit_locative:
            for topic in graph.protocol_topics:
                if topic in q_norm:
                    is_protocol = True
                    break
            if re.search(r"\b(?:protocol|policy|guideline|criteria|aldrete|code blue|code red|malignant hyperthermia|needle stick|time out|fire|wet tray|count policy)\b", q_norm):
                is_protocol = True

        if is_protocol:
            return ClinicalQueryPlan(
                raw_query=raw_query,
                intent="PROTOCOL_GUIDELINE_LOOKUP",
                has_explicit_locative=has_explicit_locative,
            )

        # Pure Inventory Query
        return ClinicalQueryPlan(
            raw_query=raw_query,
            intent="INVENTORY_LOOKUP",
            inventory_candidate_terms=[raw_query],
            has_explicit_locative=has_explicit_locative,
        )

    # We have a Surgeon and/or Procedure!
    # Rule 2: Surgeon + Specific Physical Item + Explicit Locative ("where is Dr. Patel's custom vascular stapler")
    if has_explicit_locative and candidate_terms:
        return ClinicalQueryPlan(
            raw_query=raw_query,
            intent="PREFERENCE_INVENTORY_JOIN",
            surgeon=surgeon,
            procedure=procedure,
            card_facet=card_facet,
            inventory_candidate_terms=candidate_terms,
            has_explicit_locative=True,
        )

    # Rule 3: Surgeon/Procedure + Specific Physical Item ("what size prolene does dr chen use for cabg")
    if candidate_terms:
        return ClinicalQueryPlan(
            raw_query=raw_query,
            intent="PREFERENCE_INVENTORY_JOIN",
            surgeon=surgeon,
            procedure=procedure,
            card_facet=card_facet or "all",
            inventory_candidate_terms=candidate_terms,
            has_explicit_locative=False,
        )

    # Rule 1: Surgeon and/or Procedure + Facet / Preference Card Query
    # ("dr patel suture preference", "dr chen positioning", "what sutures does dr patel like", "lap chole preference card")
    return ClinicalQueryPlan(
        raw_query=raw_query,
        intent="PREFERENCE_CARD_LOOKUP",
        surgeon=surgeon,
        procedure=procedure,
        card_facet=card_facet or "all",
        inventory_candidate_terms=[],
        has_explicit_locative=has_explicit_locative,
    )


def _match_card_item_to_inventory(entry_text: str, inv_rows: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """
    Relationally join a preference card line item (e.g. '7-0 Prolene Suture on BV-1 for distal coronary anastomoses'
    or 'DeBakey Vascular Tissue Forceps 12in') to its exact physical inventory row in `inv_rows`.
    """
    entry_low = entry_text.lower()
    best_row: Optional[dict[str, Any]] = None
    best_score = 0

    for row in inv_rows:
        item_name = row.get("item", "")
        item_low = item_name.lower()
        if not item_low:
            continue

        # Direct substring match of catalog item name inside card entry or vice versa
        if item_low in entry_low or entry_low in item_low:
            score = 100 + len(item_low)
            if score > best_score:
                best_score = score
                best_row = row
            continue

        # Check aliases
        aliases = [a.strip().lower() for a in (row.get("aliases") or "").split("|") if a.strip()]
        for al in aliases:
            if len(al) >= 4 and re.search(r"\b" + re.escape(al) + r"\b", entry_low):
                score = 80 + len(al)
                if score > best_score:
                    best_score = score
                    best_row = row

        # Token overlap for sutures/instruments with gauge match
        item_tokens = [t for t in re.split(r"[^a-z0-9\-]+", item_low) if len(t) >= 2 and t not in ("on", "for", "with", "and", "suture", "forceps")]
        if item_tokens:
            matched_toks = [t for t in item_tokens if re.search(r"\b" + re.escape(t) + r"\b", entry_low)]
            if len(matched_toks) >= 2 and len(matched_toks) >= len(item_tokens) - 1:
                score = 50 + len(matched_toks) * 10
                if score > best_score:
                    best_score = score
                    best_row = row

    return best_row


def execute_clinical_query_plan(
    plan: ClinicalQueryPlan,
    graph: ClinicalEntityGraph,
    inventory_service: Any,
) -> Optional[dict[str, Any]]:
    """
    Layer 3: Execute a `PREFERENCE_CARD_LOOKUP` or `PREFERENCE_INVENTORY_JOIN` plan
    against the `ClinicalEntityGraph` and live `inventory_service`.

    Returns a dictionary with:
      - `reply_text`: Formatted clinical response with inline coordinates
      - `routing_tier`: `'TIER_1_LOCAL_CSV'` or `'TIER_2_PREFERENCE_CARD'`
      - `coordinate_card`: Primary matched CoordinateCard dict (if any)
      - `coordinate_cards`: List of matched CoordinateCard dicts
    Returns `None` if `plan.intent` should be handled by standard inventory or RAG lookup.
    """
    if plan.intent not in ("PREFERENCE_CARD_LOOKUP", "PREFERENCE_INVENTORY_JOIN"):
        return None

    # Case A: PREFERENCE_INVENTORY_JOIN with explicit locative ("where is Dr. Patel's custom vascular stapler")
    if plan.intent == "PREFERENCE_INVENTORY_JOIN" and plan.has_explicit_locative and plan.inventory_candidate_terms:
        candidate = plan.inventory_candidate_terms[0]
        inv_match = inventory_service.search(candidate)
        if inv_match and inv_match.get("item"):
            item_name = inv_match["item"]
            human_loc = inv_match.get("human_alias") or inv_match.get("full_code") or ""
            full_code = inv_match.get("full_code") or ""
            notes = inv_match.get("surgeon_notes") or ""
            surgeon_prefix = f"For **{plan.surgeon.display_name}**, " if plan.surgeon else ""
            reply = (
                f"{surgeon_prefix}**{item_name}** is located at **{human_loc}** (`{full_code}`)."
                + (f"\n\n*Clinical Note*: {notes}" if notes else "")
            )
            return {
                "reply_text": reply,
                "routing_tier": "TIER_1_LOCAL_CSV",
                "coordinate_card": inv_match,
                "coordinate_cards": [inv_match],
            }

    # Resolve matching preference cards by Surgeon and/or Procedure
    matched_cards: list[dict[str, Any]] = []
    if plan.surgeon and plan.procedure:
        surg_ids = set(plan.surgeon.matched_card_ids)
        proc_ids = set(plan.procedure.matched_card_ids)
        both_ids = [cid for cid in plan.surgeon.matched_card_ids if cid in proc_ids]
        if both_ids:
            matched_cards = graph.get_cards_by_ids(both_ids)
        elif proc_ids:
            matched_cards = graph.get_cards_by_ids(list(proc_ids))
        elif surg_ids:
            matched_cards = graph.get_cards_by_ids(list(surg_ids))
    elif plan.surgeon:
        matched_cards = graph.get_cards_by_ids(plan.surgeon.matched_card_ids)
    elif plan.procedure:
        matched_cards = graph.get_cards_by_ids(plan.procedure.matched_card_ids)

    # Case B: Surgeon has NO preference card on file in this department
    if plan.surgeon and not matched_cards:
        # Check if any inventory rows mention this surgeon in `surgeon_notes`
        surg_last = plan.surgeon.normalized_last_name
        note_rows = [
            r for r in graph.inventory_rows
            if surg_last and re.search(r"\b" + re.escape(surg_last) + r"\b", (r.get("surgeon_notes") or "").lower())
        ]
        # Also gather fallback standard items if a facet like sutures was requested
        fallback_cards: list[dict[str, Any]] = []
        if note_rows:
            fallback_cards = note_rows[:4]
        elif plan.card_facet == "sutures":
            fallback_cards = [r for r in graph.inventory_rows if "suture" in (r.get("category") or "").lower()][:4]
        elif plan.card_facet == "instruments":
            fallback_cards = [r for r in graph.inventory_rows if "instrument" in (r.get("category") or "").lower()][:4]

        indexed_list = ", ".join(graph.indexed_surgeon_names) if graph.indexed_surgeon_names else "Dr. Elena Rodriguez, Dr. Marcus Chen, Dr. Sarah Chen, Dr. Raj Patel, Dr. Marcus Vance"
        facet_label = (plan.card_facet or "Preference").capitalize()

        lines = [
            f"**No preference card on file for {plan.surgeon.display_name} in {graph.department_name}.**",
            f"*Indexed Surgeons in this department: {indexed_list}.*",
        ]
        if fallback_cards:
            lines.append(
                f"*(If looking for standard department {facet_label}, showing top locations below — or use **+ Quick Add** to add {plan.surgeon.display_name}'s card.)*"
            )
            for r in fallback_cards:
                loc = r.get("human_alias") or r.get("full_code")
                lines.append(f"- **{r['item']}** → `{loc}`")
        else:
            lines.append(
                f"*(Use **+ Quick Add** to register {plan.surgeon.display_name}'s preference card in {graph.department_name}.)*"
            )

        return {
            "reply_text": "\n\n".join(lines[:3]) + ("\n" + "\n".join(lines[3:]) if len(lines) > 3 else ""),
            "routing_tier": "TIER_1_LOCAL_CSV",
            "coordinate_card": fallback_cards[0] if fallback_cards else None,
            "coordinate_cards": fallback_cards,
        }

    # Case C: PREFERENCE_INVENTORY_JOIN without explicit locative
    # e.g. "what size prolene does dr chen use for cabg"
    if plan.intent == "PREFERENCE_INVENTORY_JOIN" and plan.inventory_candidate_terms and matched_cards:
        cand_term = plan.inventory_candidate_terms[0].lower()
        cand_tokens = [t for t in re.split(r"[^a-z0-9\-]+", cand_term) if len(t) >= 2]

        joined_items: list[tuple[str, Optional[dict[str, Any]], dict[str, Any]]] = []
        for card in matched_cards:
            all_entries = list(card.get("sutures") or []) + list(card.get("instrumentation") or []) + list(card.get("supplies") or [])
            for entry in all_entries:
                entry_low = entry.lower()
                if any(tok in entry_low for tok in cand_tokens):
                    inv_row = _match_card_item_to_inventory(entry, graph.inventory_rows)
                    joined_items.append((entry, inv_row, card))

        if joined_items:
            primary_card = joined_items[0][2]
            surg_title = primary_card.get("surgeon") or primary_card.get("clinician") or (plan.surgeon.display_name if plan.surgeon else "")
            proc_title = primary_card.get("procedure") or ""
            header = f"### 📋 {proc_title} — {surg_title}\n"
            header += f"**Matched Preference & Inventory Coordinates for `{plan.inventory_candidate_terms[0]}`:**\n"

            coord_cards: list[dict[str, Any]] = []
            bullet_lines: list[str] = []
            for entry_str, inv_row, _ in joined_items:
                if inv_row:
                    loc_str = inv_row.get("human_alias") or inv_row.get("full_code")
                    bullet_lines.append(f"- **{entry_str}** → 📍 **{loc_str}** (`{inv_row.get('full_code')}`)")
                    if inv_row not in coord_cards:
                        coord_cards.append(inv_row)
                else:
                    bullet_lines.append(f"- **{entry_str}**")

            notes = primary_card.get("notes") or ""
            footer = f"\n\n**Clinical Pearls / Notes**: {notes}" if notes else ""
            return {
                "reply_text": header + "\n".join(bullet_lines) + footer,
                "routing_tier": "TIER_1_LOCAL_CSV",
                "coordinate_card": coord_cards[0] if coord_cards else None,
                "coordinate_cards": coord_cards,
            }

        # Fallback if the item wasn't listed on the card: check inventory directly
        inv_match = inventory_service.search(plan.inventory_candidate_terms[0])
        if inv_match and inv_match.get("item"):
            loc_str = inv_match.get("human_alias") or inv_match.get("full_code")
            return {
                "reply_text": f"**{inv_match['item']}** is stocked at **{loc_str}** (`{inv_match.get('full_code')}`).",
                "routing_tier": "TIER_1_LOCAL_CSV",
                "coordinate_card": inv_match,
                "coordinate_cards": [inv_match],
            }

    # Case D: PREFERENCE_CARD_LOOKUP with matched preference card(s)
    if matched_cards:
        card = matched_cards[0]
        proc_title = card.get("procedure", "Procedure")
        surg_title = card.get("surgeon") or card.get("clinician") or "Department Standard"
        room_title = card.get("room") or card.get("unit") or graph.department_name
        gloves_str = card.get("gloves") or "Standard department sterile gloves"
        pos_str = card.get("position") or "Standard positioning"
        prep_str = card.get("prep") or "Standard prep"
        notes_str = card.get("notes") or ""

        sutures_list: list[str] = list(card.get("sutures") or [])
        inst_list: list[str] = list(card.get("instrumentation") or card.get("supplies") or [])

        coord_cards: list[dict[str, Any]] = []

        def _format_entries_with_coords(entries: list[str]) -> str:
            if not entries:
                return "- None specified"
            out_lines: list[str] = []
            for e in entries:
                inv_row = _match_card_item_to_inventory(e, graph.inventory_rows)
                if inv_row:
                    loc = inv_row.get("human_alias") or inv_row.get("full_code")
                    out_lines.append(f"- **{e}** → 📍 `{loc}`")
                    if inv_row not in coord_cards:
                        coord_cards.append(inv_row)
                else:
                    out_lines.append(f"- {e}")
            return "\n".join(out_lines)

        sutures_formatted = _format_entries_with_coords(sutures_list)
        inst_formatted = _format_entries_with_coords(inst_list)

        facet = plan.card_facet or "all"
        header = (
            f"### 📋 Preference Card: {proc_title}\n"
            f"**Surgeon / Lead**: {surg_title} | **Room / Unit**: {room_title}\n"
        )

        # Highlight requested facet at the very top of the response
        sections: list[str] = []
        if facet == "sutures":
            sections.append(f"#### 🧵 Sutures & Closure (With Live Inventory Coordinates)\n{sutures_formatted}")
            sections.append(f"**Gloves**: {gloves_str}")
            sections.append(f"**Instrumentation**:\n{inst_formatted}")
            if notes_str:
                sections.append(f"**Clinical Pearls**: {notes_str}")
        elif facet == "gloves":
            sections.append(f"#### 🧤 Surgeon Glove Preference\n- **{surg_title}**: **{gloves_str}**")
            if notes_str:
                sections.append(f"**Clinical Pearls**: {notes_str}")
        elif facet == "positioning":
            sections.append(f"#### 🛏️ Patient Positioning & Table Setup\n- **{pos_str}**")
            sections.append(f"**Prep**: {prep_str}")
            if notes_str:
                sections.append(f"**Clinical Pearls**: {notes_str}")
        elif facet == "prep":
            sections.append(f"#### 🧪 Surgical Prep & Draping\n- **{prep_str}**")
            sections.append(f"**Positioning**: {pos_str}")
            if notes_str:
                sections.append(f"**Clinical Pearls**: {notes_str}")
        elif facet == "instruments":
            sections.append(f"#### 🛠️ Instrumentation & Trays (With Live Inventory Coordinates)\n{inst_formatted}")
            sections.append(f"**Sutures & Closure**:\n{sutures_formatted}")
            if notes_str:
                sections.append(f"**Clinical Pearls**: {notes_str}")
        else:
            sections.append(f"**Positioning**: {pos_str}")
            sections.append(f"**Surgical Prep**: {prep_str}")
            sections.append(f"**Gloves**: {gloves_str}")
            if inst_list:
                sections.append(f"#### 🛠️ Instrumentation & Supplies\n{inst_formatted}")
            if sutures_list:
                sections.append(f"#### 🧵 Sutures & Closure\n{sutures_formatted}")
            if notes_str:
                sections.append(f"**Clinical Pearls & Hold Notes**: {notes_str}")

        return {
            "reply_text": header + "\n" + "\n\n".join(sections),
            "routing_tier": "TIER_1_LOCAL_CSV",
            "coordinate_card": coord_cards[0] if coord_cards else None,
            "coordinate_cards": coord_cards,
        }

    return None
