"""
Phase 33: Authentication, Account Lifecycle & Profile Onboarding Backend.

Endpoints:
- POST /api/auth/register: Create new account (onboardingCompleted: False).
- POST /api/auth/login: Authenticate email/password.
- POST /api/auth/reset-password: Reset password for existing account.
- PUT /api/auth/profile: Save user clinical assignment & set onboardingCompleted: True.
"""

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional
import uuid
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/auth", tags=["auth"])

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
USERS_FILE = PROJECT_ROOT / "hospitals" / "users.json"


def hash_password(password: str) -> str:
    """Deterministic SHA-256 password hash."""
    return hashlib.sha256((password or "").strip().encode("utf-8")).hexdigest()


DEFAULT_DEMO_USERS: List[Dict[str, Any]] = [
    {
        "userId": "usr-demo-001",
        "email": "sean@sacredheart.org",
        "fullName": "Sean Iglesia, RN",
        "passwordHash": hash_password("password123"),
        "onboardingCompleted": True,
        "profile": {
            "facilityId": "sacred_heart",
            "facilityName": "Sacred Heart Hospital",
            "departmentId": "or_main",
            "clinicalRole": "Circulating RN",
        },
        "createdAt": "2026-10-27T00:00:00Z",
    }
]


def load_users() -> List[Dict[str, Any]]:
    """Load user accounts from disk or initialize with demo seed."""
    if not USERS_FILE.exists():
        save_users(DEFAULT_DEMO_USERS)
        return list(DEFAULT_DEMO_USERS)
    try:
        content = USERS_FILE.read_text(encoding="utf-8")
        data = json.loads(content)
        if isinstance(data, list):
            # Ensure demo account is present
            if not any(u.get("email", "").lower() == "sean@sacredheart.org" for u in data):
                data.insert(0, DEFAULT_DEMO_USERS[0])
                save_users(data)
            return data
        return list(DEFAULT_DEMO_USERS)
    except Exception:
        return list(DEFAULT_DEMO_USERS)


def save_users(users: List[Dict[str, Any]]) -> None:
    """Save user accounts to disk."""
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp_file = USERS_FILE.with_suffix(".tmp")
    temp_file.write_text(json.dumps(users, indent=2, ensure_ascii=False), encoding="utf-8")
    temp_file.replace(USERS_FILE)


def sanitize_user(user: Dict[str, Any]) -> Dict[str, Any]:
    """Strip sensitive fields before sending over REST."""
    sanitized = dict(user)
    sanitized.pop("passwordHash", None)
    return sanitized


# --- Pydantic Request Models ---

class RegisterRequest(BaseModel):
    email: str
    password: str
    fullName: Optional[str] = None
    full_name: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str


class ResetPasswordRequest(BaseModel):
    email: str
    newPassword: Optional[str] = None
    new_password: Optional[str] = None


class UserProfilePayload(BaseModel):
    facilityId: str = "sacred_heart"
    facilityName: str = "Sacred Heart Hospital"
    departmentId: str = "or_main"
    clinicalRole: str = "Circulating RN"


class UpdateProfileRequest(BaseModel):
    userId: Optional[str] = None
    user_id: Optional[str] = None
    email: Optional[str] = None
    fullName: Optional[str] = None
    full_name: Optional[str] = None
    facilityId: Optional[str] = None
    facility_id: Optional[str] = None
    facilityName: Optional[str] = None
    facility_name: Optional[str] = None
    departmentId: Optional[str] = None
    department_id: Optional[str] = None
    clinicalRole: Optional[str] = None
    clinical_role: Optional[str] = None
    profile: Optional[UserProfilePayload] = None


# --- REST Endpoints ---

@router.post("/register")
async def register(req: RegisterRequest):
    """Register a brand-new user account with onboardingCompleted: False."""
    email = req.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="A valid email address is required.")

    password = (req.password or "").strip()
    if len(password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")

    full_name = (req.fullName or req.full_name or email.split("@")[0].title()).strip()

    users = load_users()
    if any(u["email"].lower() == email for u in users):
        raise HTTPException(status_code=400, detail="An account with this email already exists.")

    new_user = {
        "userId": f"usr-{uuid.uuid4().hex[:8]}",
        "email": email,
        "fullName": full_name,
        "passwordHash": hash_password(password),
        "onboardingCompleted": False,
        "profile": None,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    users.append(new_user)
    save_users(users)

    token = f"token-{uuid.uuid4().hex}"
    return {
        "user": sanitize_user(new_user),
        "token": token,
        "onboardingCompleted": False,
    }


@router.post("/login")
async def login(req: LoginRequest):
    """Authenticate user with email and password."""
    email = req.email.strip().lower()
    users = load_users()
    user = next((u for u in users if u["email"].lower() == email), None)

    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    if user.get("passwordHash") != hash_password(req.password):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    token = f"token-{uuid.uuid4().hex}"
    return {
        "user": sanitize_user(user),
        "token": token,
        "onboardingCompleted": bool(user.get("onboardingCompleted", False)),
        "profile": user.get("profile"),
    }


@router.post("/reset-password")
async def reset_password(req: ResetPasswordRequest):
    """Reset password for an existing account."""
    email = req.email.strip().lower()
    new_pw = (req.newPassword or req.new_password or "").strip()
    if len(new_pw) < 4:
        raise HTTPException(status_code=400, detail="New password must be at least 4 characters.")

    users = load_users()
    user = next((u for u in users if u["email"].lower() == email), None)
    if not user:
        raise HTTPException(status_code=404, detail="No account registered with this email.")

    user["passwordHash"] = hash_password(new_pw)
    save_users(users)

    return {
        "success": True,
        "message": "Password updated successfully. You can now sign in.",
    }


@router.put("/profile")
async def update_profile(req: UpdateProfileRequest):
    """Save user clinical assignment and mark onboardingCompleted: True."""
    users = load_users()
    user = None

    u_id = req.userId or req.user_id
    u_email = (req.email or "").strip().lower()

    if u_id:
        user = next((u for u in users if u["userId"] == u_id), None)
    if not user and u_email:
        user = next((u for u in users if u["email"].lower() == u_email), None)

    if not user:
        # Fallback to the first non-demo user or demo user
        user = users[0]

    full_name = req.fullName or req.full_name or (req.profile.fullName if hasattr(req.profile, "fullName") else None) or user.get("fullName", "")
    facility_id = req.facilityId or req.facility_id or (req.profile.facilityId if req.profile else None) or "sacred_heart"
    facility_name = req.facilityName or req.facility_name or (req.profile.facilityName if req.profile else None) or "Sacred Heart Hospital"
    dept_id = req.departmentId or req.department_id or (req.profile.departmentId if req.profile else None) or "or_main"
    clinical_role = req.clinicalRole or req.clinical_role or (req.profile.clinicalRole if req.profile else None) or "Circulating RN"

    user["profile"] = {
        "fullName": full_name,
        "facilityId": facility_id,
        "facilityName": facility_name,
        "departmentId": dept_id,
        "clinicalRole": clinical_role,
    }
    user["fullName"] = full_name
    user["onboardingCompleted"] = True
    save_users(users)

    return {
        "user": sanitize_user(user),
        "onboardingCompleted": True,
        "profile": user["profile"],
    }
