"""LiBot panorama reconstruction API."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import List
from uuid import uuid4

import cv2
import httpx
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.types import ASGIApp, Receive, Scope, Send

try:
    from .services.panorama_service import analyze_image_sequence, StitchingError, build_four_view_panorama, reconstruct_hybrid_panorama, stitch_images
except ImportError:  # Supports `uvicorn main:app` when launched inside /backend.
    from services.panorama_service import analyze_image_sequence, StitchingError, build_four_view_panorama, reconstruct_hybrid_panorama, stitch_images

BASE_DIR = Path(__file__).resolve().parent
default_output_dir = Path("/tmp/libot-outputs") if os.getenv("VERCEL") else BASE_DIR / "outputs"
OUTPUT_DIR = Path(os.getenv("PANORAMA_OUTPUT_DIR", str(default_output_dir)))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
MAX_FILE_BYTES = 15 * 1024 * 1024
MAX_TOTAL_BYTES = 120 * 1024 * 1024
CLOUDINARY_CLOUD_NAME = os.getenv("CLOUDINARY_CLOUD_NAME", "dpnsayn8m")
CLOUDINARY_UPLOAD_PRESET = os.getenv("CLOUDINARY_UPLOAD_PRESET", "libot_uploads")


class StripVercelServicePrefix:
    """Let the same FastAPI app run locally and behind Vercel's service prefix."""

    def __init__(self, app: ASGIApp, prefix: str = "/api/backend") -> None:
        self.app = app
        self.prefix = prefix

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope.get("path", "").startswith(self.prefix):
            scope = dict(scope)
            stripped = scope["path"][len(self.prefix):]
            scope["path"] = stripped or "/"
            scope["raw_path"] = scope["path"].encode("utf-8")
        await self.app(scope, receive, send)

allowed_origins = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if origin.strip()
]

app = FastAPI(
    title="LiBot Panorama API",
    description="ORB/SIFT feature-based panorama reconstruction with RANSAC alignment metrics.",
    version="1.0.0",
)
app.add_middleware(StripVercelServicePrefix)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.mount("/outputs", StaticFiles(directory=str(OUTPUT_DIR)), name="outputs")


@app.get("/")
def home():
    return {
        "message": "LiBot Panorama API Running",
        "algorithms": ["orb", "sift"],
        "docs": "/docs",
    }


@app.get("/health")
def health():
    return {"status": "healthy", "opencv_version": cv2.__version__, "sift_available": hasattr(cv2, "SIFT_create")}


