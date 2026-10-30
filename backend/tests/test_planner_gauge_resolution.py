from app.intent_parser import parse_clinical_intent
from app.services.clinical_query_planner import plan_clinical_query

def test_planner_gauge_resolution():
    """
    Test clinical query planner disambiguation between needle gauge (e.g. 22G),
    suture size (e.g. 2-0, 3-0), and catheter Fr.
    """
    # 1. Test query with multiple measurements
    query = "22 gauge spinal needle vs 2-0 prolene vs 16 Fr foley"

    # Test intent parsing
    parsed = parse_clinical_intent(query)
    assert parsed.entities.item == "22 gauge spinal needle vs 2-0 prolene vs 16 Fr foley"
    assert parsed.entities.gauge == "2-0"

    # Test clinical query planner
    plan = plan_clinical_query(query)
    assert plan.intent == "INVENTORY_LOOKUP"
    assert "22 gauge spinal needle vs 2-0 prolene vs 16 Fr foley" in plan.inventory_candidate_terms

    # 2. Test individual queries for correct gauge/measurement parsing
    q_needle = "22 gauge spinal needle"
    p_needle = parse_clinical_intent(q_needle)
    assert p_needle.entities.item == "22 gauge spinal needle"
    assert p_needle.entities.gauge is None # Only suture gauges are extracted as gauge entity

    q_suture = "2-0 prolene"
    p_suture = parse_clinical_intent(q_suture)
    assert p_suture.entities.item == "2-0 prolene"
    assert p_suture.entities.gauge == "2-0"

    q_foley = "16 Fr foley"
    p_foley = parse_clinical_intent(q_foley)
    assert p_foley.entities.item == "16 Fr foley"
    assert p_foley.entities.gauge is None # French size not extracted as gauge entity
