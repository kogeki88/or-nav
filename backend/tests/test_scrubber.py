"""
Tests for the OR-Nav PHI Scrubber.

Covers:
  - Positive PHI detection (MRN, SSN, DOB, phone, patient names)
  - CVOR false-positive safety (suture sizes, blade numbers, tube sizes,
    OR coordinates, drug doses, extensions must NOT be redacted)
  - Edge cases (already redacted text, empty input, mixed content)
"""

import pytest
from app.scrubber import scrub_phi, REDACTION


class TestMRNScrubbing:
    """MRN pattern detection."""

    def test_mrn_with_space(self):
        result = scrub_phi("Check MRN 1234567 for allergies")
        assert REDACTION in result.text
        assert "1234567" not in result.text
        assert result.redaction_count == 1

    def test_mrn_with_colon(self):
        result = scrub_phi("MRN: 12345678")
        assert REDACTION in result.text
        assert result.redaction_count == 1

    def test_mrn_with_hash(self):
        result = scrub_phi("MRN#1234567890")
        assert REDACTION in result.text
        assert result.redaction_count == 1

    def test_mrn_case_insensitive(self):
        result = scrub_phi("mrn 9876543")
        assert REDACTION in result.text
        assert result.redaction_count == 1


class TestSSNScrubbing:
    """SSN pattern detection."""

    def test_ssn_with_dashes(self):
        result = scrub_phi("SSN is 123-45-6789")
        assert REDACTION in result.text
        assert "123-45-6789" not in result.text
        assert result.redaction_count == 1

    def test_ssn_with_spaces(self):
        result = scrub_phi("Social: 123 45 6789")
        assert REDACTION in result.text
        assert result.redaction_count == 1


class TestDOBScrubbing:
    """Date of birth pattern detection."""

    def test_dob_slash_format(self):
        result = scrub_phi("DOB 01/15/1980")
        assert REDACTION in result.text
        assert "01/15/1980" not in result.text
        assert result.redaction_count == 1

    def test_dob_with_colon(self):
        result = scrub_phi("DOB: 1-15-1980")
        assert REDACTION in result.text
        assert result.redaction_count == 1

    def test_date_of_birth_full(self):
        result = scrub_phi("date of birth 12/25/90")
        assert REDACTION in result.text
        assert result.redaction_count == 1


class TestPhoneScrubbing:
    """Phone number detection with public number whitelist."""

    def test_standard_phone(self):
        result = scrub_phi("Call mom at (555) 123-4567")
        assert REDACTION in result.text
        assert "(555) 123-4567" not in result.text
        assert result.redaction_count == 1

    def test_phone_with_dots(self):
        result = scrub_phi("Reach at 555.123.4567")
        assert REDACTION in result.text
        assert result.redaction_count == 1

    def test_phone_with_country_code(self):
        result = scrub_phi("Number: +1-555-123-4567")
        assert REDACTION in result.text
        assert result.redaction_count == 1

    def test_mh_hotline_preserved(self):
        """The MHAUS MH Hotline (1-800-644-9737) is a PUBLIC number — must NOT be redacted."""
        result = scrub_phi("Call MH Hotline: 1-800-644-9737")
        assert "1-800-644-9737" in result.text
        assert result.redaction_count == 0


class TestPatientNameScrubbing:
    """Patient name heuristic detection."""

    def test_patient_full_name(self):
        result = scrub_phi("Prep patient John Smith for bypass")
        assert "John Smith" not in result.text
        assert REDACTION in result.text
        assert result.redaction_count == 1

    def test_pt_abbreviation(self):
        result = scrub_phi("pt Jane Doe is NPO")
        assert "Jane Doe" not in result.text
        assert REDACTION in result.text
        assert result.redaction_count == 1

    def test_pt_dot_abbreviation(self):
        result = scrub_phi("pt. Mary Johnson allergic to latex")
        assert "Mary Johnson" not in result.text
        assert REDACTION in result.text
        assert result.redaction_count == 1

    def test_name_with_middle_initial(self):
        result = scrub_phi("patient Robert A. Williams scheduled for AVR")
        assert "Robert A. Williams" not in result.text
        assert REDACTION in result.text
        assert result.redaction_count == 1


# ===================================================================
#  CVOR FALSE-POSITIVE SAFETY TESTS
#  These terms MUST pass through the scrubber completely untouched.
# ===================================================================

class TestCVORSutureSizesSafe:
    """Suture sizes like 3-0, 4-0, 7-0 must NOT be redacted."""

    @pytest.mark.parametrize("suture", [
        "3-0", "4-0", "7-0", "2-0", "5-0", "6-0", "0", "1", "2",
    ])
    def test_suture_sizes_untouched(self, suture):
        text = f"Hand me the {suture} silk suture"
        result = scrub_phi(text)
        assert result.text == text
        assert result.redaction_count == 0

    def test_full_suture_query(self):
        text = "Where is 3-0 silk? Dr. Chen uses for venous cannulation tie-down"
        result = scrub_phi(text)
        assert "3-0" in result.text
        assert result.redaction_count == 0


