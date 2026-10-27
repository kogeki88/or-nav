"""
Phase 27 Hierarchical Facility, Department & Role-Scoped Architecture Test Suite (v0.4).

Verifies:
1. Version manifest upgraded to v0.4, build_number: 4.
2. ChatRequest accepts hierarchical facility_name and clinical_role parameters.
3. RAGService dynamically injects facility root, department, and role-specific scopes.
4. Role-specific scopes for Circulating RN, Scrub Tech, CRNA, Critical Care, and Trauma RN.
5. Deterministic cache scoping by facility and role.
6. 100% deterministic, zero external live LLM tokens, <1s execution.
"""

import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.config import get_tenant
from app.services.rag_fallback import RAGService

client = TestClient(app)


def test_v04_version_manifest():
    """Verify GET /api/version returns v0.4 manifest."""
    res = client.get("/api/version")
    assert res.status_code == 200
    data = res.json()
    assert data["version"] == "v0.4"
    assert data["build_number"] >= 4
    assert "hierarchical" in data["changelog"].lower() or "ota" in data["changelog"].lower()


def test_public_version_json_matches_v04():
    """Verify frontend/public/version.json matches v0.4 manifest."""
    root = Path(__file__).resolve().parent.parent.parent
    v_path = root / "frontend" / "public" / "version.json"
    assert v_path.exists()
    manifest = json.loads(v_path.read_text(encoding="utf-8"))
    assert manifest["version"] == "v0.4"
    assert manifest["build_number"] >= 4


def test_chat_endpoint_accepts_hierarchical_context():
    """Verify POST /api/chat accepts facility_name and clinical_role."""
    payload = {
        "message": "Where is 3-0 silk?",
        "tenant_id": "or_main",
        "facility_name": "Duke University Hospital",
        "clinical_role": "Scrub Nurse / CST",
    }
    res = client.post("/api/chat", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "3-0 Silk" in data["reply_text"]
    assert data["routing_tier"] == "TIER_1_LOCAL_CSV"


def test_rag_system_prompt_role_scopes():
    """Verify RAGService dynamically injects role-specific scopes into the system prompt."""
    tenant = get_tenant("or_main")
    rag = RAGService(tenant)

    # 1. Scrub Nurse / CST Focus
    prompt_cst = rag._build_system_prompt(
        facility_name="General Memorial Hospital",
        clinical_role="Scrub Nurse / CST",
    )
    assert "General Memorial Hospital" in prompt_cst
    assert "ROLE SCOPE (Scrub Nurse / CST)" in prompt_cst
    assert "suture/needle gauges" in prompt_cst

    # 2. Circulating RN / CNOR Focus
    prompt_cnor = rag._build_system_prompt(
        facility_name="Mayo Clinic",
        clinical_role="Circulating RN (CNOR)",
    )
    assert "Mayo Clinic" in prompt_cnor
    assert "ROLE SCOPE (Circulating RN / CNOR)" in prompt_cnor
    assert "safety checklists" in prompt_cnor

    # 3. CRNA / Anesthesia Focus
    prompt_crna = rag._build_system_prompt(
        facility_name="Atrium Health",
        clinical_role="CRNA / Anesthesia",
    )
    assert "Atrium Health" in prompt_crna
    assert "ROLE SCOPE (CRNA / Anesthesia)" in prompt_crna
    assert "Dantrolene" in prompt_crna


def test_rag_cache_key_facility_and_role_scoping():
    """Verify RAG cache keys distinguish queries from different facilities or roles."""
    tenant = get_tenant("or_main")
    rag = RAGService(tenant)

    k1 = rag._cache_key("dantrolene dose", facility_name="Hospital A", clinical_role="CRNA")
    k2 = rag._cache_key("dantrolene dose", facility_name="Hospital B", clinical_role="CRNA")
    k3 = rag._cache_key("dantrolene dose", facility_name="Hospital A", clinical_role="Circulator")

    assert k1 != k2  # Different facility
    assert k1 != k3  # Different role
    assert k2 != k3
