"""
Phase 31: Orientee Question & Multi-Peer Verification Ping System.

REST endpoints:
- POST /api/peer-questions: Create a new orientee clinical question.
- GET /api/peer-questions: List department questions with verification badges.
- POST /api/peer-questions/{question_id}/answers: Add an answer.
- POST /api/peer-questions/{question_id}/answers/{answer_id}/verify:
  Register peer verification vote. Automatically flips answer to verified
  consensus and question status to 'verified' upon 2 confirmations.
"""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
from typing import List, Optional
import uuid
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/peer-questions", tags=["peer-questions"])

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PEER_QUESTIONS_FILE = PROJECT_ROOT / "hospitals" / "peer_questions.json"


# --- Data Models ---

class PeerAnswer(BaseModel):
    answerId: str
    answeredBy: str
    answerText: str
    verifiedBy: List[str] = Field(default_factory=list)
    isVerifiedConsensus: bool = False


class PeerQuestion(BaseModel):
    id: str
    tenantId: str
    questionText: str
    askedBy: str
    role: str
    createdAt: str
    answers: List[PeerAnswer] = Field(default_factory=list)
    status: str = "unverified"  # "unverified" | "verified"
    verificationsCount: int = 0


class CreateQuestionRequest(BaseModel):
    tenant_id: Optional[str] = None
    tenantId: Optional[str] = None
    question_text: Optional[str] = None
    questionText: Optional[str] = None
    asked_by: Optional[str] = "Sean Iglesia, RN (Orientee)"
    askedBy: Optional[str] = None
    role: Optional[str] = "Orientee"


class CreateAnswerRequest(BaseModel):
    answered_by: Optional[str] = None
    answeredBy: Optional[str] = None
    answer_text: Optional[str] = None
    answerText: Optional[str] = None


class VerifyAnswerRequest(BaseModel):
    verified_by: Optional[str] = None
    verifiedBy: Optional[str] = None


# --- Storage Helpers ---

