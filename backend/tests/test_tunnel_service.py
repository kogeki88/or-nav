import pytest
from unittest.mock import patch, MagicMock
from app.services.tunnel import (
    start_tunnel_background,
    _run_tunnel,
    get_tunnel_url,
    stop_tunnel,
)
import app.services.tunnel as tunnel_module

@pytest.fixture(autouse=True)
def reset_tunnel_state():
    """Reset the global state of the tunnel module before and after each test."""
    tunnel_module._tunnel_url = None
    tunnel_module._tunnel_process = None
    tunnel_module._started = False
    yield
    tunnel_module._tunnel_url = None
    tunnel_module._tunnel_process = None
    tunnel_module._started = False

def test_tunnel_url_extraction():
    mock_urls = MagicMock()
    mock_urls.tunnel = "https://mock-tunnel.trycloudflare.com"
    mock_urls.process = MagicMock()

    mock_pycloudflared = MagicMock()
    mock_pycloudflared.try_cloudflare.return_value = mock_urls

    with patch.dict('sys.modules', {'pycloudflared': mock_pycloudflared}):
        _run_tunnel(3000)

    assert get_tunnel_url() == "https://mock-tunnel.trycloudflare.com"
    assert tunnel_module._tunnel_process == mock_urls.process

def test_graceful_fallback():
    mock_pycloudflared = MagicMock()
    mock_pycloudflared.try_cloudflare.side_effect = Exception("Failed to start")

    with patch.dict('sys.modules', {'pycloudflared': mock_pycloudflared}):
        _run_tunnel(3000)

    assert get_tunnel_url() is None
    assert tunnel_module._tunnel_process is None

def test_start_tunnel_background():
    with patch("threading.Thread") as mock_thread:
        mock_thread_instance = MagicMock()
        mock_thread.return_value = mock_thread_instance

        start_tunnel_background(3000)

        mock_thread.assert_called_once_with(target=_run_tunnel, args=(3000,), daemon=True)
        mock_thread_instance.start.assert_called_once()
        assert tunnel_module._started is True

        # Calling again should return early
        start_tunnel_background(3000)
        assert mock_thread.call_count == 1

def test_stop_tunnel():
    mock_process = MagicMock()
    tunnel_module._tunnel_process = mock_process
    tunnel_module._tunnel_url = "https://mock.com"

    stop_tunnel()

    mock_process.terminate.assert_called_once()
    assert tunnel_module._tunnel_process is None
    assert tunnel_module._tunnel_url is None

def test_stop_tunnel_exception():
    mock_process = MagicMock()
    mock_process.terminate.side_effect = Exception("Terminate failed")
    tunnel_module._tunnel_process = mock_process
    tunnel_module._tunnel_url = "https://mock.com"

    # Should not raise exception
    stop_tunnel()

    mock_process.terminate.assert_called_once()
    assert tunnel_module._tunnel_process is None
    assert tunnel_module._tunnel_url is None
