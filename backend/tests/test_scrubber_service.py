import pytest
import socket
import httpx
from app.scrubber import scrub_phi, ScrubResult, REDACTION


class TestScrubberServiceCoreContract:
    def test_scrub_phi_return_type(self):
        result = scrub_phi("Some text")
        assert isinstance(result, ScrubResult)
        assert hasattr(result, "text")
        assert hasattr(result, "redaction_count")

    def test_scrub_phi_empty_string(self):
        result = scrub_phi("")
        assert result.text == ""
        assert result.redaction_count == 0

    def test_scrub_phi_no_phi(self):
        text = "This is a normal clinical string with 3-0 silk."
        result = scrub_phi(text)
        assert result.text == text
        assert result.redaction_count == 0

    def test_scrub_phi_ssn(self):
        text = "Patient SSN is 123-45-6789 and another one 987 65 4321."
        result = scrub_phi(text)
        assert "123-45-6789" not in result.text
        assert "987 65 4321" not in result.text
        assert result.redaction_count == 2
        assert result.text.count(REDACTION) == 2

    def test_scrub_phi_dob(self):
        text = "DOB 01/15/1980 for the patient, also date of birth 12-31-99"
        result = scrub_phi(text)
        assert "01/15/1980" not in result.text
        assert "12-31-99" not in result.text
        assert result.redaction_count == 2
        assert result.text.count(REDACTION) == 2

    def test_scrub_phi_phone(self):
        text = "Call me at (555) 123-4567 or 555-123-4567."
        result = scrub_phi(text)
        assert "(555) 123-4567" not in result.text
        assert "555-123-4567" not in result.text
        assert result.redaction_count == 2
        assert result.text.count(REDACTION) == 2

    def test_scrub_phi_phone_whitelist(self):
        text = "MH Hotline 1-800-644-9737 is public."
        result = scrub_phi(text)
        assert "1-800-644-9737" in result.text
        assert result.redaction_count == 0

    def test_scrub_phi_patient_name(self):
        text = "Patient John Smith needs surgery, pt Jane Doe also."
        result = scrub_phi(text)
        assert "John Smith" not in result.text
        assert "Jane Doe" not in result.text
        assert result.redaction_count == 2
        assert result.text.count(REDACTION) == 2
        assert "Patient" in result.text
        assert "pt" in result.text

    def test_scrub_phi_patient_name_preserves_surgeons(self):
        text = "Dr. Patel and Doctor Chen are operating."
        result = scrub_phi(text)
        assert "Dr. Patel" in result.text
        assert "Doctor Chen" in result.text
        assert result.redaction_count == 0

    def test_scrub_phi_patient_name_preserves_eponymous_instruments(self):
        text = "Pass the mayo scissors and debakey forceps."
        result = scrub_phi(text)
        assert "mayo scissors" in result.text
        assert "debakey forceps" in result.text
        assert result.redaction_count == 0

    def test_scrub_phi_preserves_clinical_terms(self):
        text = "Patient John Doe needs 3-0 silk, #10 blade, 32Fr tube, OR 21 A 2 C."
        result = scrub_phi(text)
        assert "John Doe" not in result.text
        assert "3-0 silk" in result.text
        assert "#10 blade" in result.text
        assert "32Fr tube" in result.text
        assert "OR 21 A 2 C" in result.text
        assert result.redaction_count == 1


class TestScrubberServiceOfflineFirst:
    def test_scrub_phi_no_network_calls(self, monkeypatch):
        """
        Enforce offline-first invariant. The scrubber must not attempt any network calls.
        Dynamically poison socket.socket and httpx methods to raise RuntimeError.
        """
        def poison(*args, **kwargs):
            raise RuntimeError("Network call attempted during offline-first function execution")

        monkeypatch.setattr(socket, "socket", poison)
        monkeypatch.setattr(httpx, "get", poison)
        monkeypatch.setattr(httpx, "post", poison)
        monkeypatch.setattr(httpx.Client, "get", poison)
        monkeypatch.setattr(httpx.Client, "post", poison)
        monkeypatch.setattr(httpx.AsyncClient, "get", poison)
        monkeypatch.setattr(httpx.AsyncClient, "post", poison)

        # Execute scrubber logic
        text_with_phi = "Patient John Smith MRN 1234567"
        result = scrub_phi(text_with_phi)

        # Verify it still works correctly without network
        assert result.redaction_count == 2
        assert "John Smith" not in result.text
        assert "1234567" not in result.text
        assert REDACTION in result.text


class TestScrubberServiceMultiTenantIsolation:
    def test_scrub_phi_stateless_deterministic(self):
        """
        Enforce multi-tenant isolation invariant.
        The function must evaluate deterministically without leaking state.
        Simulate concurrent-like inputs from disjoint tenants.
        """
        tenant_a_text = "MRN: 1111111 needs #10 blade"
        tenant_b_text = "MRN: 2222222 needs 3-0 silk"

        result_a1 = scrub_phi(tenant_a_text)
        result_b1 = scrub_phi(tenant_b_text)
        result_a2 = scrub_phi(tenant_a_text)
        result_b2 = scrub_phi(tenant_b_text)

        # Deterministic
        assert result_a1.text == result_a2.text
        assert result_a1.redaction_count == result_a2.redaction_count == 1

        assert result_b1.text == result_b2.text
        assert result_b1.redaction_count == result_b2.redaction_count == 1

        # Assert no state leaked between invocations
        assert "2222222" not in result_a1.text
        assert "1111111" not in result_b1.text
        assert "#10 blade" in result_a1.text
        assert "3-0 silk" in result_b1.text
