"""
Phase 39: REST API Router for Adaptive Facility Lexicon & Multi-User Slang Sync.
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.services.lexicon_learning import (
    load_facility_lexicon,
    learn_alias,
    resolve_spoken_alias,
    get_all_aliases_for_item,
    title_case_term,
)

router = APIRouter(prefix="/api/lexicon", tags=["lexicon"])


class LearnAliasRequest(BaseModel):
    facility_id: str = Field(..., description="Hospital ID (e.g. 'sacred_heart')")
    department_id: str = Field(default="or", description="Department ID (e.g. 'or')")
    spoken_term: str = Field(..., description="Local term or slang (e.g. 'gemini', 'adson pickups')")
    canonical_item: str = Field(..., description="Exact catalog item name (e.g. 'Mixter Right-Angle Clamp 7.5in')")
    user_id: str = Field(default="anonymous", description="Email or user ID of teaching clinician")
    display_preferred_name: Optional[str] = Field(default=None, description="Title-cased display version")


class ConfirmImplicitRequest(BaseModel):
    facility_id: str
    department_id: str = "or"
    slang_term: str
    canonical_item: str
    user_id: str = "anonymous"


@router.get("")
async def get_facility_lexicon(
    facility_id: str = Query(..., description="Hospital identifier e.g. 'sacred_heart'"),
    department_id: Optional[str] = Query(None, description="Optional department filter"),
):
    """Return all learned aliases for the given facility."""
    entries = load_facility_lexicon(facility_id)
    if department_id:
        entries = [e for e in entries if e.get("departmentId") == department_id]
    return {
        "status": "ok",
        "facility_id": facility_id,
        "count": len(entries),
        "aliases": entries,
    }


@router.post("/learn")
async def learn_facility_alias(req: LearnAliasRequest):
    """
    Bind or increment a local slang term for the entire facility.
    Awards +5 XP and promotes confidence to 'facility_consensus' when usageCount >= 2.
    """
    if not req.spoken_term.strip() or not req.canonical_item.strip():
        raise HTTPException(status_code=400, detail="spoken_term and canonical_item are required.")

    disp_name = req.display_preferred_name or title_case_term(req.spoken_term)

    entry = learn_alias(
        facility_id=req.facility_id,
        department_id=req.department_id,
        spoken_term=req.spoken_term,
        canonical_item=req.canonical_item,
        user_id=req.user_id,
        display_name=disp_name,
    )

    all_facility_aliases = get_all_aliases_for_item(req.facility_id, req.canonical_item)

    return {
        "status": "ok",
        "entry": entry,
        "xp_awarded": 5,
        "facility_aliases": all_facility_aliases,
        "message": f'🧠 Learned for {req.facility_id}: "{disp_name}" ↔ {req.canonical_item}',
    }


@router.post("/confirm-implicit")
async def confirm_implicit_learning(req: ConfirmImplicitRequest):
    """
    Confirm that an unresolved prior search (e.g. 'whistle tips') maps to the target item.
    """
    disp_name = title_case_term(req.slang_term)
    entry = learn_alias(
        facility_id=req.facility_id,
        department_id=req.department_id,
        spoken_term=req.slang_term,
        canonical_item=req.canonical_item,
        user_id=req.user_id,
        display_name=disp_name,
    )
    return {
        "status": "ok",
        "entry": entry,
        "xp_awarded": 5,
        "message": f'🧠 Learned for {req.facility_id}: "{disp_name}" ↔ {req.canonical_item}',
    }
