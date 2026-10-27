# OR-Nav — CVOR Clinical Assistant

> HIPAA-compliant, voice-first operating room navigation system for Cardiovascular Operating Room (CVOR) teams.

## What is OR-Nav?

OR-Nav is a unified chat-based clinical assistant that helps CVOR staff instantly locate instruments, supplies, and reference critical protocols — via text or voice (push-to-talk).

### Key Features
- **Instant Item Location** — Ask "where is 3-0 silk?" and get giant, readable coordinates: `OR 21 A 2 C`
- **Crowdsourced Move Verification** — When items get moved, staff can report and verify new locations (Google Maps-style consensus)
- **Voice-First** — Push-to-talk integration via LiveKit for hands-free operation in sterile environments
- **Multi-Tenant** — Each hospital/facility has its own inventory and orientation data
- **HIPAA Defense-in-Depth** — Dual PHI scrubbing (client-side + server-side) before any query processing

## Project Structure

```
or-nav/
├── backend/          # Python/FastAPI — Hybrid Query Router
│   ├── app/
│   │   ├── main.py          # FastAPI entry point
│   │   ├── config.py        # Multi-tenant configuration
│   │   ├── scrubber.py      # PHI regex scrubber
│   │   ├── routers/         # API endpoints
│   │   ├── services/        # Business logic (inventory search, RAG)
│   │   └── voice/           # LiveKit agent worker
│   └── tests/
├── frontend/         # React/Next.js — Unified Chat UI
│   └── src/
│       ├── app/             # Next.js App Router pages
│       ├── components/      # UI components (Sidebar, ChatCanvas, Omnibar)
│       └── lib/             # API client, client-side PHI scrubber
├── hospitals/        # Multi-tenant data (one folder per facility)
│   └── general_memorial_cvor/
│       ├── inventory.csv    # Instrument/supply locations with aliases
│       └── orientation.md   # Facility protocols and knowledge base
└── README.md
```

## Getting Started

### Backend
```bash
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1   # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Verify
```bash
curl http://localhost:8000/health
# → {"status": "ok", "app": "OR-Nav", "tenants": ["general_memorial_cvor"]}
```

## Architecture Phases
1. ✅ **Phase 1**: Scaffolding, seed data, PHI scrubber
2. 🔲 **Phase 2**: Hybrid Query Router (Tier 1 CSV + Tier 2 Gemini RAG)
3. 🔲 **Phase 3**: Unified Single-Screen Chat UI
4. 🔲 **Phase 4**: LiveKit Voice Worker Integration
