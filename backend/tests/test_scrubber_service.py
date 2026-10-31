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

    def test_scrub_phi_mrn(self):
        text1 = "Patient has MRN 1234567 for the operation."
        result1 = scrub_phi(text1)
        assert REDACTION in result1.text
        assert "1234567" not in result1.text
        assert result1.redaction_count == 1

        text2 = "Check MRN: 12345678 and MRN#1234567890."
        result2 = scrub_phi(text2)
        assert result2.redaction_count == 2
        assert "12345678" not in result2.text
        assert "1234567890" not in result2.text

        # Should preserve bare digits
        text3 = "Order 1234567 supplies."
        result3 = scrub_phi(text3)
        assert "1234567" in result3.text
        assert result3.redaction_count == 0

    def test_scrub_phi_ssn(self):
        text = "Patient SSN is 123-45-6789 or 123 45 6789."
        result = scrub_phi(text)
        assert result.redaction_count == 2
        assert "123-45-6789" not in result.text
        assert "123 45 6789" not in result.text

    def test_scrub_phi_dob(self):
        text = "DOB 01/15/1980 and date of birth 01/15/80"
        result = scrub_phi(text)
        assert result.redaction_count == 2
        assert "01/15/1980" not in result.text
        assert "01/15/80" not in result.text

        # Do not scrub bare dates
        text2 = "Surgery scheduled for 01/15/1980."
        result2 = scrub_phi(text2)
        assert "01/15/1980" in result2.text
        assert result2.redaction_count == 0

    def test_scrub_phi_phone(self):
        text = "Call (555) 123-4567 or 555-123-4567 or 555.123.4567."
        result = scrub_phi(text)
        assert result.redaction_count == 3
        assert "555" not in result.text

        # Test hotline and internal extension
        text2 = "Call 1-800-644-9737 and x4-25663."
        result2 = scrub_phi(text2)
        assert "1-800-644-9737" in result2.text
        assert "x4-25663" in result2.text
        assert result2.redaction_count == 0

    def test_scrub_phi_patient_names(self):
        text = "We have patient John Smith and patient named Sarah Connor and pt Jane Doe."
        result = scrub_phi(text)
        assert result.redaction_count == 3
        assert "John Smith" not in result.text
        assert "Sarah Connor" not in result.text
        assert "Jane Doe" not in result.text
        # Keeps prefixes
        assert "patient" in result.text
        assert "pt" in result.text

    def test_scrub_phi_preserves_surgeons_and_eponymous(self):
        text = "Dr. Patel used a debakey on patient John Smith."
        result = scrub_phi(text)
        assert "Dr. Patel" in result.text
        assert "debakey" in result.text
        assert "John Smith" not in result.text
        assert result.redaction_count == 1

        text2 = "Doctor Chen requested a mayo."
        result2 = scrub_phi(text2)
        assert "Doctor Chen" in result2.text
        assert "mayo" in result2.text
        assert result2.redaction_count == 0

    def test_scrub_phi_preserves_clinical_terms(self):
        text = "Patient John Smith needs 3-0 suture, #10 blade, 32Fr tube, in OR 21 A 2 C, given 300 units/kg."
        result = scrub_phi(text)
        assert "3-0" in result.text
        assert "#10" in result.text
        assert "32Fr" in result.text
        assert "OR 21 A 2 C" in result.text
        assert "300 units/kg" in result.text
        assert "John Smith" not in result.text
        assert result.redaction_count == 1

    def test_scrub_phi_multiline(self):
        text = "Line 1: MRN 1234567\nLine 2: 3-0 silk\nLine 3: pt Jane Doe"
        result = scrub_phi(text)
        assert result.redaction_count == 2
        assert "1234567" not in result.text
        assert "Jane Doe" not in result.text
        assert "3-0 silk" in result.text
        assert "\n" in result.text

    def test_scrub_phi_unicode(self):
        text = "Patient übermensch has MRN 1234567 with æøå."
        result = scrub_phi(text)
        assert result.redaction_count == 1
        assert "1234567" not in result.text
        assert "übermensch" in result.text
        assert "æøå" in result.text

    def test_scrub_phi_mixed_delimiters(self):
        text = "Check MRN:1234567, and SSN:(123-45-6789)."
        result = scrub_phi(text)
        assert result.redaction_count == 2
        assert "1234567" not in result.text
        assert "123-45-6789" not in result.text



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


    def test_scrub_phi_concurrent_tenant_requests(self):
        """
        Enforce multi-tenant isolation invariant under simulated concurrency.
        """
        tenant_c_text = "MRN: 3333333 pt Bob Smith"
        tenant_d_text = "MRN: 4444444 pt Alice Johnson"

        results_c = [scrub_phi(tenant_c_text) for _ in range(5)]
        results_d = [scrub_phi(tenant_d_text) for _ in range(5)]

        for r in results_c:
            assert r.redaction_count == 2
            assert "3333333" not in r.text
            assert "Bob Smith" not in r.text
            assert "4444444" not in r.text
            assert "Alice Johnson" not in r.text

        for r in results_d:
            assert r.redaction_count == 2
            assert "4444444" not in r.text
            assert "Alice Johnson" not in r.text
            assert "3333333" not in r.text
            assert "Bob Smith" not in r.text


from hypothesis import given, strategies as st
from hypothesis import settings

class TestScrubberServiceFuzzing:
    @given(st.text())
    @settings(max_examples=100)
    def test_scrub_phi_fuzz_text(self, text_input):
        """Fuzz with random text strings to ensure no crashes."""
        result = scrub_phi(text_input)
        assert isinstance(result, ScrubResult)
        assert hasattr(result, "text")
        assert hasattr(result, "redaction_count")

    @given(st.integers() | st.floats(allow_nan=True, allow_infinity=True) | st.booleans() | st.none())
    @settings(max_examples=50)
    def test_scrub_phi_fuzz_primitives(self, primitive_input):
        """Fuzz with primitive types that might be coerced to string."""
        result = scrub_phi(primitive_input)
        assert isinstance(result, ScrubResult)

    @given(st.lists(st.text() | st.integers()) | st.dictionaries(st.text(), st.text() | st.integers()))
    @settings(max_examples=50)
    def test_scrub_phi_fuzz_collections(self, collection_input):
        """Fuzz with collections (lists, dicts) simulating parsed JSON payloads."""
        result = scrub_phi(collection_input)
        assert isinstance(result, ScrubResult)

    def test_scrub_phi_extremely_long_string(self):
        """Test boundary case with extremely long strings."""
        long_string = "MRN 1234567 " * 10000
        result = scrub_phi(long_string)
        assert result.redaction_count == 10000
        assert "1234567" not in result.text
        assert REDACTION in result.text
