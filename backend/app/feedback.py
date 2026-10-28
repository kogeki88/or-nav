"""
Phase 36: Passive Chat Complaint Interceptor & Dedicated Feedback Portal Backend.

REST endpoints:
- GET /api/feedback: List all feedback sorted by Priority Score along with synthesized topRecommendations.
- POST /api/feedback: Create or intercept feedback item (with deduplication/upvote merge).
- PATCH /api/feedback/{feedback_id}: Upvote or update status (open, planned, resolved).
- POST /api/feedback/{feedback_id}/upvote: Upvote a feedback item (convenience route).
- PATCH /api/feedback/{feedback_id}/status: Update status (convenience route).
- DELETE /api/feedback/{feedback_id}: Delete a feedback item.
"""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
from typing import List, Optional, Union
import uuid
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/feedback", tags=["feedback"])

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
FEEDBACK_FILE = PROJECT_ROOT / "hospitals" / "feedback.json"


# --- Data Models ---

class FeedbackItem(BaseModel):
    id: str
    tenantId: str = "sacred_heart::or"
    userName: str = "Staff Clinician"
    userRole: str = "Circulating RN"
    source: str = "manual_submission"  # "chat_auto_detected" | "manual_submission"
    category: str = "feature_request"  # "bug_friction" | "feature_request" | "data_inventory" | "ui_ux"
    severity: str = "medium"  # "low" | "medium" | "high"
    rawText: str
    aiRecommendation: str
    suggestedFixPrompt: str
    upvotes: int = 1
    status: str = "open"  # "open" | "planned" | "resolved"
    createdAt: str


class FeedbackListResponse(BaseModel):
    items: List[FeedbackItem]
    topRecommendations: List[str]


class CreateFeedbackRequest(BaseModel):
    tenantId: Optional[str] = "sacred_heart::or"
    userName: Optional[str] = "Staff Clinician"
    userRole: Optional[str] = "Circulating RN"
    source: Optional[str] = "manual_submission"
    category: Optional[str] = None
    severity: Optional[str] = None
    rawText: str
    aiRecommendation: Optional[str] = None
    suggestedFixPrompt: Optional[str] = None


class PatchFeedbackRequest(BaseModel):
    status: Optional[str] = None  # "open" | "planned" | "resolved"
    upvote: Optional[bool] = None


class UpdateStatusRequest(BaseModel):
    status: str  # "open" | "planned" | "resolved"


# --- Intelligence & Synthesis Engine ---

FEATURE_WISH_PATTERN = r"\b(i wish|would be nice|should have|can you add|why doesn't it|need a feature|needs to show|it would help if|please add)\b"
UI_COMPLAINT_PATTERN = r"\b(too slow|annoying|confusing|hard to read|doesn't work|broken|bug|bugs|hate how|takes too long|cluttered|wrong location|keep having to|too bright|dark mode|glare|audio too quiet|volume|cut off|cutting off|keeps cutting)\b"
DATA_COMPLAINT_PATTERN = r"\b(missing|not in here|outdated|wrong card|never updated|where the heck|wrong bin|not in cart|moved to|out of stock)\b"
BUG_GENERAL_PATTERN = r"\b(broken|broke|bug|bugs|glitch|glitches|error|errors|crash|crashed|crashing|crashes|fail|failed|fails|failing|stuck|freeze|freezes|freezing|froze|not working|won't work)\b"

HIGH_SEVERITY_PATTERN = r"\b(patient|safety|crash|emergency|vital|sterile field contaminated|code blue|bleeding|hemostasis|completely broken|cannot document|cannot open|locked out)\b"
MEDIUM_SEVERITY_PATTERN = r"\b(missing|wrong bin|wrong location|can't find|slow|annoying|frustrating|voice cut off|hate how|takes too long)\b"


def is_complaint_or_feature_wish(text: str) -> bool:
    """Return True if text contains complaint, frustration, or feature-wish patterns."""
    if not text or len(text.strip()) < 8:
        return False
    lower = text.lower()
    return bool(
        re.search(FEATURE_WISH_PATTERN, lower) or
        re.search(UI_COMPLAINT_PATTERN, lower) or
        re.search(DATA_COMPLAINT_PATTERN, lower) or
        re.search(BUG_GENERAL_PATTERN, lower)
    )


