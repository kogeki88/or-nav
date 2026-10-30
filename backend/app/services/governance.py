"""
OR-Nav Layer 3 Clinical Governance & Passive Unanswered Questions Service.

Manages `unanswered_questions.json` per hospital tenant:
    - Lists open, tentative, and verified peer questions
    - Captures unanswered orientee questions
    - Allows peer nurses to post `confident` or `tentative_unsure` answers
    - Promotes verified answers (`[Worked — Verify]`) directly into `orientation.md`
      and reloads the tenant's RAGService cache.
"""

import json
import os
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.config import get_tenant, HOSPITALS_DIR
from app.scrubber import scrub_phi
from app.services.rag_fallback import get_rag_service


def sanitize_formula_prefix(val: str) -> str:
    """Neutralize spreadsheet formula injection triggers (=, +, -, @, tab, cr)."""
    s = str(val or "").strip()
    if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
        return f"'{s}"
    return s


class GovernanceService:
    """Thread-safe manager for a tenant's unanswered department questions."""

    def __init__(self, tenant_id: str):
        self.tenant = get_tenant(tenant_id)
        self.questions_path: Path = HOSPITALS_DIR / self.tenant.tenant_id / "unanswered_questions.json"
        self._lock = threading.RLock()
        self._questions: list[dict] = []
        self._audit_log: list[dict] = []
        self._load()

    def _load(self) -> None:
        if not self.questions_path.exists():
            self._questions = []
            return
        try:
            raw = self.questions_path.read_text(encoding="utf-8")
            data = json.loads(raw)
            self._questions = data if isinstance(data, list) else []
        except Exception:
            self._questions = []

    def _save(self) -> None:
        """Persist questions atomically to unanswered_questions.json."""
        self.questions_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.questions_path.with_name(
            f".{self.questions_path.name}.tmp.{uuid.uuid4().hex}"
        )
        try:
            payload = json.dumps(self._questions, indent=2, ensure_ascii=False) + "\n"
            with tmp_path.open("w", encoding="utf-8") as f:
                f.write(payload)
                f.flush()
                os.fsync(f.fileno())

            for attempt in range(5):
                try:
                    os.replace(tmp_path, self.questions_path)
                    break
                except PermissionError:
                    if attempt == 4:
                        raise
                    time.sleep(0.01 * (attempt + 1))
        finally:
            if tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    pass

    def reload(self) -> None:
        with self._lock:
            self._load()

    def list_questions(self, include_verified: bool = True) -> list[dict]:
        with self._lock:
            if include_verified:
                return list(self._questions)
            return [q for q in self._questions if q.get("status") != "verified"]

    def create_question(
        self,
        question_text: str,
        asked_by_role: str = "CVOR Orientee RN",
    ) -> dict:
        clean_q = sanitize_formula_prefix(scrub_phi(question_text.strip()).text)
        norm_key = re.sub(r"[?!.,;:\-_'\"()\s]+", " ", clean_q.lower()).strip()
        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        with self._lock:
            # Vector 8: Deduplicate against existing open/tentative questions
            for existing in self._questions:
                if existing.get("status") in ("open", "answered_tentative", "answered_confident"):
                    ex_key = re.sub(r"[?!.,;:\-_'\"()\s]+", " ", existing.get("question_text", "").lower()).strip()
                    if ex_key == norm_key:
                        return dict(existing)

            new_item = {
                "id": f"q-{uuid.uuid4().hex[:8]}",
                "hospital_id": self.tenant.tenant_id,
                "question_text": clean_q,
                "asked_by_role": asked_by_role.strip() or "CVOR Orientee RN",
                "status": "open",
                "created_at": now_iso,
                "verified_at": None,
                "answers": [],
            }
            self._questions.insert(0, new_item)
            self._save()
        return new_item

    def answer_question(
        self,
        question_id: str,
        answer_text: Optional[str] = None,
        confidence: str = "confident",
        responder_role: str = "CVOR Peer RN",
        promote_to_verified: bool = False,
    ) -> Optional[dict]:
        """
        Add a peer answer ('confident' or 'tentative_unsure') to a question,
        or promote the question + answer to 'verified' (appending to orientation.md).
        """
        with self._lock:
            target: Optional[dict] = None
            for q in self._questions:
                if q.get("id") == question_id:
                    target = q
                    break

            if target is None:
                return None

            now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

            if answer_text and answer_text.strip():
                clean_ans = sanitize_formula_prefix(scrub_phi(answer_text.strip()).text)
                norm_conf = (
                    "tentative_unsure"
                    if confidence in ("tentative_unsure", "unsure", "answered_tentative")
                    else "confident"
                )
                ans_obj = {
                    "id": f"ans-{uuid.uuid4().hex[:6]}",
                    "responder_role": responder_role.strip() or "CVOR Peer RN",
                    "answer_text": clean_ans,
                    "confidence": norm_conf,
                    "created_at": now_iso,
                }
                target.setdefault("answers", []).append(ans_obj)
                if target.get("status") != "verified":
                    target["status"] = (
                        "answered_tentative"
                        if norm_conf == "tentative_unsure"
                        else "answered_confident"
                    )

            if promote_to_verified or confidence == "verified":
                target["status"] = "verified"
                target["verified_at"] = now_iso
                self._promote_to_orientation(target)

            self._save()
            return dict(target)

    def _promote_to_orientation(self, question_obj: dict) -> None:
        """Append a verified peer Q&A entry to the tenant's orientation.md and reload RAG."""
        answers = question_obj.get("answers") or []
        best_answer = answers[-1]["answer_text"] if answers else "Verified by CVOR Preceptor."
        q_text = question_obj.get("question_text", "").strip()

        orient_path = self.tenant.orientation_path
        existing = orient_path.read_text(encoding="utf-8") if orient_path.exists() else ""

        section_header = "## Verified Peer Q&A (Crowdsourced Clinical Governance)"
        q_marker = f"- **Q: {q_text}**"

        if q_marker in existing:
            # Vector 8: Idempotent - already promoted, do not duplicate! Reload RAG and return
            try:
                get_rag_service(self.tenant.tenant_id).reload()
            except Exception:
                pass
            return

        entry_block = f"\n- **Q: {q_text}**\n  - **Verified Answer**: {best_answer}\n"

        if section_header in existing:
            updated = existing.rstrip() + "\n" + entry_block
        else:
            updated = existing.rstrip() + f"\n\n{section_header}\n{entry_block}"

        orient_path.write_text(updated, encoding="utf-8")
        try:
            get_rag_service(self.tenant.tenant_id).reload()
        except Exception:
            pass

    def verify_policy(self, action: str, role: str) -> bool:
        """Enforces clinical policies based on user roles."""
        authorized_roles = {"Circulating RN", "Charge RN", "CRNA", "ICU RN", "ER RN", "PACU RN"}
        if action in ("surgeon_preference_update", "inventory_adjustment"):
            if role in authorized_roles:
                return True
            return False
        return True

    def log_audit_event(self, action: str, details: str, user_role: str) -> dict:
        """Creates an audit record containing a timestamp and the facility ID."""
        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with self._lock:
            event = {
                "id": f"audit-{uuid.uuid4().hex[:8]}",
                "facility_id": self.tenant.tenant_id,
                "timestamp": now_iso,
                "action": action,
                "details": details,
                "user_role": user_role,
            }
            self._audit_log.append(event)
        return event

    def get_audit_trail(self) -> list[dict]:
        """Retrieves logged events."""
        with self._lock:
            return list(self._audit_log)


_gov_services: dict[str, GovernanceService] = {}
_gov_lock = threading.Lock()


def get_governance_service(tenant_id: str) -> GovernanceService:
    with _gov_lock:
        if tenant_id not in _gov_services:
            _gov_services[tenant_id] = GovernanceService(tenant_id)
        return _gov_services[tenant_id]


def reset_governance_services() -> None:
    with _gov_lock:
        _gov_services.clear()
