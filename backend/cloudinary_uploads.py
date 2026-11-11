"""Server-owned Cloudinary parameters; never sign arbitrary client input."""
import hashlib
import os
import time
from uuid import uuid4

from fastapi import HTTPException


def signed_upload(folder: str, *, document: bool = False) -> dict:
    api_key = os.getenv("CLOUDINARY_API_KEY", "").strip()
    secret = os.getenv("CLOUDINARY_API_SECRET", "").strip()
    preset = os.getenv("CLOUDINARY_SIGNED_UPLOAD_PRESET", "").strip()
    if not api_key or not secret or not preset:
        raise HTTPException(503, "Secure uploads are not configured. Contact the administrator.")
    params = {
        "allowed_formats": "jpg,jpeg,png,webp,pdf" if document else "jpg,jpeg,png,webp",
        "folder": folder,
        "public_id": uuid4().hex,
        "overwrite": "false",
        "timestamp": str(int(time.time())),
        "upload_preset": preset,
    }
    canonical = "&".join(f"{key}={params[key]}" for key in sorted(params))
    signature = hashlib.sha256((canonical + secret).encode()).hexdigest()
    return {**params, "api_key": api_key, "signature": signature}
