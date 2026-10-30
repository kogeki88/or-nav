from fastapi import APIRouter, UploadFile, File, HTTPException, Form
import hashlib

router = APIRouter(prefix="/api/ota", tags=["ota"])

@router.post("/upload")
async def handle_ota_upload(
    file: UploadFile = File(...),
    checksum: str = Form(...)
):
    """
    Over-The-Air Package Cryptographic Checksum Verification.
    Reads file strictly into memory and validates SHA-256 checksum.
    Invalid packages are immediately rejected without touching filesystem.
    """
    raw_bytes = await file.read()

    # Calculate SHA-256 hash of the received package bytes in memory
    calculated_hash = hashlib.sha256(raw_bytes).hexdigest()

    if calculated_hash != checksum:
        raise HTTPException(
            status_code=400,
            detail="Corrupted payload: Checksum mismatch. OTA installation aborted."
        )

    return {
        "status": "success",
        "message": "Valid checksum. Package installation verified.",
        "size_bytes": len(raw_bytes)
    }