def classify_text(text: str) -> tuple[str, str]:
    """Classify text into (category, severity)."""
    lower = text.lower()

    # Category
    category = "feature_request"
    if re.search(DATA_COMPLAINT_PATTERN, lower):
        category = "data_inventory"
    elif re.search(UI_COMPLAINT_PATTERN, lower):
        category = "ui_ux"
    elif re.search(BUG_GENERAL_PATTERN, lower):
        category = "bug_friction"
    elif re.search(FEATURE_WISH_PATTERN, lower):
        category = "feature_request"

    # Severity
    severity = "low"
    if re.search(HIGH_SEVERITY_PATTERN, lower):
        severity = "high"
    elif re.search(MEDIUM_SEVERITY_PATTERN, lower):
        severity = "medium"
    elif category in ["bug_friction", "data_inventory"]:
        severity = "medium"

    return category, severity


def synthesize_recommendations(raw_text: str, category: str, severity: str) -> tuple[str, str]:
    """Synthesize developer recommendation and ready-to-copy Antigravity prompt."""
    lower = raw_text.lower()
    
    # Specific clinical heuristics
    if "dark mode" in lower or "too bright" in lower or "glare" in lower:
        ai_rec = "Add surgical dark-mode toggle and low-glare high-contrast theme for dimmed laparoscopic suites."
        fix_prompt = f"ANTIGRAVITY DIRECTIVE: Implement a high-contrast Surgical Night Mode toggle in the header and system drawer. In low light, invert bright backgrounds and enhance bin coordinate legibility without glare. Context: Clinician reported: '{raw_text}'."
    elif "needle" in lower or "suture" in lower:
        ai_rec = "Add needle gauge, code, and length columns to Tier-2 preference_cards.json tables."
        fix_prompt = f"ANTIGRAVITY DIRECTIVE: Enhance preference card suture tables: add needle gauge, needle code, and curvature columns to Tier-2 preference_cards.json and display prominently on the procedure card. Context: Clinician reported: '{raw_text}'."
    elif "vascular clamp" in lower or "clamp size" in lower:
        ai_rec = "Add quick vascular clamp size and occlusion profile quick-reference chart to cardiovascular quick tools."
        fix_prompt = f"ANTIGRAVITY DIRECTIVE: Add a vascular clamp quick-reference chart (DeBakey, Cooley, Fogarty, Bulldog) to the CVOR quick tools drawer. Context: Clinician reported: '{raw_text}'."
    elif "timer" in lower or "cement" in lower:
        ai_rec = "Add a sterile OR countdown timer utility (e.g. Bone Cement / Ischemia timer) accessible directly from omnibar quick actions."
        fix_prompt = f"ANTIGRAVITY DIRECTIVE: Build a quick OR countdown timer tool in the omnibar for bone cement curing and tourniquet times. Context: Clinician reported: '{raw_text}'."
    elif "wrong bin" in lower or "cart" in lower or "moved" in lower or "shelf" in lower or "missing" in lower:
        ai_rec = "Trigger instant discrepancy audit in department inventory catalog and prompt senior circulator verification."
        fix_prompt = f"ANTIGRAVITY DIRECTIVE: Verify and correct supply coordinates in inventory catalog. Enhance the out-of-date notification on the CoordinateCard. Context: Clinician reported: '{raw_text}'."
    elif "voice" in lower or "quiet" in lower or "cut off" in lower or "speech" in lower:
        ai_rec = "Adjust Web Speech recognition silence debounce threshold and add speech volume/rate sliders in Audio drawer."
        fix_prompt = f"ANTIGRAVITY DIRECTIVE: Optimize voice recognition noise filter for loud OR environments and increase debounce timeout from 800ms to 1500ms. Context: Clinician reported: '{raw_text}'."
    elif category == "bug_friction":
        ai_rec = "Address workflow friction in active module: handle edge case gracefully and provide retry option."
        fix_prompt = f"ANTIGRAVITY DIRECTIVE: Fix bug/friction in perioperative assistant: '{raw_text}'. Add defensive error boundary, local retry fallback, and clear offline recovery message."
    elif category == "data_inventory":
        ai_rec = "Audit and reconcile catalog metadata for item described in complaint."
        fix_prompt = f"ANTIGRAVITY DIRECTIVE: Reconcile inventory data discrepancy: '{raw_text}'. Ensure cross-tenant isolation and accurate shelf/cart mapping."
    elif category == "ui_ux":
        ai_rec = "Improve UI ergonomics and touch target accessibility for gloved clinicians."
        fix_prompt = f"ANTIGRAVITY DIRECTIVE: Refactor UI component ergonomics: '{raw_text}'. Increase minimum touch target to 48px, enhance typography contrast, and streamline mobile layout."
    else:
        ai_rec = "Evaluate proposed clinical feature enhancement and design modular component architecture."
        fix_prompt = f"ANTIGRAVITY DIRECTIVE: Implement requested clinical workflow feature: '{raw_text}'. Integrate cleanly into current perioperative navigation tabs."

    return ai_rec, fix_prompt