async def read_uploaded_images(files: List[UploadFile]) -> tuple[list[np.ndarray], list[str]]:
    images: list[np.ndarray] = []
    filenames: list[str] = []
    total_bytes = 0
    for index, upload in enumerate(files, start=1):
        if upload.content_type and not upload.content_type.startswith("image/"):
            raise HTTPException(status_code=415, detail=f"File {index} is not a supported image.")
        contents = await upload.read(MAX_FILE_BYTES + 1)
        await upload.close()
        if not contents:
            raise HTTPException(status_code=422, detail=f"File {index} is empty.")
        if len(contents) > MAX_FILE_BYTES:
            raise HTTPException(status_code=413, detail=f"File {index} exceeds the 15 MB limit.")
        total_bytes += len(contents)
        if total_bytes > MAX_TOTAL_BYTES:
            raise HTTPException(status_code=413, detail="Combined uploads exceed the 120 MB limit.")
        image = cv2.imdecode(np.frombuffer(contents, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise HTTPException(status_code=422, detail=f"File {index} could not be decoded as an image.")
        if min(image.shape[:2]) < 100:
            raise HTTPException(status_code=422, detail=f"File {index} is too small for reliable feature matching.")
        images.append(image)
        filenames.append(upload.filename or f"Image {index}")
    return images, filenames


async def upload_generated_image(contents: bytes, filename: str, content_type: str) -> str:
    """Persist a generated tour asset outside the serverless filesystem."""
    upload_url = f"https://api.cloudinary.com/v1_1/{CLOUDINARY_CLOUD_NAME}/image/upload"
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(
                upload_url,
                data={"upload_preset": CLOUDINARY_UPLOAD_PRESET, "folder": "libot/virtual-tours"},
                files={"file": (filename, contents, content_type)},
            )
            response.raise_for_status()
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail="Persistent image storage rejected the generated tour asset.") from error
    secure_url = response.json().get("secure_url")
    if not isinstance(secure_url, str) or not secure_url.startswith("https://"):
        raise HTTPException(status_code=502, detail="Persistent image storage did not return a valid URL.")
    return secure_url


@app.post("/validate")
async def validate_images(files: List[UploadFile] = File(...), algorithm: str = Form("orb")):
    if not 2 <= len(files) <= 30:
        raise HTTPException(status_code=422, detail="Upload between 2 and 30 overlapping images.")
    normalized_algorithm = algorithm.strip().lower()
    if normalized_algorithm not in {"orb", "sift"}:
        raise HTTPException(status_code=422, detail="Algorithm must be either 'orb' or 'sift'.")
    images, filenames = await read_uploaded_images(files)
    try:
        analysis = await run_in_threadpool(analyze_image_sequence, images, filenames, normalized_algorithm)
    except StitchingError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {"success": True, "analysis": analysis}


@app.post("/stitch", status_code=status.HTTP_201_CREATED)
async def stitch(
    files: List[UploadFile] = File(...),
    algorithm: str = Form("orb"),
    ransac_threshold: float = Form(4.0),
):
    if not 2 <= len(files) <= 30:
        raise HTTPException(status_code=422, detail="Upload between 2 and 30 overlapping images.")
    normalized_algorithm = algorithm.strip().lower()
    if normalized_algorithm not in {"orb", "sift"}:
        raise HTTPException(status_code=422, detail="Algorithm must be either 'orb' or 'sift'.")

    images, _ = await read_uploaded_images(files)

    try:
        panorama, metrics = await run_in_threadpool(
            stitch_images,
            images,
            normalized_algorithm,
            ransac_threshold,
        )
    except StitchingError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except cv2.error as error:
        raise HTTPException(status_code=500, detail="OpenCV failed while reconstructing the panorama.") from error

    filename = f"panorama-{uuid4().hex}.jpg"
    output_path = OUTPUT_DIR / filename
    saved = await run_in_threadpool(cv2.imwrite, str(output_path), panorama, [cv2.IMWRITE_JPEG_QUALITY, 95])
    if not saved:
        raise HTTPException(status_code=500, detail="The generated panorama could not be saved.")

    return {
        "success": True,
        "panorama": f"outputs/{filename}",
        "panorama_url": f"/outputs/{filename}",
        "metrics": metrics,
    }


@app.post("/reconstruct/hybrid", status_code=status.HTTP_201_CREATED)
async def reconstruct_hybrid(
    files: List[UploadFile] = File(...),
    algorithm: str = Form("orb"),
    ransac_threshold: float = Form(4.0),
    fill_gaps: bool = Form(True),
):
    """Evidence-first reconstruction with an auditable missing-region mask."""
    if not 6 <= len(files) <= 12:
        raise HTTPException(status_code=422, detail="Upload 6 to 12 guided landscape images in capture order.")
    normalized_algorithm = algorithm.strip().lower()
    if normalized_algorithm not in {"orb", "sift"}:
        raise HTTPException(status_code=422, detail="Algorithm must be either 'orb' or 'sift'.")
    images, filenames = await read_uploaded_images(files)
    try:
        panorama, generated_mask, metadata = await run_in_threadpool(
            reconstruct_hybrid_panorama,
            images,
            filenames,
            normalized_algorithm,
            ransac_threshold,
            fill_gaps,
        )
    except StitchingError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except cv2.error as error:
        raise HTTPException(status_code=500, detail="OpenCV failed during hybrid reconstruction.") from error

    identifier = uuid4().hex
    panorama_name = f"hybrid-{identifier}.jpg"
    mask_name = f"hybrid-{identifier}-ai-mask.png"
    panorama_encoded, mask_encoded = await run_in_threadpool(
        lambda: (
            cv2.imencode(".jpg", panorama, [cv2.IMWRITE_JPEG_QUALITY, 95]),
            cv2.imencode(".png", generated_mask),
        )
    )
    if not panorama_encoded[0] or not mask_encoded[0]:
        raise HTTPException(status_code=500, detail="The panorama or disclosure mask could not be encoded.")
    panorama_url, mask_url = await asyncio.gather(
        upload_generated_image(panorama_encoded[1].tobytes(), panorama_name, "image/jpeg"),
        upload_generated_image(mask_encoded[1].tobytes(), mask_name, "image/png"),
    )
    return {
        "success": True,
        "panorama_url": panorama_url,
        "ai_mask_url": mask_url,
        "storage": "cloudinary",
        "metadata": metadata,
    }


@app.post("/stitch/four-view", status_code=status.HTTP_201_CREATED)
async def stitch_four_view(
    front: UploadFile = File(...),
    left: UploadFile = File(...),
    right: UploadFile = File(...),
    top: UploadFile = File(...),
):
    images: dict[str, np.ndarray] = {}
    for label, upload in (("front", front), ("left", left), ("right", right), ("top", top)):
        if upload.content_type and not upload.content_type.startswith("image/"):
            raise HTTPException(status_code=415, detail=f"The {label} file is not a supported image.")
        contents = await upload.read(MAX_FILE_BYTES + 1)
        await upload.close()
        if not contents or len(contents) > MAX_FILE_BYTES:
            raise HTTPException(status_code=413 if contents else 422, detail=f"The {label} image is empty or exceeds 15 MB.")
        image = cv2.imdecode(np.frombuffer(contents, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise HTTPException(status_code=422, detail=f"The {label} file could not be decoded as an image.")
        images[label] = image

    try:
        panorama, metrics = await run_in_threadpool(
            build_four_view_panorama,
            images["front"],
            images["left"],
            images["right"],
            images["top"],
        )
    except StitchingError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    filename = f"four-view-{uuid4().hex}.jpg"
    output_path = OUTPUT_DIR / filename
    saved = await run_in_threadpool(cv2.imwrite, str(output_path), panorama, [cv2.IMWRITE_JPEG_QUALITY, 95])
    if not saved:
        raise HTTPException(status_code=500, detail="The four-view panorama could not be saved.")
    return {
        "success": True,
        "panorama": f"outputs/{filename}",
        "panorama_url": f"/outputs/{filename}",
        "metrics": metrics,
    }
