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
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.config import settings, list_tenants
from app.routers.chat import router as chat_router
from app.routers.voice import router as voice_router
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
    version="0.1.0",
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