def _get_default_seed() -> List[dict]:
    return [
        {
            "id": "pq-seed-1",
            "tenantId": "sacred_heart::or",
            "questionText": "Where is the emergency vascular shunt stored during ruptured abdominal aneurysm?",
            "askedBy": "Nurse Turk (Orientee RN)",
            "role": "Circulating RN",
            "createdAt": "2026-10-27T14:30:00Z",
            "answers": [
                {
                    "answerId": "pa-seed-1a",
                    "answeredBy": "Dr. Christopher Turk (Attending Surgeon)",
                    "answerText": "Pruitt-Inahara carotid & vascular shunts are in Core Supply · Cart V · Shelf 1 · Bin A next to vascular clamp set.",
                    "verifiedBy": ["Carla Espinosa, RN"],
                    "isVerifiedConsensus": False,
                }
            ],
            "status": "unverified",
            "verificationsCount": 1,
        },
        {
            "id": "pq-seed-2",
            "tenantId": "sacred_heart::or",
            "questionText": "What is the proper warm-up time for the Belmont rapid infuser before spiking emergency blood?",
            "askedBy": "Sean Iglesia, RN (Orientee)",
            "role": "Circulating RN",
            "createdAt": "2026-10-27T12:00:00Z",
            "answers": [
                {
                    "answerId": "pa-seed-2a",
                    "answeredBy": "Senior Periop Coordinator",
                    "answerText": "Belmont FMS 2000 electromagnetic warmer self-tests in under 45 seconds; prime dual-spike disposable circuit with warm saline before spiking uncrossmatched PRBCs.",
                    "verifiedBy": ["Dr. Dorian, MD", "Carla Espinosa, RN"],
                    "isVerifiedConsensus": True,
                }
            ],
            "status": "verified",
            "verificationsCount": 2,
        },
        {
            "id": "pq-seed-3",
            "tenantId": "sacred_heart::or",
            "questionText": "Are 5mm trocars stocked inside OR 21 or do we retrieve them from the Sterile Core?",
            "askedBy": "Dr. Elliot Reid (Orientee)",
            "role": "Scrub Tech",
            "createdAt": "2026-10-27T16:00:00Z",
            "answers": [],
            "status": "unverified",
            "verificationsCount": 0,
        },
        {
            "id": "pq-seed-pp-1",
            "tenantId": "princeton_plainsboro::or",
            "questionText": "Where are specialized pediatric rigid bronchoscopy sets located for emergency foreign body retrieval?",
            "askedBy": "Dr. Allison Cameron (Orientee)",
            "role": "Scrub Tech",
            "createdAt": "2026-10-27T11:15:00Z",
            "answers": [
                {
                    "answerId": "pa-pp-1a",
                    "answeredBy": "Dr. Robert Chase (Attending Surgeon)",
                    "answerText": "Pediatric rigid bronchoscope tray and Storz optical forceps are stored in Anesthesia Workroom A-12, locked cabinet drawer 3.",
                    "verifiedBy": ["Dr. Eric Foreman, MD", "Dr. Lisa Cuddy, MD"],
                    "isVerifiedConsensus": True,
                }
            ],
            "status": "verified",
            "verificationsCount": 2,
        },
        {
            "id": "pq-seed-pp-2",
            "tenantId": "princeton_plainsboro::or",
            "questionText": "What is the anticoagulation reversal protocol for emergency mechanical thrombectomy in OR 4?",
            "askedBy": "Dr. Remy Hadley (Orientee RN)",
            "role": "Circulating RN",
            "createdAt": "2026-10-27T13:45:00Z",
            "answers": [
                {
                    "answerId": "pa-pp-2a",
                    "answeredBy": "Dr. James Wilson (Chief of Oncology)",
                    "answerText": "Protamine sulfate 1 mg per 100 units heparin administered slow IV over 10 minutes; verify ACT < 180 before femoral closure.",
                    "verifiedBy": ["Dr. Gregory House, MD", "Dr. Robert Chase, MD"],
                    "isVerifiedConsensus": True,
                }
            ],
            "status": "verified",
            "verificationsCount": 2,
        },
        {
            "id": "pq-seed-cg-1",
            "tenantId": "county_general::or",
            "questionText": "Where are the Level 1 Rapid Infuser heat exchanger cartridges kept during trauma resuscitations?",
            "askedBy": "Dr. John Carter (Surgical Resident)",
            "role": "Circulating RN",
            "createdAt": "2026-10-27T15:20:00Z",
            "answers": [
                {
                    "answerId": "pa-cg-1a",
                    "answeredBy": "Dr. Peter Benton (Trauma Attending)",
                    "answerText": "Level 1 H-1200 disposable high-flow tubing sets are hanging on the trauma crash cart in Trauma OR 1 and Trauma OR 2.",
                    "verifiedBy": ["Carol Hathaway, RN", "Dr. Mark Greene, MD"],
                    "isVerifiedConsensus": True,
                }
            ],
            "status": "verified",
            "verificationsCount": 2,
        },
        {
            "id": "pq-seed-cg-2",
            "tenantId": "county_general::or",
            "questionText": "What is the emergency protocol for uncrossmatched blood release from the satellite blood bank?",
            "askedBy": "Chuny Marquez, RN (Orientee)",
            "role": "Circulating RN",
            "createdAt": "2026-10-27T16:05:00Z",
            "answers": [
                {
                    "answerId": "pa-cg-2a",
                    "answeredBy": "Carol Hathaway, RN (Charge Nurse)",
                    "answerText": "Emergency 4-unit uncrossmatched O-negative PRBC cooler is kept in Satellite Blood Refrigerator B-2; 2-nurse barcode scan verification required.",
                    "verifiedBy": ["Dr. Kerry Weaver, MD", "Dr. John Carter, MD"],
                    "isVerifiedConsensus": True,
                }
            ],
            "status": "verified",
            "verificationsCount": 2,
        },
    ]


def load_peer_questions() -> List[PeerQuestion]:
    if not PEER_QUESTIONS_FILE.exists():
        initial = _get_default_seed()
        save_peer_questions([PeerQuestion(**q) for q in initial])
        return [PeerQuestion(**q) for q in initial]
    try:
        data = json.loads(PEER_QUESTIONS_FILE.read_text(encoding="utf-8"))
        return [PeerQuestion(**q) for q in data]
    except Exception:
        initial = _get_default_seed()
        return [PeerQuestion(**q) for q in initial]


def save_peer_questions(questions: List[PeerQuestion]) -> None:
    PEER_QUESTIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    raw = [q.model_dump() for q in questions]
    PEER_QUESTIONS_FILE.write_text(json.dumps(raw, indent=2) + "\n", encoding="utf-8")


# --- Endpoints ---