# --- Seed Data ---

def _get_default_seed() -> List[dict]:
    return [
        {
            "id": "fb-seed-001",
            "tenantId": "sacred_heart::or",
            "userName": "Dr. Christopher Turk",
            "userRole": "Attending Surgeon",
            "source": "chat_auto_detected",
            "category": "ui_ux",
            "severity": "high",
            "rawText": "The screen is way too bright during laparoscopic cholecystectomy in OR 4. We dim the room lights and the white background causes glare on the monitor.",
            "aiRecommendation": "Add surgical dark-mode toggle and low-glare high-contrast theme for dimmed laparoscopic suites.",
            "suggestedFixPrompt": "ANTIGRAVITY DIRECTIVE: Implement a high-contrast Surgical Night Mode toggle in the header and system drawer. In low light, invert bright backgrounds and enhance bin coordinate legibility without glare.",
            "upvotes": 5,
            "status": "open",
            "createdAt": "2026-10-27T18:30:00Z",
        },
        {
            "id": "fb-seed-002",
            "tenantId": "sacred_heart::or",
            "userName": "Carla Espinosa, RN",
            "userRole": "Circulating RN",
            "source": "manual_submission",
            "category": "data_inventory",
            "severity": "medium",
            "rawText": "We moved the pediatric vascular bulldog clamps from Cart V to Cart P Shelf 2, but the app still says Cart V.",
            "aiRecommendation": "Trigger instant discrepancy audit in department inventory catalog and prompt senior circulator verification.",
            "suggestedFixPrompt": "ANTIGRAVITY DIRECTIVE: Update vascular clamp bin coordinates in Sacred Heart OR inventory and prompt preceptors to verify.",
            "upvotes": 3,
            "status": "planned",
            "createdAt": "2026-10-27T19:15:00Z",
        },
        {
            "id": "fb-seed-003",
            "tenantId": "princeton_plainsboro::or",
            "userName": "Dr. Robert Chase",
            "userRole": "Surgeon",
            "source": "manual_submission",
            "category": "feature_request",
            "severity": "medium",
            "rawText": "Would love a quick timer on screen for bone cement curing (Simplex P) during total knees so we don't have to look at the wall clock.",
            "aiRecommendation": "Add a sterile OR countdown timer utility (e.g. Bone Cement / Ischemia timer) accessible directly from omnibar quick actions.",
            "suggestedFixPrompt": "ANTIGRAVITY DIRECTIVE: Build a quick OR countdown timer tool in the omnibar for bone cement curing and tourniquet times.",
            "upvotes": 7,
            "status": "open",
            "createdAt": "2026-10-27T20:00:00Z",
        },
        {
            "id": "fb-seed-004",
            "tenantId": "county_general::er",
            "userName": "Dr. John Carter",
            "userRole": "ER Resident",
            "source": "chat_auto_detected",
            "category": "bug_friction",
            "severity": "low",
            "rawText": "Voice input sometimes cuts off early if monitor alarms are beeping loudly in Trauma Bay 1.",
            "aiRecommendation": "Adjust Web Speech recognition silence debounce threshold and add speech volume/rate sliders in Audio drawer.",
            "suggestedFixPrompt": "ANTIGRAVITY DIRECTIVE: Optimize voice recognition noise filter for loud OR environments and increase debounce timeout from 800ms to 1500ms.",
            "upvotes": 2,
            "status": "resolved",
            "createdAt": "2026-10-27T21:10:00Z",
        },
    ]


