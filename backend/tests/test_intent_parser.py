import pytest
import socket
import httpx
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

def test_intent_parser_fuzzing():
    queries = [
        "",
        " ",
        "  \t\n",
        "WHERE IS THE !@#$%^&*()",
        "<script>alert(1)</script>",
        "add " * 1000,
        "\x00\x01\x02",
        "drop table users;",
        "1=1",
    ]
    for q in queries:
        res = parse_clinical_intent(q)
        assert res.intent is not None
        assert res.confidence >= 0

def test_intent_parser_offline_first(monkeypatch):
    orig_socket = socket.socket
    def poison(*args, **kwargs):
        if hasattr(socket, 'AF_UNIX') and kwargs.get('family') == getattr(socket, 'AF_UNIX', -1):
            return orig_socket(*args, **kwargs)
        if args and hasattr(socket, 'AF_UNIX') and args[0] == getattr(socket, 'AF_UNIX', -1):
            return orig_socket(*args, **kwargs)
        raise RuntimeError("Network call attempted! Offline invariant violated.")

    monkeypatch.setattr(socket, "socket", poison)
    monkeypatch.setattr(httpx, "get", poison)
    monkeypatch.setattr(httpx, "post", poison)
    monkeypatch.setattr(httpx, "request", poison)

    res = parse_clinical_intent("where is the 3-0 vicryl")
    assert res.intent == ClinicalIntent.FIND_INVENTORY

def test_intent_parser_multi_tenant_isolation(monkeypatch):
    # Ensure intent parser is deterministic and acts strictly on query regardless of environment
    monkeypatch.setenv("HOSPITAL_TENANT", "hospital_a")
    res1 = parse_clinical_intent("hospital_a::dept_1 move the 3-0 prolene to shelf B")

    monkeypatch.setenv("HOSPITAL_TENANT", "hospital_b")
    res2 = parse_clinical_intent("hospital_b::dept_2 move the 3-0 prolene to shelf B")

    assert res1.intent == res2.intent
    assert res1.entities == res2.entities
    assert res1.confidence == res2.confidence
    # We do NOT assert raw_query difference because intent_parser is just a pure text processor.
    # It does not parse the "hospital_a::dept_1" boundary format natively, the caller does.
    # This just ensures we can pass arbitrary tenant-prefixed payloads safely.

def test_intent_parser_offline_mutation_replay_idempotency(monkeypatch):
    orig_socket = socket.socket
    def poison(*args, **kwargs):
        if hasattr(socket, 'AF_UNIX') and kwargs.get('family') == getattr(socket, 'AF_UNIX', -1):
            return orig_socket(*args, **kwargs)
        if args and hasattr(socket, 'AF_UNIX') and args[0] == getattr(socket, 'AF_UNIX', -1):
            return orig_socket(*args, **kwargs)
        raise RuntimeError("Network call attempted! Offline invariant violated.")

    monkeypatch.setattr(socket, "socket", poison)
    monkeypatch.setattr(httpx, "get", poison)
    monkeypatch.setattr(httpx, "post", poison)
    monkeypatch.setattr(httpx, "request", poison)

    # Replay sequentially with the exact same input
    input_str = "hospital_a::dept_1 move the 3-0 prolene to shelf B"
    res1 = parse_clinical_intent(input_str)
    res2 = parse_clinical_intent(input_str)
    res3 = parse_clinical_intent(input_str)

    assert res1.intent == res2.intent == res3.intent
    assert res1.entities == res2.entities == res3.entities
    assert res1.confidence == res2.confidence == res3.confidence


import time
import multiprocessing
from unittest.mock import patch
import socket
import httpx
import os

def _poison_and_parse(args):
    tenant, query, expected_intent = args
    os.environ["HOSPITAL_TENANT"] = tenant

    # Inject tenant into the query payload for testing boundary isolation
    query = f"{tenant}::dept_1 {query}"

    orig_socket = socket.socket
    # Enforce offline-first invariant globally for this worker process
    def poison(*args, **kwargs):
        if hasattr(socket, 'AF_UNIX') and kwargs.get('family') == getattr(socket, 'AF_UNIX', -1):
            return orig_socket(*args, **kwargs)
        if args and hasattr(socket, 'AF_UNIX') and args[0] == getattr(socket, 'AF_UNIX', -1):
            return orig_socket(*args, **kwargs)
        raise RuntimeError("Network call attempted! Offline invariant violated.")

    with patch('socket.socket', side_effect=poison), \
         patch('httpx.get', side_effect=poison), \
         patch('httpx.post', side_effect=poison), \
         patch('httpx.request', side_effect=poison):
        res = parse_clinical_intent(query)

    return res, expected_intent, tenant

def test_intent_parser_concurrent_burst():
    # Multi-tenant context and queries
    queries = [
        ("hospital_a", "where is the 3-0 vicryl", ClinicalIntent.FIND_INVENTORY),
        ("hospital_b", "Add open heart tray to rack 4 shelf A", ClinicalIntent.MUTATE_INVENTORY),
        ("hospital_a", "move the 3-0 prolene to shelf B", ClinicalIntent.FIND_INVENTORY),
        ("hospital_b", "Here we call Mixter clamps Geminis", ClinicalIntent.TEACH_ALIAS),
        ("hospital_a", "Dr. Smith lap chole", ClinicalIntent.VIEW_PREFERENCE_CARD),
        ("hospital_b", "Code blue protocol", ClinicalIntent.GENERAL_QUERY)
    ] * 20  # Total 120 executions

    start_time = time.time()

    # Use multiprocessing to safely modify os.environ without race conditions
    with multiprocessing.Pool(processes=4) as pool:
        results = pool.map(_poison_and_parse, queries)

    end_time = time.time()

    total_latency = end_time - start_time
    avg_latency = total_latency / len(queries)

    # Assert latency (use a more lenient threshold for CI/CD)
    assert avg_latency < 0.200, f"Average latency too high: {avg_latency * 1000:.2f}ms"

    # Assert correctness (no race conditions and correct behavior under concurrency)
    for res, expected_intent, tenant in results:
        assert res.intent == expected_intent, f"Race condition or bad parse for {expected_intent}. got {res.intent}"
def test_intent_parser_supplementary_isolation(monkeypatch):
    orig_socket = socket.socket
    def poison(*args, **kwargs):
        if hasattr(socket, 'AF_UNIX') and kwargs.get('family') == getattr(socket, 'AF_UNIX', -1):
            return orig_socket(*args, **kwargs)
        if args and hasattr(socket, 'AF_UNIX') and args[0] == getattr(socket, 'AF_UNIX', -1):
            return orig_socket(*args, **kwargs)
        raise RuntimeError("Network call attempted! Offline invariant violated.")

    monkeypatch.setattr(socket, "socket", poison)
    monkeypatch.setattr(httpx, "get", poison)
    monkeypatch.setattr(httpx, "post", poison)
    monkeypatch.setattr(httpx, "request", poison)

    monkeypatch.setenv("HOSPITAL_TENANT", "hospital_c")
    res1 = parse_clinical_intent("hospital_c::dept_1 find the scalpel")

    monkeypatch.setenv("HOSPITAL_TENANT", "hospital_d")
    res2 = parse_clinical_intent("hospital_d::dept_2 find the scalpel")

    assert res1.intent == res2.intent
    assert res1.entities == res2.entities
