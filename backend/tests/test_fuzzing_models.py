
import pytest
from app.routers.chat import VerifyMoveRequest, FlagWrongRequest, CreateQuestionRequest as ChatCreateQuestionRequest
from app.peer_qna import CreateQuestionRequest as PeerCreateQuestionRequest
from pydantic import ValidationError

def test_verify_move_request_fuzzing():
    with pytest.raises(ValidationError):
        VerifyMoveRequest(tenant_id="valid", item="<script>alert(1)</script>")
    with pytest.raises(ValidationError):
        VerifyMoveRequest(tenant_id="valid", item="valid", expected_location="invalid location <br>")

    # valid
    req = VerifyMoveRequest(tenant_id="valid", item="Valid Item", expected_location="Valid_Location-1")
    assert req.item == "Valid Item"

def test_flag_wrong_request_fuzzing():
    with pytest.raises(ValidationError):
        FlagWrongRequest(tenant_id="valid", item="<script>alert(1)</script>")
    with pytest.raises(ValidationError):
        FlagWrongRequest(tenant_id="valid", item="valid", reason="<script>alert(1)</script>")

    # valid
    req = FlagWrongRequest(tenant_id="valid", item="Valid Item", reason="Valid Reason")
    assert req.item == "Valid Item"

def test_chat_create_question_request_fuzzing():
    with pytest.raises(ValidationError):
        ChatCreateQuestionRequest(tenant_id="valid", question_text="<script>alert(1)</script>")
    with pytest.raises(ValidationError):
        ChatCreateQuestionRequest(tenant_id="valid", question_text="valid", asked_by_role="<script>alert(1)</script>")

    # valid
    req = ChatCreateQuestionRequest(tenant_id="valid", question_text="Valid Question", asked_by_role="Valid Role")
    assert req.question_text == "Valid Question"

def test_peer_create_question_request_fuzzing():
    with pytest.raises(ValidationError):
        PeerCreateQuestionRequest(tenant_id="valid", question_text="<script>alert(1)</script>")
    with pytest.raises(ValidationError):
        PeerCreateQuestionRequest(tenant_id="valid", questionText="<script>alert(1)</script>")

    # valid
    req = PeerCreateQuestionRequest(tenant_id="valid", question_text="Valid Question")
    assert req.question_text == "Valid Question"