# --- Storage Functions ---

def load_feedback_items() -> List[dict]:
    if not FEEDBACK_FILE.exists():
        initial = _get_default_seed()
        save_feedback_items(initial)
        return initial
    try:
        data = json.loads(FEEDBACK_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
    except Exception as e:
        print(f"Error reading feedback file: {e}")
    initial = _get_default_seed()
    save_feedback_items(initial)
    return initial


def save_feedback_items(items: List[dict]) -> None:
    FEEDBACK_FILE.parent.mkdir(parents=True, exist_ok=True)
    FEEDBACK_FILE.write_text(json.dumps(items, indent=2, ensure_ascii=False), encoding="utf-8")


def is_similar(t1: str, t2: str) -> bool:
    """Check if two texts share key complaint vocabulary."""
    w1 = set(re.findall(r"\b[a-zA-Z]{4,}\b", t1.lower()))
    w2 = set(re.findall(r"\b[a-zA-Z]{4,}\b", t2.lower()))
    if not w1 or not w2:
        return False
    overlap = len(w1.intersection(w2))
    return overlap >= 3 or (overlap >= 2 and len(w1) <= 4)


def generate_top_recommendations(items: List[dict]) -> List[str]:
    """Generate top 3 actionable developer recommendations from open feedback."""
    open_items = [it for it in items if it.get("status") == "open"]
    def score(it):
        sev_weight = {"high": 300, "medium": 200, "low": 100}.get(it.get("severity", "low"), 100)
        return sev_weight + (it.get("upvotes", 1) * 5)
    open_items.sort(key=score, reverse=True)

    recs = []
    for it in open_items[:3]:
        cat_badge = {"ui_ux": "UI/UX", "bug_friction": "Bug Fix", "data_inventory": "Data", "feature_request": "Feature"}.get(it.get("category", ""), "Update")
        rec_text = f"🔥 [{cat_badge}] {it.get('aiRecommendation', '')} ({it.get('upvotes', 1)} upvotes)"
        recs.append(rec_text)
    return recs


# --- Endpoints ---

@router.get("", response_model=FeedbackListResponse)
async def list_feedback(
    tenant_id: Optional[str] = Query(None, alias="tenantId"),
    category: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    sort_by: Optional[str] = Query("priority", alias="sortBy"),  # "priority" | "upvotes" | "newest"
):
    """List feedback items sorted by Priority Score along with synthesized topRecommendations."""
    items = load_feedback_items()

    # Optional filter by tenant (or facility part of tenant)
    if tenant_id:
        clean_tid = tenant_id.strip()
        fac = clean_tid.split("::")[0].split("/")[0]
        items = [
            it for it in items
            if it.get("tenantId") == clean_tid or it.get("tenantId", "").startswith(f"{fac}::") or it.get("tenantId", "").startswith(f"{fac}/")
        ]

    # Category filter
    if category and category != "all":
        items = [it for it in items if it.get("category") == category]

    # Status filter
    if status and status != "all":
        items = [it for it in items if it.get("status") == status]

    # Sorting
    if sort_by == "upvotes":
        items.sort(key=lambda x: x.get("upvotes", 0), reverse=True)
    elif sort_by == "newest":
        items.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
    else:
        # Default: Priority sort (high severity open items first, then by upvotes, then newest)
        def priority_score(x):
            sev_weight = {"high": 300, "medium": 200, "low": 100}.get(x.get("severity", "low"), 100)
            status_weight = {"open": 50, "planned": 20, "resolved": 0}.get(x.get("status", "open"), 50)
            upvotes = x.get("upvotes", 1)
            return sev_weight + status_weight + (upvotes * 5)

        items.sort(key=priority_score, reverse=True)

    top_recs = generate_top_recommendations(items)
    return FeedbackListResponse(items=items, topRecommendations=top_recs)


@router.post("", response_model=FeedbackItem)
async def create_or_intercept_feedback(req: CreateFeedbackRequest):
    """
    Create a feedback item or merge/upvote if a similar complaint already exists.
    Auto-classifies category & severity and synthesizes AI recommendation + prompt if omitted.
    """
    raw = req.rawText.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="rawText must not be empty.")

    items = load_feedback_items()

    # 1. Similarity check for auto-upvote merging on open items
    for item in items:
        if item.get("status") in ["open", "planned"] and is_similar(item.get("rawText", ""), raw):
            item["upvotes"] = item.get("upvotes", 1) + 1
            save_feedback_items(items)
            return item

    # 2. Determine category & severity
    category = req.category
    severity = req.severity
    if not category or not severity:
        auto_cat, auto_sev = classify_text(raw)
        category = category or auto_cat
        severity = severity or auto_sev

    # 3. Synthesize recommendations
    ai_rec = req.aiRecommendation
    fix_prompt = req.suggestedFixPrompt
    if not ai_rec or not fix_prompt:
        synth_rec, synth_prompt = synthesize_recommendations(raw, category, severity)
        ai_rec = ai_rec or synth_rec
        fix_prompt = fix_prompt or synth_prompt

    new_item = {
        "id": f"fb-{uuid.uuid4().hex[:8]}",
        "tenantId": req.tenantId or "sacred_heart::or",
        "userName": req.userName or "Staff Clinician",
        "userRole": req.userRole or "Circulating RN",
        "source": req.source or "manual_submission",
        "category": category,
        "severity": severity,
        "rawText": raw,
        "aiRecommendation": ai_rec,
        "suggestedFixPrompt": fix_prompt,
        "upvotes": 1,
        "status": "open",
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }

    items.insert(0, new_item)
    save_feedback_items(items)
    return new_item


