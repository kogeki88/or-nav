from unittest.mock import patch, MagicMock
from app.main import _mask_api_key, get_lan_ip


def test_mask_api_key():
    # Empty string
    assert _mask_api_key("") == "***"

    # None-like string
    assert _mask_api_key("your-api-key-here") == "your...here"

    # Length < 8
    assert _mask_api_key("short") == "***"
    assert _mask_api_key("1234567") == "***"

    # Length >= 8
    assert _mask_api_key("12345678") == "1234...5678"
    assert _mask_api_key("AIzaSyTestKey1234567890abcd") == "AIza...abcd"


class TestGetLanIp:
    @patch('app.main.socket.socket')
    def test_get_lan_ip_success(self, mock_socket):
        # Setup the mock socket
        mock_socket_instance = MagicMock()
        mock_socket.return_value = mock_socket_instance

        # Configure the mock to return a specific IP when getsockname is called
        mock_socket_instance.getsockname.return_value = ('192.168.1.100', 54321)

        # Call the function
        ip = get_lan_ip()

        # Verify the result
        assert ip == '192.168.1.100'

        # Verify socket operations
        mock_socket.assert_called_once()
        mock_socket_instance.connect.assert_called_once_with(('8.8.8.8', 80))
        mock_socket_instance.getsockname.assert_called_once()
        mock_socket_instance.close.assert_called_once()

    @patch('app.main.socket.socket')
    def test_get_lan_ip_socket_creation_fails(self, mock_socket):
        # Simulate socket creation failure
        mock_socket.side_effect = Exception("Socket creation failed")

        # Call the function
        ip = get_lan_ip()

        # Verify fallback IP is returned
        assert ip == '127.0.0.1'

    @patch('app.main.socket.socket')
    def test_get_lan_ip_connect_fails(self, mock_socket):
        # Setup the mock socket
        mock_socket_instance = MagicMock()
        mock_socket.return_value = mock_socket_instance

        # Simulate connection failure
        mock_socket_instance.connect.side_effect = Exception("Network unreachable")

        # Call the function
        ip = get_lan_ip()

        # Verify fallback IP is returned
        assert ip == '127.0.0.1'

        # Verify the exception happened during connect
        mock_socket_instance.connect.assert_called_once()
        mock_socket_instance.getsockname.assert_not_called()
