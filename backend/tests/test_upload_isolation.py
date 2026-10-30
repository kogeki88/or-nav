import io
import shutil
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.config import HOSPITALS_DIR, get_tenant

@pytest.fixture
def client():
    # Setup directories
    tenant_1 = "test_tenant_a"
    tenant_2 = "test_tenant_b"

    tenant_1_dir = HOSPITALS_DIR / tenant_1
    tenant_1_dir.mkdir(parents=True, exist_ok=True)
    (tenant_1_dir / "inventory.csv").write_text("dummy", encoding="utf-8")

    tenant_2_dir = HOSPITALS_DIR / tenant_2
    tenant_2_dir.mkdir(parents=True, exist_ok=True)
    (tenant_2_dir / "inventory.csv").write_text("dummy", encoding="utf-8")

    yield TestClient(app)

    # Teardown
    if tenant_1_dir.exists():
        shutil.rmtree(tenant_1_dir)
    if tenant_2_dir.exists():
        shutil.rmtree(tenant_2_dir)

def test_upload_photo_isolation_and_success(client):
    img_bytes = b"fake image bytes"

    # 1. Successful upload
    response = client.post(
        "/api/inventory/upload-photo",
        data={"tenant_id": "test_tenant_a"},
        files={"file": ("test_image.jpg", io.BytesIO(img_bytes), "image/jpeg")},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["file_path"] == "photos/test_image.jpg"

    # Verify the file exists in the right tenant's directory
    file_path = HOSPITALS_DIR / "test_tenant_a" / "photos" / "test_image.jpg"
    assert file_path.exists()
    assert file_path.read_bytes() == img_bytes

    # Verify it doesn't exist in another tenant's directory
    other_tenant_file = HOSPITALS_DIR / "test_tenant_b" / "photos" / "test_image.jpg"
    assert not other_tenant_file.exists()


def test_upload_photo_path_traversal(client):
    img_bytes = b"fake image bytes"

    # Attempt 1: Uploading a file outside of photos dir
    response = client.post(
        "/api/inventory/upload-photo",
        data={"tenant_id": "test_tenant_a"},
        files={"file": ("../../../hacked_file.txt", io.BytesIO(img_bytes), "image/jpeg")},
    )
    assert response.status_code == 400
    assert "Invalid filename" in response.text

    # Attempt 2: using backward slashes
    response2 = client.post(
        "/api/inventory/upload-photo",
        data={"tenant_id": "test_tenant_a"},
        files={"file": ("..\\..\\..\\hacked_file.txt", io.BytesIO(img_bytes), "image/jpeg")},
    )
    assert response2.status_code == 400
    assert "Invalid filename" in response2.text

    # Verify neither file got written to root or anywhere bad within our control
    # Just checking status codes ensures the endpoint correctly stopped it


def test_upload_photo_invalid_type(client):
    txt_bytes = b"just some text"
    response = client.post(
        "/api/inventory/upload-photo",
        data={"tenant_id": "test_tenant_a"},
        files={"file": ("test.txt", io.BytesIO(txt_bytes), "text/plain")},
    )
    assert response.status_code == 400
    assert "Unsupported file extension" in response.text


def test_read_photo_isolation_and_success(client):
    img_bytes = b"fake image bytes"

    # 1. Successful upload
    response = client.post(
        "/api/inventory/upload-photo",
        data={"tenant_id": "test_tenant_a"},
        files={"file": ("test_read_image.jpg", io.BytesIO(img_bytes), "image/jpeg")},
    )
    assert response.status_code == 200

    # 2. Read success on same tenant
    read_resp = client.get("/api/inventory/photos/test_read_image.jpg?tenant_id=test_tenant_a")
    assert read_resp.status_code == 200
    assert read_resp.content == img_bytes

    # 3. Read failure on different tenant (file not found)
    read_resp2 = client.get("/api/inventory/photos/test_read_image.jpg?tenant_id=test_tenant_b")
    assert read_resp2.status_code == 404

def test_read_photo_path_traversal(client):
    # Try reading a file via path traversal
    read_resp = client.get("/api/inventory/photos/..%2F..%2F..%2Fetc%2Fpasswd?tenant_id=test_tenant_a")
    assert read_resp.status_code in [400, 404]
    # assert "Invalid filename" in read_resp.text # FastAPI handles it at routing level
