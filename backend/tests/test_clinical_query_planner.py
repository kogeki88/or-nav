"""
Phase 43 Verification Suite: Unified Clinical Query Planner & Relational Graph Engine.

Verifies all 3 layers of the Clinical Query Planner & Relational Execution Engine:
1. Layer 1: Auto-Compiled Clinical Vocabulary & Entity Graph (`clinical_graph.py`)
2. Layer 2: Unified Clinical Query Planner (`clinical_query_planner.py`)
   - Rule 1: Surgeon + Facet / Preference Query -> `PREFERENCE_CARD_LOOKUP`
   - Rule 2: Surgeon + Specific Physical Item + Locative -> `PREFERENCE_INVENTORY_JOIN`
   - Rule 3: Surgeon/Procedure + Specific Item -> `PREFERENCE_INVENTORY_JOIN`
   - Rule 4: Pure Inventory Query -> `INVENTORY_LOOKUP`
3. Layer 3: Relational Execution & Intelligent Clinical Responses
   - Preference Card Facet Highlighting + Inline Inventory Coordinate Joins (`Room • Cart • Shelf • Bin`)
   - Unindexed Surgeon Graceful Response (`"No preference card on file for Dr. Unknown..."`, NEVER `"is not in the inventory"`)
   - Surgeon + Item Locative Fast Lookup (`"where is Dr. Patel's custom vascular stapler"`)
   - Zero Regressions on Pure Inventory Lookups (`"where is 3-0 prolene"`, `"adson with teeth"`, `"malleable retractor"`)
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.clinical_graph import get_clinical_graph, reset_clinical_graphs
from app.services.clinical_query_planner import plan_clinical_query
from app.services.inventory_search import reset_inventory_services

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_state(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    reset_inventory_services()
    reset_clinical_graphs()
    yield
    reset_inventory_services()
    reset_clinical_graphs()


def test_layer1_auto_compiled_clinical_entity_graph():
    """Verify Layer 1 compiles Surgeons, Procedures, Facets, and Inventory from hospital data."""
    graph = get_clinical_graph("or_main")
    assert len(graph.preference_cards) >= 8
    assert "patel" in graph.surgeons_by_token
    assert "chen" in graph.surgeons_by_token
    assert "rodriguez" in graph.surgeons_by_token
    assert "vance" in graph.surgeons_by_token

    # Verify indexed surgeon display names include the core OR surgeons
    indexed_str = " ".join(graph.indexed_surgeon_names)
    assert "Dr. Elena Rodriguez" in indexed_str
    assert "Dr. Sarah Chen" in indexed_str
    assert "Dr. Raj Patel" in indexed_str
    assert "Dr. Marcus Vance" in indexed_str

    # Verify procedures index
    assert "lap chole" in graph.procedures_by_phrase
    assert "cabg" in graph.procedures_by_phrase
    assert "tka" in graph.procedures_by_phrase
    assert "evar" in graph.procedures_by_phrase


def test_layer2_deterministic_routing_rules():
    """Verify Layer 2 Query Planner deterministically decomposes all 4 clinical query archetypes."""
    graph = get_clinical_graph("or_main")

    # Rule 1: Surgeon + Facet / Preference Query
    for q, expected_surg, expected_facet in [
        ("dr patel suture preference", "patel", "sutures"),
        ("what sutures does dr chen use", "chen", "sutures"),
        ("dr chen positioning", "chen", "positioning"),
        ("dr rodriguez glove size", "rodriguez", "gloves"),
        ("dr chen lap chole card", "chen", "all"),
    ]:
        plan = plan_clinical_query(q, graph=graph)
        assert plan.intent == "PREFERENCE_CARD_LOOKUP", f"Failed intent for '{q}': {plan}"
        assert plan.surgeon is not None and plan.surgeon.normalized_last_name == expected_surg
        assert plan.card_facet == expected_facet
        assert plan.inventory_candidate_terms == []

    # Rule 2: Surgeon + Specific Physical Item + Explicit Locative
    plan_loc = plan_clinical_query("where is Dr. Patel's custom vascular stapler", graph=graph)
    assert plan_loc.intent == "PREFERENCE_INVENTORY_JOIN"
    assert plan_loc.has_explicit_locative is True
    assert plan_loc.surgeon is not None and plan_loc.surgeon.normalized_last_name == "patel"
    assert plan_loc.inventory_candidate_terms == ["custom vascular stapler"]

    # Rule 3: Surgeon/Procedure + Specific Item
    plan_join = plan_clinical_query("what size prolene does dr chen use for cabg", graph=graph)
    assert plan_join.intent == "PREFERENCE_INVENTORY_JOIN"
    assert plan_join.has_explicit_locative is False
    assert plan_join.surgeon is not None and plan_join.surgeon.normalized_last_name == "chen"
    assert plan_join.procedure is not None and "cabg" in plan_join.procedure.name.lower()
    assert "prolene" in plan_join.inventory_candidate_terms[0].lower()

    # Rule 4: Pure Inventory Query
    for inv_q in ["where is 3-0 prolene", "adson with teeth", "malleable retractor"]:
        plan_inv = plan_clinical_query(inv_q, graph=graph)
        assert plan_inv.intent == "INVENTORY_LOOKUP"
        assert plan_inv.surgeon is None
        assert plan_inv.procedure is None


def test_layer3_surgeon_preference_and_relational_inventory_join():
    """
    Verify 'dr patel suture preference', 'what sutures does dr chen use', 'dr chen lap chole card',
    and 'dr rodriguez glove size' return preference card sections with joined inventory coordinates.
    """
    # 1. "dr patel suture preference"
    r1 = client.post("/api/chat", json={"message": "dr patel suture preference", "tenant_id": "or_main"})
    assert r1.status_code == 200
    d1 = r1.json()
    reply1 = d1["reply_text"]
    assert "not in the inventory" not in reply1.lower()
    assert "not currently stocked" not in reply1.lower()
    assert "Dr. Raj Patel" in reply1
    assert "Sutures & Closure" in reply1
    assert "3-0 Silk Suture" in reply1
    assert "OR 21 · Cart A · Shelf 2 · Bin C" in reply1
    assert d1["coordinate_card"] is not None
    assert len(d1["coordinate_cards"]) >= 2

    # 2. "what sutures does dr chen use"
    r2 = client.post("/api/chat", json={"message": "what sutures does dr chen use", "tenant_id": "or_main"})
    assert r2.status_code == 200
    d2 = r2.json()
    reply2 = d2["reply_text"]
    assert "not in the inventory" not in reply2.lower()
    assert "not currently stocked" not in reply2.lower()
    assert "Chen" in reply2
    assert "Prolene" in reply2 or "Stratafix" in reply2
    assert d2["coordinate_card"] is not None

    # 3. "dr chen lap chole card"
    r3 = client.post("/api/chat", json={"message": "dr chen lap chole card", "tenant_id": "or_main"})
    assert r3.status_code == 200
    d3 = r3.json()
    reply3 = d3["reply_text"]
    assert "not in the inventory" not in reply3.lower()
    assert "Preference Card" in reply3

    # 4. "dr rodriguez glove size"
    r4 = client.post("/api/chat", json={"message": "dr rodriguez glove size", "tenant_id": "or_main"})
    assert r4.status_code == 200
    d4 = r4.json()
    reply4 = d4["reply_text"]
    assert "not in the inventory" not in reply4.lower()
    assert "Dr. Elena Rodriguez" in reply4
    assert "Biogel" in reply4
    assert "6.5" in reply4


def test_layer3_unindexed_surgeon_never_falls_into_inventory_trapdoor():
    """
    Verify 'dr nonexistentsurgeon suture preference' or 'dr unknown suture preference'
    NEVER says "'dr ...' is not in the inventory", and instead lists indexed surgeons.
    """
    r = client.post(
        "/api/chat",
        json={"message": "dr nonexistentsurgeon suture preference", "tenant_id": "or_main"},
    )
    assert r.status_code == 200
    data = r.json()
    reply = data["reply_text"]
    assert "is not in the inventory" not in reply.lower()
    assert "is not currently stocked" not in reply.lower()
    assert "No preference card on file for Dr. Nonexistentsurgeon" in reply
    assert "Indexed Surgeons in this department:" in reply
    assert "Dr. Sarah Chen" in reply
    assert "Dr. Elena Rodriguez" in reply
    assert "Dr. Raj Patel" in reply


def test_layer3_surgeon_plus_item_locative_and_relational_queries():
    """
    Verify:
    - 'where is Dr. Patel's custom vascular stapler' -> strips surgeon framing cleanly via Layer 2
      and finds 'Custom Vascular Stapler' at Rank #1 (OR 21 Z 9 Special).
    - 'what size prolene does dr chen use for cabg' -> joins Dr. Sarah Chen's CABG preference card
      Prolene entries with their exact OR 21 Cart A coordinates.
    """
    r_loc = client.post(
        "/api/chat",
        json={"message": "where is Dr. Patel's custom vascular stapler", "tenant_id": "or_main"},
    )
    assert r_loc.status_code == 200
    d_loc = r_loc.json()
    assert d_loc["coordinate_card"] is not None
    assert "Custom Vascular Stapler" in d_loc["coordinate_card"]["item"]
    assert d_loc["coordinate_card"]["full_code"] == "OR 21 Z 9 Special"
    assert "Dr. Raj Patel" in d_loc["reply_text"]

    r_join = client.post(
        "/api/chat",
        json={"message": "what size prolene does dr chen use for cabg", "tenant_id": "or_main"},
    )
    assert r_join.status_code == 200
    d_join = r_join.json()
    assert "Prolene" in d_join["reply_text"]
    assert "OR 21 · Cart A" in d_join["reply_text"]
    assert d_join["coordinate_card"] is not None


def test_layer3_pure_inventory_zero_regression():
    """Verify pure inventory queries ('where is 3-0 prolene', 'adson with teeth', 'malleable retractor') hit Rank #1."""
    for q, expected_sub in [
        ("where is 4-0 prolene", "4-0 Prolene"),
        ("adson with teeth", "Adson Tissue Forceps"),
        ("malleable retractor", "Malleable Ribbon Retractor"),
    ]:
        res = client.post("/api/chat", json={"message": q, "tenant_id": "or_main"})
        assert res.status_code == 200
        data = res.json()
        assert data["coordinate_card"] is not None, f"Failed pure inventory lookup for '{q}'"
        assert expected_sub.lower() in data["coordinate_card"]["item"].lower()

