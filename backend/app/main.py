"""
OR-Nav FastAPI Application Entry Point.

Phase 1: Health check + CORS setup. Chat router added in Phase 2.
Phase 5: LAN IP discovery endpoint for mobile / tablet QR pairing.
"""

import os
import re
import socket
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import settings, list_tenants
from app.routers.chat import router as chat_router
from app.routers.voice import router as voice_router
from app.peer_qna import router as peer_qna_router
from app.auth import router as auth_router
from app.feedback import router as feedback_router
from app.routers.lexicon import router as lexicon_router
from app.services.rag_fallback import reset_rag_services
from app.services.tunnel import start_tunnel_background, stop_tunnel, get_tunnel_url


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Automatically start zero-config Cloudflare HTTPS tunnel in background
    start_tunnel_background(3000)
    yield
    stop_tunnel()


app = FastAPI(
    title=settings.app_name,
    description="HIPAA-compliant, voice-first CVOR clinical assistant",
    version="0.60.0",
    lifespan=lifespan,
)

# CORS — allow all origins for LAN / mobile flexibility
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(chat_router)
app.include_router(voice_router)
app.include_router(peer_qna_router)
app.include_router(auth_router)
app.include_router(feedback_router)
app.include_router(lexicon_router)


def get_lan_ip() -> str:
    """Detect active local IPv4 address using a non-transmitting UDP socket."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        lan_ip = s.getsockname()[0]
        s.close()
        return lan_ip
    except Exception:
        return "127.0.0.1"


@app.get("/health")
async def health_check():
    """Health check endpoint. Returns available tenants."""
    return {
        "status": "ok",
        "app": settings.app_name,
        "tenants": list_tenants(),
    }


@app.get("/api/tenants")
async def get_tenants():
    """List available hospital tenant directories."""
    return {
        "tenants": list_tenants(),
        "default": settings.default_tenant,
    }


@app.get("/api/network-info")
async def get_network_info():
    """Return local LAN IPv4 address, active HTTPS tunnel URL, and mobile pairing info."""
    lan_ip = get_lan_ip()
    lan_url = f"http://{lan_ip}:3000"
    https_url = get_tunnel_url()
    return {
        "lan_ip": lan_ip,
        "mobile_url": https_url if https_url else lan_url,
        "lan_url": lan_url,
        "https_url": https_url,
        "https_active": bool(https_url),
    }


class GeminiKeyRequest(BaseModel):
    api_key: str


def _mask_api_key(key: str) -> str | None:
    clean = key.strip()
    if not clean or clean == "your-api-key-here":
        return None
    if len(clean) >= 8:
        return f"{clean[:4]}...{clean[-4:]}"
    return f"{clean[:4]}..."


@app.get("/api/config/gemini-status")
async def get_gemini_status():
    """Return current Gemini API key configuration status (masked)."""
    raw_key = os.getenv("GEMINI_API_KEY", "").strip()
    masked = _mask_api_key(raw_key)
    return {
        "configured": masked is not None,
        "masked_key": masked,
        "model": "gemini-2.5-flash",
    }


@app.api_route("/api/download-apk", methods=["GET", "HEAD"])
async def download_apk():
    """Stream OR-Nav APK binary directly for in-app OTA installer."""
    root = Path(__file__).resolve().parent.parent.parent
    candidate_paths = [
        root / "or-nav.apk",
        root / "or-nav-standalone.apk",
        root / "frontend" / "public" / "or-nav.apk",
        root / "frontend" / "out" / "or-nav.apk",
    ]
    for apk_path in candidate_paths:
        if apk_path.exists() and apk_path.stat().st_size > 1000:
            return FileResponse(
                path=str(apk_path),
                media_type="application/vnd.android.package-archive",
                filename="or-nav.apk",
                headers={
                    "Content-Disposition": 'attachment; filename="or-nav.apk"',
                    "Cache-Control": "no-store, no-cache, must-revalidate",
                },
            )
    raise HTTPException(status_code=404, detail="APK package not found on server.")


@app.get("/api/version")
async def get_version(response: Response):
    """Return version manifest for OTA update checking with cache-busting headers."""
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    lan_ip = get_lan_ip()
    v_path = Path(__file__).resolve().parent.parent.parent / "frontend" / "public" / "version.json"
    if v_path.exists():
        try:
            import json
            data = json.loads(v_path.read_text(encoding="utf-8"))
            if lan_ip and not data.get("apk_download_url", "").startswith("https://github.com"):
                data["apk_download_url"] = f"http://{lan_ip}:8000/api/download-apk"
            return data
        except Exception:
            pass

    return {
        "version": "v0.60",
        "build_number": 17,
        "release_date": "2026-10-28",
        "apk_download_url": f"http://{lan_ip or '192.168.1.217'}:8000/api/download-apk",
        "min_supported_version": "v0.1",
        "changelog": "v0.60 (Build 17): Sidebar declutter, unified clinician profile card, split audio and pairing settings, and streamlined system info.",
    }


@app.get("/api/packs/manifest")
async def get_packs_manifest(response: Response):
    """Return hospital knowledge packs master manifest with cache-busting headers."""
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    root = Path(__file__).resolve().parent.parent.parent
    m_path = root / "hospitals" / "manifest.json"
    if m_path.exists():
        import json
        return json.loads(m_path.read_text(encoding="utf-8"))
    raise HTTPException(status_code=404, detail="Packs manifest not found.")


@app.get("/api/packs/file")
async def get_pack_file(path: str, response: Response):
    """Return raw file content for an on-demand hospital resource pack."""
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    clean = path.replace("\\", "/").lstrip("/")
    if ".." in clean:
        raise HTTPException(status_code=400, detail="Invalid path traversal.")
    root = Path(__file__).resolve().parent.parent.parent
    target = root / clean
    if target.exists() and target.is_file():
        content_type = "text/plain; charset=utf-8"
        if target.suffix == ".json":
            content_type = "application/json; charset=utf-8"
        elif target.suffix == ".csv":
            content_type = "text/csv; charset=utf-8"
        elif target.suffix == ".md":
            content_type = "text/markdown; charset=utf-8"
        return Response(content=target.read_text(encoding="utf-8"), media_type=content_type)
    raise HTTPException(status_code=404, detail=f"Pack file {clean} not found.")


@app.post("/api/config/gemini-key")
async def set_gemini_key(body: GeminiKeyRequest):
    """Persistently save GEMINI_API_KEY to backend/.env and hot-reload RAG service."""
    clean_key = body.api_key.strip()
    if not clean_key or clean_key == "your-api-key-here":
        raise HTTPException(status_code=400, detail="API key cannot be empty.")

    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        content = env_path.read_text(encoding="utf-8")
        lines = content.splitlines()
        updated = False
        new_lines = []
        for line in lines:
            if re.match(r"^\s*#?\s*GEMINI_API_KEY\s*=", line):
                if not updated:
                    new_lines.append(f"GEMINI_API_KEY={clean_key}")
                    updated = True
            else:
                new_lines.append(line)
        if not updated:
            new_lines.append(f"GEMINI_API_KEY={clean_key}")
        env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
    else:
        env_path.write_text(f"GEMINI_API_KEY={clean_key}\n", encoding="utf-8")

    os.environ["GEMINI_API_KEY"] = clean_key
    reset_rag_services()

    masked = _mask_api_key(clean_key)
    return {
        "configured": True,
        "masked_key": masked,
        "model": "gemini-2.5-flash",
    }

