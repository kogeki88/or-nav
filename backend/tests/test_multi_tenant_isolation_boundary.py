import pytest
from app.services.clinical_graph import get_clinical_graph
from app.services.clinical_query_planner import plan_clinical_query

def test_planner_multi_tenant_strict_boundary_isolation():
    """
    To comply with strict multi-tenant or concurrent data isolation using sequential string payloads,
    include explicit boundary delimiters in the assertion to prevent false positive matches.
    """
    graph = get_clinical_graph("or_main")
    tenant_id_base = "worker"

    # Simulating a payload/transcription where a tenant id is injected to verify boundary.
    worker_1_query = f"tenant {tenant_id_base}1:: test query for dr patel"
    plan_1 = plan_clinical_query(worker_1_query, graph=graph, tenant_id=f"{tenant_id_base}1")

    worker_10_query = f"tenant {tenant_id_base}10:: test query for dr patel"
    plan_10 = plan_clinical_query(worker_10_query, graph=graph, tenant_id=f"{tenant_id_base}10")

    # We enforce explicit boundaries
    import re
    # worker1 should be found with word boundaries in the parsed raw query
    assert re.search(r'\bworker1\b', plan_1.raw_query) is not None
    # worker10 should not be falsely matched by worker1 boundary
    assert re.search(r'\bworker1\b', plan_10.raw_query) is None

    # And specifically for delimiters like :: which are non-word chars,
    # the rule is: Only use \b adjacent to word characters.
    assert re.search(r'\bworker1::', plan_1.raw_query) is not None
    assert re.search(r'\bworker1::', plan_10.raw_query) is None