@router.post("", response_model=PeerQuestion)
async def create_peer_question(req: CreateQuestionRequest):
    """Broadcast an orientee clinical question to department peers."""
    t_id = req.tenant_id or req.tenantId
    if not t_id:
        raise HTTPException(status_code=400, detail="tenant_id is required.")

    q_text = req.question_text or req.questionText
    if not q_text or not q_text.strip():
        raise HTTPException(status_code=400, detail="question_text cannot be empty.")

    asked_by = req.asked_by or req.askedBy or "Sean Iglesia, RN (Orientee)"
    role = req.role or "Orientee"
    now_iso = datetime.now(timezone.utc).isoformat()

    new_q = PeerQuestion(
        id=f"pq-{uuid.uuid4().hex[:8]}",
        tenantId=t_id.strip(),
        questionText=q_text.strip(),
        askedBy=asked_by.strip(),
        role=role.strip(),
        createdAt=now_iso,
        answers=[],
        status="unverified",
        verificationsCount=0,
    )

    questions = load_peer_questions()
    questions.insert(0, new_q)
    save_peer_questions(questions)
    return new_q


@router.get("", response_model=List[PeerQuestion])
async def list_peer_questions(tenant_id: Optional[str] = Query(None)):
    """List department peer questions, optionally filtered by tenant_id."""
    questions = load_peer_questions()
    if not tenant_id:
        return questions

    clean_tid = tenant_id.strip().lower()
    # Support exact, prefix, suffix, and cross-department matching

    def matches_tenant(q_tid: str) -> bool:
        qt = q_tid.lower()
        if qt == clean_tid:
            return True
        if "::" in clean_tid:
            fac, dept = clean_tid.split("::", 1)
            return (fac in qt and dept in qt) or (dept in qt)
        if clean_tid in qt or qt in clean_tid:
            return True
        # Match base dept (e.g. or_main matches sacred_heart::or)
        base = clean_tid.split("_")[0]
        return base in qt

    filtered = [q for q in questions if matches_tenant(q.tenantId)]
    return filtered


@router.post("/{question_id}/answers", response_model=PeerQuestion)
async def answer_peer_question(question_id: str, req: CreateAnswerRequest):
    """Submit an answer to an orientee clinical question."""
    a_text = req.answer_text or req.answerText
    if not a_text or not a_text.strip():
        raise HTTPException(status_code=400, detail="answer_text cannot be empty.")

    answered_by = req.answered_by or req.answeredBy or "Clinical Colleague"

    questions = load_peer_questions()
    target_q: Optional[PeerQuestion] = None
    for q in questions:
        if q.id == question_id:
            target_q = q
            break

    if not target_q:
        raise HTTPException(status_code=404, detail=f"Question {question_id} not found.")

    new_answer = PeerAnswer(
        answerId=f"pa-{uuid.uuid4().hex[:8]}",
        answeredBy=answered_by.strip(),
        answerText=a_text.strip(),
        verifiedBy=[],
        isVerifiedConsensus=False,
    )

    target_q.answers.append(new_answer)
    save_peer_questions(questions)
    return target_q


@router.post("/{question_id}/answers/{answer_id}/verify", response_model=PeerQuestion)
async def verify_peer_answer(question_id: str, answer_id: str, req: VerifyAnswerRequest):
    """
    Register a clinician verification vote.
    When verifiedBy count reaches >= 2, marks answer as verified consensus
    and question status as 'verified' (upgrading badge to 🟢 Verified).
    """
    verifier = req.verified_by or req.verifiedBy or "Clinical Verifier"
    verifier = verifier.strip()

    questions = load_peer_questions()
    target_q: Optional[PeerQuestion] = None
    for q in questions:
        if q.id == question_id:
            target_q = q
            break

    if not target_q:
        raise HTTPException(status_code=404, detail=f"Question {question_id} not found.")

    target_ans: Optional[PeerAnswer] = None
    for a in target_q.answers:
        if a.answerId == answer_id:
            target_ans = a
            break

    if not target_ans:
        raise HTTPException(status_code=404, detail=f"Answer {answer_id} not found in question {question_id}.")

    # Duplicate verification prevention: do not double-count same clinician
    if verifier not in target_ans.verifiedBy:
        target_ans.verifiedBy.append(verifier)

    # Multi-peer threshold: >= 2 verifications establishes verified consensus
    if len(target_ans.verifiedBy) >= 2:
        target_ans.isVerifiedConsensus = True
        target_q.status = "verified"

    # Compute overall question verificationsCount (max across answers)
    target_q.verificationsCount = max((len(a.verifiedBy) for a in target_q.answers), default=0)
    if target_q.verificationsCount >= 2:
        target_q.status = "verified"

    save_peer_questions(questions)
    return target_q
