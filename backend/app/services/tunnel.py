"""
Cloudflare Quick Tunnel management for OR-Nav.
Automatically starts a free trycloudflare tunnel to port 3000
so mobile devices get a real HTTPS origin with zero configuration.
"""

import threading
import atexit
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_tunnel_url: Optional[str] = None
_tunnel_process = None
_lock = threading.Lock()
_started = False


def start_tunnel_background(port: int = 3000) -> None:
    """Start cloudflared tunnel in a non-blocking background thread."""
    global _started
    with _lock:
        if _started:
            return
        _started = True

    thread = threading.Thread(target=_run_tunnel, args=(port,), daemon=True)
    thread.start()


def _run_tunnel(port: int) -> None:
    global _tunnel_url, _tunnel_process
    try:
        import pycloudflared
        urls = pycloudflared.try_cloudflare(port=port, verbose=False)
        _tunnel_url = urls.tunnel
        _tunnel_process = urls.process
        logger.info(f"Cloudflare HTTPS Tunnel active: {_tunnel_url}")
    except Exception as e:
        logger.warning(f"Could not start Cloudflare tunnel: {e}")
        _tunnel_url = None
        _tunnel_process = None


def get_tunnel_url() -> Optional[str]:
    """Return active HTTPS tunnel URL if available."""
    return _tunnel_url


def stop_tunnel() -> None:
    """Terminate the tunnel process on shutdown."""
    global _tunnel_url, _tunnel_process
    if _tunnel_process is not None:
        try:
            _tunnel_process.terminate()
        except Exception:
            pass
        _tunnel_process = None
        _tunnel_url = None


atexit.register(stop_tunnel)
