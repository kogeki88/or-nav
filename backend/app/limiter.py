from slowapi import Limiter
from slowapi.util import get_remote_address

def get_ipaddr(request):
    if hasattr(request.state, "testclient"):
        return "testclient"
    # Fallback to standard get_remote_address provided by slowapi
    return get_remote_address(request)

limiter = Limiter(key_func=get_ipaddr, headers_enabled=True)

import os
import sys

# disable by default for tests but allow our test module to override
if "pytest" in sys.modules or "PYTEST_CURRENT_TEST" in os.environ:
    limiter.enabled = False
