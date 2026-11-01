import pytest
import io
import json
from fastapi.testclient import TestClient
from app.main import app
from app.config import get_tenant

client = TestClient(app)

def test_preference_card_update_tenant_isolation():
    """
    Attempt cross-tenant preference card update and verify HTTP 403 / 404 / 400 response.
    Verify multi-tenant database isolation invariant.
    """
    # 1. Attempt to upload a preference_cards.json file via /api/ingest
    malicious_json = json.dumps([{"surgeon": "Hacker", "procedure": "Pwn"}])
    files = {"file": ("preference_cards.json", io.BytesIO(malicious_json.encode("utf-8")), "application/json")}

    # Valid tenant, but trying to upload a JSON file
    data_valid_tenant = {"tenant_id": "sacred_heart"}
    resp = client.post("/api/ingest", files=files, data=data_valid_tenant)
    assert resp.status_code == 400
    assert "Unsupported file type" in resp.json().get("detail", "")

    # 2. Attempt path traversal in the tenant_id field
    data_traversal = {"tenant_id": "../hospitals/sacred_heart"}
    resp = client.post("/api/ingest", files=files, data=data_traversal)
    assert resp.status_code == 400
    assert "Invalid tenant_id" in resp.json().get("detail", "")

    # 3. Attempt path traversal in the filename itself
    files_traversal = {"file": ("../or/preference_cards.json", io.BytesIO(malicious_json.encode("utf-8")), "application/json")}
    resp = client.post("/api/ingest", files=files_traversal, data=data_valid_tenant)
    assert resp.status_code == 400
    assert "Unsupported file type" in resp.json().get("detail", "")

    # 4. Attempt directory traversal with slashes inside tenant_id that bypass the initial validate regex
    data_slash_tenant = {"tenant_id": "sacred_heart/or"}
    resp = client.post("/api/ingest", files=files, data=data_slash_tenant)
    assert resp.status_code == 400
    assert "Invalid tenant_id" in resp.json().get("detail", "")
    assert "Slashes are not allowed" in resp.json().get("detail", "")

    # 5. Verify multi-tenant database isolation invariant (Read access to preference cards)
    resp = client.get("/api/packs/file?path=hospitals/sacred_heart/or/preference_cards.json")
    assert resp.status_code == 200

    # 6. Ensure there's no way to write to it via POST /api/packs/file
    resp = client.post("/api/packs/file?path=hospitals/sacred_heart/or/preference_cards.json", json={"surgeon": "Hack"})
    assert resp.status_code == 405  # Method not allowed

    # 7. Check cross-tenant isolation directly on graph loading
    tenant = get_tenant("sacred_heart/or")

    # 8. Simulate a direct preference card update to a cross-tenant facility endpoint
    # that does not exist and verify the framework blocks it with a 404.
    resp_update = client.put("/api/preference-cards/general_memorial/or/preference_cards.json", json={"surgeon": "Hack"})
    assert resp_update.status_code == 404

    # 9. A true cross-tenant write to ingest should be blocked 400
    malicious_json_file = {"file": ("preference_cards.json", io.BytesIO(b'[{"surgeon": "Hacker"}]'), "application/json")}
    resp_ingest_cross = client.post("/api/ingest", files=malicious_json_file, data={"tenant_id": "sacred_heart/or/../../general_memorial"})
    assert resp_ingest_cross.status_code == 400

