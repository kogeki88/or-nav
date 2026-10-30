import pytest
from app.services.governance import GovernanceService

def test_verify_policy():
    gov_service = GovernanceService("general_memorial_cvor")

    # Authorized roles
    assert gov_service.verify_policy("surgeon_preference_update", "Circulating RN") is True
    assert gov_service.verify_policy("surgeon_preference_update", "Charge RN") is True
    assert gov_service.verify_policy("surgeon_preference_update", "CRNA") is True
    assert gov_service.verify_policy("inventory_adjustment", "Circulating RN") is True
    assert gov_service.verify_policy("inventory_adjustment", "Charge RN") is True
    assert gov_service.verify_policy("inventory_adjustment", "CRNA") is True

    # Unauthorized roles
    assert gov_service.verify_policy("surgeon_preference_update", "Scrub Tech") is False
    assert gov_service.verify_policy("inventory_adjustment", "Scrub Tech") is False

    # Other actions
    assert gov_service.verify_policy("other_action", "Scrub Tech") is True
    assert gov_service.verify_policy("other_action", "Circulating RN") is True

def test_log_audit_event_and_get_audit_trail():
    gov_service = GovernanceService("general_memorial_cvor")

    event1 = gov_service.log_audit_event("inventory_adjustment", "Moved 3-0 Silk", "Circulating RN")
    event2 = gov_service.log_audit_event("surgeon_preference_update", "Updated Dr. Smith preference", "Charge RN")

    audit_trail = gov_service.get_audit_trail()

    assert len(audit_trail) == 2

    assert event1 in audit_trail
    assert event2 in audit_trail

    assert event1["action"] == "inventory_adjustment"
    assert event1["details"] == "Moved 3-0 Silk"
    assert event1["user_role"] == "Circulating RN"
    assert "timestamp" in event1
    assert event1["facility_id"] == "general_memorial_cvor"
    assert event1["id"].startswith("audit-")

    assert event2["action"] == "surgeon_preference_update"
    assert event2["details"] == "Updated Dr. Smith preference"
    assert event2["user_role"] == "Charge RN"
    assert "timestamp" in event2
    assert event2["facility_id"] == "general_memorial_cvor"
    assert event2["id"].startswith("audit-")
