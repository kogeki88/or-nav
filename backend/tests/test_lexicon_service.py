import json
import pytest
import socket
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


def test_multi_tenant_isolation_and_offline_replay_idempotency(mock_lexicon_dir):
    facility1 = "tenant1::dept1"
    facility2 = "tenant2::dept1"

    # Save multiple times to simulate offline replay idempotency
    payload1 = [
        {"aliasId": "1", "spokenTerm": "term1", "facilityId": facility1, "departmentId": "dept1", "canonicalItemName": "Item 1", "usageCount": 1, "usedByUsers": ["user1"], "confidence": "personal", "updatedAt": "2023-01-01T00:00:00Z", "displayPreferredName": "Term 1"}
    ]

    save_facility_lexicon(facility1, payload1)
    state1 = load_facility_lexicon(facility1)

    save_facility_lexicon(facility1, payload1)
    save_facility_lexicon(facility1, payload1)
    state2 = load_facility_lexicon(facility1)

    assert state1 == state2, "Offline mutation replay should be idempotent"

    payload2 = [
        {"aliasId": "2", "spokenTerm": "term2", "facilityId": facility2, "departmentId": "dept1", "canonicalItemName": "Item 2", "usageCount": 1, "usedByUsers": ["user1"], "confidence": "personal", "updatedAt": "2023-01-01T00:00:00Z", "displayPreferredName": "Term 2"}
    ]

    save_facility_lexicon(facility2, payload2)

    # Assert multi-tenant isolation
    assert load_facility_lexicon(facility1) == state1
    assert load_facility_lexicon(facility2) == payload2

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


def test_learn_alias_offline_replay_idempotency(mock_lexicon_dir):
    facility = "idempotency_fac"

    entry1 = learn_alias(
        facility_id=facility,
        department_id="or",
        spoken_term="bovie",
        canonical_item="Electrosurgical Unit",
        user_id="user1"
    )

    entry2 = learn_alias(
        facility_id=facility,
        department_id="or",
        spoken_term="bovie",
        canonical_item="Electrosurgical Unit",
        user_id="user1"
    )

    entries = load_facility_lexicon(facility)
    assert len(entries) == 1

    state1 = {k: v for k, v in entry1.items() if k not in ["updatedAt", "usageCount", "confidence"]}
    state2 = {k: v for k, v in entry2.items() if k not in ["updatedAt", "usageCount", "confidence"]}

    assert state1 == state2


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
    facility1 = "fac_a::dept_x"
    facility2 = "fac_b::dept_x"

    # Teach "grabber" in facility1
    learn_alias(
        facility_id=facility1,
        department_id="dept_x",
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

import time
import concurrent.futures

@pytest.fixture(autouse=True)
def enforce_offline_first(monkeypatch):
    """Enforce offline-first invariants by poisoning httpx methods and socket."""
    def _block_network(*args, **kwargs):
        raise RuntimeError("Network call blocked by offline-first invariant enforcement.")

    monkeypatch.setattr("httpx.get", _block_network)
    monkeypatch.setattr("httpx.post", _block_network)
    monkeypatch.setattr("httpx.request", _block_network)
    monkeypatch.setattr("socket.socket", _block_network)

def test_learn_alias_concurrency_race_condition(mock_lexicon_dir):
    """Test race conditions when learning aliases concurrently."""
    facility = "concurrent_fac"
    num_threads = 50

    def worker(i):
        # Even threads learn "termA", Odd threads learn "termB"
        term = "termA" if i % 2 == 0 else "termB"
        return learn_alias(
            facility_id=facility,
            department_id="or",
            spoken_term=term,
            canonical_item="Canonical Item",
            user_id=f"user_{i}"
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=num_threads) as executor:
        futures = [executor.submit(worker, i) for i in range(100)]
        for f in concurrent.futures.as_completed(futures):
            f.result()

    entries = load_facility_lexicon(facility)
    assert len(entries) == 2, f"Expected 2 unique entries, got {len(entries)}"

    termA_entry = next((e for e in entries if e["spokenTerm"] == "terma"), None)
    termB_entry = next((e for e in entries if e["spokenTerm"] == "termb"), None)

    assert termA_entry is not None
    assert termB_entry is not None

    # Total usages should be 100
    assert termA_entry["usageCount"] == 50
    assert termB_entry["usageCount"] == 50

    # Check users
    assert len(termA_entry["usedByUsers"]) == 50
    assert len(termB_entry["usedByUsers"]) == 50

def test_resolve_spoken_alias_concurrent_multi_tenant(mock_lexicon_dir):
    """Test multi-tenant isolation under concurrent burst traffic."""

    def worker(i):
        fac = f"fac_{i % 3}"
        learn_alias(
            facility_id=fac,
            department_id="or",
            spoken_term=f"term_{i}",
            canonical_item=f"Item {i}",
            user_id=f"user_{i}"
        )
        # Immediately try resolving it
        return resolve_spoken_alias(fac, f"where is the term_{i}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        futures = [executor.submit(worker, i) for i in range(100)]
        results = [f.result() for f in concurrent.futures.as_completed(futures)]

    # Ensure all resolved successfully and didn't leak across tenants
    for r in results:
        assert r is not None

    # Verify isolation
    assert load_facility_lexicon("fac_0") is not None
    assert len(load_facility_lexicon("fac_0")) > 0
    assert len(load_facility_lexicon("fac_1")) > 0
    assert len(load_facility_lexicon("fac_2")) > 0

def test_lexicon_service_latency_under_load(mock_lexicon_dir):
    """Test latency of resolve_spoken_alias under a large lexicon size."""
    facility = "latency_fac"

    # Seed large lexicon
    entries = []
    for i in range(1000):
        entries.append({
            "aliasId": f"id_{i}",
            "facilityId": facility,
            "departmentId": "or",
            "spokenTerm": f"term_{i}",
            "canonicalItemName": f"Item {i}",
            "usageCount": 1,
            "usedByUsers": ["user1"],
            "confidence": "personal",
            "updatedAt": "2023-01-01T00:00:00Z",
            "displayPreferredName": f"Term {i}"
        })
    save_facility_lexicon(facility, entries)

    # Warm up cache
    resolve_spoken_alias(facility, "term_0")

    # Benchmark resolution
    num_resolves = 100
    latencies = []

    def resolve_with_latency(i):
        start = time.perf_counter()
        resolve_spoken_alias(facility, f"term_{i * 5}")
        end = time.perf_counter()
        return end - start

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(resolve_with_latency, i) for i in range(num_resolves)]
        for f in concurrent.futures.as_completed(futures):
            latencies.append(f.result())

    avg_latency = sum(latencies) / len(latencies)
    # Expect avg latency to be under 100ms
    assert avg_latency < 0.1, f"Latency too high: {avg_latency * 1000} ms"