class TestCVORBladeNumbersSafe:
    """Blade numbers like #10, #11, #15 must NOT be redacted."""

    @pytest.mark.parametrize("blade", ["#10", "#11", "#15"])
    def test_blade_numbers_untouched(self, blade):
        text = f"Need a {blade} blade on the mayo stand"
        result = scrub_phi(text)
        assert result.text == text
        assert result.redaction_count == 0


class TestCVORDeviceSizesSafe:
    """Device sizes like 32Fr, 24Fr must NOT be redacted."""

    @pytest.mark.parametrize("size", ["32Fr", "24Fr", "26Fr", "28Fr"])
    def test_french_sizes_untouched(self, size):
        text = f"Get me a {size} chest tube from Core Supply"
        result = scrub_phi(text)
        assert result.text == text
        assert result.redaction_count == 0


class TestCVORCoordinatesSafe:
    """OR room/shelf coordinates like 'OR 21 A 2 C' must NOT be redacted."""

    def test_or_coordinate_full(self):
        text = "3-0 Silk Suture is in OR 21 A 2 C"
        result = scrub_phi(text)
        assert result.text == text
        assert result.redaction_count == 0

    def test_cabinet_shelf_notation(self):
        text = "Check Cabinet D, Shelf 1, Container A in Core Supply"
        result = scrub_phi(text)
        assert result.text == text
        assert result.redaction_count == 0

    def test_pump_room_coordinate(self):
        text = "Cannulation set is in Pump Room H 2 A"
        result = scrub_phi(text)
        assert result.text == text
        assert result.redaction_count == 0


class TestCVORDrugDosesSafe:
    """Drug doses and concentrations must NOT be redacted."""

    @pytest.mark.parametrize("dose", [
        "300 units/kg",
        "2.5 mg/kg",
        "1000u/mL",
        "20J",
        "1 mg/kg",
    ])
    def test_doses_untouched(self, dose):
        text = f"Administer {dose} as per protocol"
        result = scrub_phi(text)
        assert result.text == text
        assert result.redaction_count == 0


class TestCVORExtensionsSafe:
    """Internal phone extensions like x4-25663 must NOT be redacted."""

    @pytest.mark.parametrize("ext", [
        "x4-25663",
        "x4-27420",
        "x4-22100",
        "x4-27376",
    ])
    def test_extensions_untouched(self, ext):
        text = f"Call blood bank at {ext}"
        result = scrub_phi(text)
        assert result.text == text
        assert result.redaction_count == 0


class TestCVORSurgeonReferencesSafe:
    """Surgeon names referenced in preference cards are NOT patient PHI.
    Note: 'Dr. Chen' does not match the 'patient/pt' heuristic prefix."""

    @pytest.mark.parametrize("ref", [
        "Dr. Chen uses for venous cannulation tie-down",
        "Dr. Patel loads 2-0 Ti-Cron backhand",
        "Dr. Yamamoto double-arms for aortic root",
        "Dr. Rivera places 2 mediastinal tubes",
    ])
    def test_surgeon_refs_untouched(self, ref):
        result = scrub_phi(ref)
        assert result.text == ref
        assert result.redaction_count == 0


class TestEdgeCases:
    """Edge cases and mixed content."""

    def test_empty_string(self):
        result = scrub_phi("")
        assert result.text == ""
        assert result.redaction_count == 0

    def test_already_redacted(self):
        text = f"Patient {REDACTION} is prepped"
        result = scrub_phi(text)
        assert result.text == text
        assert result.redaction_count == 0

    def test_mixed_phi_and_cvor(self):
        """Real-world mixed query: PHI should be scrubbed, CVOR terms preserved."""
        text = "patient John Smith MRN 1234567 needs 3-0 silk from OR 21 A 2 C and a #10 blade"
        result = scrub_phi(text)
        # PHI scrubbed
        assert "John Smith" not in result.text
        assert "1234567" not in result.text
        # CVOR terms preserved
        assert "3-0" in result.text
        assert "OR 21 A 2 C" in result.text
        assert "#10" in result.text
        assert result.redaction_count == 2  # name + MRN

    def test_multiple_phi_types(self):
        text = "pt Jane Doe DOB 03/15/1955 MRN: 9876543 call (555) 867-5309"
        result = scrub_phi(text)
        assert "Jane Doe" not in result.text
        assert "03/15/1955" not in result.text
        assert "9876543" not in result.text
        assert "(555) 867-5309" not in result.text
        assert result.redaction_count == 4

    def test_no_phi_clinical_only(self):
        """Pure clinical query — zero redactions expected."""
        text = (
            "Where is the 2-0 Ti-Cron? Dr. Patel loads it backhand. "
            "Also need internal paddles from OR 21 G 2 A and heparin 300 units/kg."
        )
        result = scrub_phi(text)
        assert result.text == text
        assert result.redaction_count == 0