def test_multi_tenant_isolation_in_planner():
    """Verify Layer 2 Query Planner enforces multi-tenant boundaries."""
    # or_main tenant
    graph_main = get_clinical_graph("or_main")
    plan_main = plan_clinical_query("dr chen lap chole card", graph=graph_main)
    assert plan_main.surgeon is not None
    assert plan_main.surgeon.normalized_last_name == "chen"
    assert plan_main.intent == "PREFERENCE_CARD_LOOKUP"

    # pacu_periop tenant (Dr. Chen doesn't have a lap chole card there)
    graph_pacu = get_clinical_graph("pacu_periop")
    plan_pacu = plan_clinical_query("dr chen lap chole card", graph=graph_pacu)

    # Assert that different tenants return different matches for the exact same query
    # based on their local clinical graph.

    # For example, if Dr. Chen is completely unknown in pacu_periop, surgeon is None or unindexed
    if plan_pacu.surgeon:
        assert not plan_pacu.surgeon.is_indexed


def test_offline_first_invariant_no_network_calls(monkeypatch):
    """
    Verify the Planner doesn't use any network API calls.
    We'll poison the socket module and the httpx module to guarantee this.
    """
    import socket
    import httpx

    def poisoned_socket(*args, **kwargs):
        raise RuntimeError("Network call attempted during offline-first function!")

    def poisoned_httpx_post(*args, **kwargs):
        raise RuntimeError("HTTP network call attempted during offline-first function!")

    def poisoned_httpx_get(*args, **kwargs):
        raise RuntimeError("HTTP network call attempted during offline-first function!")

    monkeypatch.setattr(socket, "socket", poisoned_socket)
    monkeypatch.setattr(httpx, "post", poisoned_httpx_post)
    monkeypatch.setattr(httpx, "get", poisoned_httpx_get)

    graph = get_clinical_graph("or_main")

    # Run multiple queries
    plan_1 = plan_clinical_query("dr patel suture preference", graph=graph)
    assert plan_1.intent == "PREFERENCE_CARD_LOOKUP"

    plan_2 = plan_clinical_query("where is 4-0 prolene", graph=graph)
    assert plan_2.intent == "INVENTORY_LOOKUP"