@router.patch("/{feedback_id}", response_model=FeedbackItem)
async def patch_feedback(feedback_id: str, req: PatchFeedbackRequest):
    """Update status or increment upvote on a feedback item."""
    items = load_feedback_items()
    for item in items:
        if item.get("id") == feedback_id:
            if req.upvote:
                item["upvotes"] = item.get("upvotes", 1) + 1
            if req.status:
                valid_statuses = ["open", "planned", "resolved"]
                if req.status not in valid_statuses:
                    raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of {valid_statuses}")
                item["status"] = req.status
            save_feedback_items(items)
            return item
    raise HTTPException(status_code=404, detail="Feedback item not found.")


@router.post("/{feedback_id}/upvote", response_model=FeedbackItem)
async def upvote_feedback(feedback_id: str):
    """Upvote an existing feedback item."""
    items = load_feedback_items()
    for item in items:
        if item.get("id") == feedback_id:
            item["upvotes"] = item.get("upvotes", 1) + 1
            save_feedback_items(items)
            return item
    raise HTTPException(status_code=404, detail="Feedback item not found.")


@router.patch("/{feedback_id}/status", response_model=FeedbackItem)
async def update_feedback_status(feedback_id: str, req: UpdateStatusRequest):
    """Update status of a feedback item (open, planned, resolved)."""
    valid_statuses = ["open", "planned", "resolved"]
    if req.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of {valid_statuses}")

    items = load_feedback_items()
    for item in items:
        if item.get("id") == feedback_id:
            item["status"] = req.status
            save_feedback_items(items)
            return item
    raise HTTPException(status_code=404, detail="Feedback item not found.")


@router.delete("/{feedback_id}")
async def delete_feedback(feedback_id: str):
    """Delete a feedback item."""
    items = load_feedback_items()
    filtered = [it for it in items if it.get("id") != feedback_id]
    if len(filtered) == len(items):
        raise HTTPException(status_code=404, detail="Feedback item not found.")
    save_feedback_items(filtered)
    return {"deleted": True, "id": feedback_id}
