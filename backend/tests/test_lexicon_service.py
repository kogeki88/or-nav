import json
import pytest
from pathlib import Path
from unittest.mock import patch

from app.services.lexicon_learning import (
    get_facility_id_from_tenant,
    load_facility_lexicon,
    save_facility_lexicon,
    reset_facility_lexicons,
    learn_alias,
    resolve_spoken_alias,
    DEFAULT_PRESEEDED_LEXICONS,
    get_all_aliases_for_item,
    title_case_term,
    detect_teaching_intent,
)


def test_get_facility_id_from_tenant():
    # Double colon notation
    assert get_facility_id_from_tenant("sacred_heart::or") == ("sacred_heart", "or")
    assert get_facility_id_from_tenant("princeton_plainsboro::er") == ("princeton_plainsboro", "er")

    # Prefix notation
    assert get_facility_id_from_tenant("sacred_heart_or") == ("sacred_heart", "or")
    assert get_facility_id_from_tenant("sacred_heart") == ("sacred_heart", "sacred_heart")
    assert get_facility_id_from_tenant("duke_regional_icu") == ("duke_regional", "icu")

    # Specific known facility overrides
    assert get_facility_id_from_tenant("or_main") == ("general_memorial", "or")
    assert get_facility_id_from_tenant("er_trauma") == ("general_memorial", "er")

    # Default fallback
    assert get_facility_id_from_tenant("unknown_tenant") == ("unknown_tenant", "or")
    assert get_facility_id_from_tenant("") == ("sacred_heart", "or")


@pytest.fixture
def mock_lexicon_dir(tmp_path):
    with patch("app.services.lexicon_learning._get_facility_lexicon_path") as mock_get_path:
        def side_effect(facility_id):
            fac_dir = tmp_path / facility_id
            fac_dir.mkdir(parents=True, exist_ok=True)
            return fac_dir / "learned_lexicon.json"

        mock_get_path.side_effect = side_effect
        yield mock_get_path


def test_load_save_lexicon_offline_persistence(mock_lexicon_dir, tmp_path):
    facility = "test_facility"

    # Load non-existent without defaults -> empty list
    assert load_facility_lexicon(facility) == []

    # Save entries
    test_entries = [{"aliasId": "1", "spokenTerm": "term"}]
    save_facility_lexicon(facility, test_entries)

    # Verify file is on disk
    path = tmp_path / facility / "learned_lexicon.json"
    assert path.exists()
    assert json.loads(path.read_text(encoding="utf-8")) == test_entries

    # Load entries back
    assert load_facility_lexicon(facility) == test_entries


def test_reset_facility_lexicons(mock_lexicon_dir, tmp_path):
    # Alter the lexicon memory cache and disk for sacred_heart
    save_facility_lexicon("sacred_heart", [{"aliasId": "junk", "spokenTerm": "junk"}])

    # Reset
    reset_facility_lexicons()

    # Verify it matches default
    loaded = load_facility_lexicon("sacred_heart")
    defaults = DEFAULT_PRESEEDED_LEXICONS.get("sacred_heart")

    # Because of pydantic Field default_factory for updatedAt, we shouldn't strictly compare the exact strings
    # if we were creating models, but these are raw dictionaries.
    assert len(loaded) == len(defaults)
    assert loaded[0]["spokenTerm"] == defaults[0]["spokenTerm"]


def test_learn_alias_tenant_isolation_and_confidence(mock_lexicon_dir):
    facility1 = "fac1"
    facility2 = "fac2"

    # User 1 teaches term in facility 1
    entry1 = learn_alias(
        facility_id=facility1,
        department_id="or",
        spoken_term="magic wand",
        canonical_item="Bovie Cautery",
        user_id="user1"
    )

    assert entry1["spokenTerm"] == "magic wand"
    assert entry1["confidence"] == "personal"
    assert entry1["usageCount"] == 1
    assert "user1" in entry1["usedByUsers"]

    # User 2 uses same term in facility 1 -> upgrades confidence
    entry2 = learn_alias(
        facility_id=facility1,
        department_id="or",
        spoken_term="magic wand",
        canonical_item="Bovie Cautery",
        user_id="user2"
    )
    assert entry2["usageCount"] == 2
    assert entry2["confidence"] == "facility_consensus"
    assert "user1" in entry2["usedByUsers"]
    assert "user2" in entry2["usedByUsers"]

    # Load for facility 2 should be empty
    assert load_facility_lexicon(facility2) == []


def test_resolve_spoken_alias_multi_tenant(mock_lexicon_dir):
    facility1 = "fac_a"
    facility2 = "fac_b"

    # Teach "grabber" in facility1
    learn_alias(
        facility_id=facility1,
        department_id="or",
        spoken_term="grabber",
        canonical_item="Adson Tissue Forceps 1x2 (Adson Pickups)",
        user_id="user1"
    )

    # Resolve in facility1
    resolved1 = resolve_spoken_alias(facility1, "where is the grabber")
    assert resolved1 is not None
    assert resolved1["canonicalItemName"] == "Adson Tissue Forceps 1x2 (Adson Pickups)"

    # Resolve in facility2 -> Should not be found
    resolved2 = resolve_spoken_alias(facility2, "where is the grabber")
    assert resolved2 is None

def test_learn_alias_malformed_inputs(mock_lexicon_dir):
    # Missing required inputs
    with pytest.raises(ValueError):
        learn_alias("fac", "or", "", "Canonical Item")

    with pytest.raises(ValueError):
        learn_alias("fac", "or", "Spoken Term", "")

    with pytest.raises(ValueError):
        learn_alias("fac", "or", "   ", "Canonical Item")

def test_resolve_spoken_alias_boundary_inputs(mock_lexicon_dir):
    # Empty/None queries
    assert resolve_spoken_alias("sacred_heart", "") is None
    assert resolve_spoken_alias("sacred_heart", "   ") is None

def test_get_all_aliases_for_item_boundary():
    assert get_all_aliases_for_item("fac", "") == []
    assert get_all_aliases_for_item("fac", "   ") == []

def test_title_case_term():
    assert title_case_term("adson pickups") == "Adson Pickups"
    assert title_case_term("  messy   spaces  ") == "Messy Spaces"
    assert title_case_term("ALL CAPS") == "ALL CAPS" # preserves upper

def test_detect_teaching_intent_fuzzing():
    # Various valid and invalid teachings
    assert detect_teaching_intent("We call the grabber a pickup.") == ("grabber", "pickup")
    assert detect_teaching_intent("In this facility, the magic wand is called a bovie.") == ("magic wand", "bovie")
    assert detect_teaching_intent("Remember that the clamp means a hemostat.") == ("clamp", "hemostat")
    assert detect_teaching_intent("Alias the snips to scissors.") == ("snips", "scissors")

    # Should not match general questions
    assert detect_teaching_intent("What is the grabber called?") is None
    assert detect_teaching_intent("Where is the grabber?") is None
    assert detect_teaching_intent("Who is called to the OR?") is None

    # Too short
    assert detect_teaching_intent("We call a b") is None

def test_load_facility_lexicon_malformed_json(tmp_path):
    with patch('app.services.lexicon_learning._get_facility_lexicon_path') as mock_path:
        mock_path.return_value = tmp_path / 'malformed.json'
        (tmp_path / 'malformed.json').write_text('{ malformed: json, [ }', encoding='utf-8')
        assert load_facility_lexicon('malformed_facility') == []
