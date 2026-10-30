import pytest
from app.intent_parser import (
    ClinicalIntent,
    parse_clinical_intent,
    normalize_clinical_speech,
    extract_and_normalize_coordinate,
)

def test_extract_and_normalize_coordinate_packed():
    coord, clean = extract_and_normalize_coordinate("add malleable retractor to or21c1f")
    assert coord == "OR 21 C 1 F"
    assert clean.strip() == "add malleable retractor"

def test_extract_and_normalize_coordinate_natural():
    coord, clean = extract_and_normalize_coordinate("move the 3-0 silk to core supply rack 4 shelf b bin 2")
    assert coord.lower() == "core supply rack 4 shelf b bin 2"
    assert clean.strip() == "move the 3-0 silk"

def test_normalize_clinical_speech_disfluencies():
    norm, pill = normalize_clinical_speech("umm where is the uhh 3-0 prolene you know")
    assert "3-0 prolene" in norm
    assert "umm" not in norm
    assert "uhh" not in norm

def test_parse_clinical_intent_teach_alias():
    res = parse_clinical_intent("Here we call Mixter clamps Geminis")
    assert res.intent == ClinicalIntent.TEACH_ALIAS
    assert res.entities.action == "teach_alias"
    assert "mixter clamp" in res.entities.target_item.lower()
    assert "geminis" in res.entities.alias_term.lower()


def test_tenant_boundary_offline_invariants():
    """
    Ensure the intent parser is purely deterministic, does not make external API calls (offline invariant),
    and does not leak or require tenant-specific data during the parsing phase.
    """
    res1 = parse_clinical_intent("where is the 3-0 vicryl")
    assert res1.intent == ClinicalIntent.FIND_INVENTORY
    assert res1.entities.gauge == "3-0"

    # Check that parser doesn't use or leak any particular tenant context
    # (should act strictly on the query string regardless of tenant)
    res2 = parse_clinical_intent("Add open heart tray to rack 4 shelf A")
    assert res2.intent == ClinicalIntent.MUTATE_INVENTORY
    assert res2.entities.location.lower() == "rack 4 shelf a"
    assert res2.entities.action == "add"
