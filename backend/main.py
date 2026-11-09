"""LiBot panorama reconstruction API."""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
import time
import warnings
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from typing import List, Literal
from urllib.parse import urlsplit
from uuid import uuid4

import cv2
import httpx
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from PIL import Image, UnidentifiedImageError
from PIL.Image import DecompressionBombError, DecompressionBombWarning
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, model_validator
try:
    from .notifications import FirestoreSubscriptionRepository, PushSubscriptionRequest
except ImportError:
    from notifications import FirestoreSubscriptionRepository, PushSubscriptionRequest
from starlette.types import ASGIApp, Receive, Scope, Send

try:
    from .security import (
        ApiSecurityMiddleware,
        FirebaseTokenVerifier,
        SecurityHeadersMiddleware,
        SlidingWindowRateLimiter,
        security_settings,
    )
    from .services.panorama_service import analyze_image_sequence, StitchingError, build_four_view_panorama, reconstruct_hybrid_panorama, stitch_images
except ImportError:  # Supports `uvicorn main:app` when launched inside /backend.
    from security import (
        ApiSecurityMiddleware,
        FirebaseTokenVerifier,
        SecurityHeadersMiddleware,
        SlidingWindowRateLimiter,
        security_settings,
    )
    from services.panorama_service import analyze_image_sequence, StitchingError, build_four_view_panorama, reconstruct_hybrid_panorama, stitch_images

BASE_DIR = Path(__file__).resolve().parent
logger = logging.getLogger(__name__)
STREAM_HEARTBEAT_SECONDS = 10
default_output_dir = Path("/tmp/libot-outputs") if os.getenv("VERCEL") else BASE_DIR / "outputs"
OUTPUT_DIR = Path(os.getenv("PANORAMA_OUTPUT_DIR", str(default_output_dir)))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
MAX_FILE_BYTES = 15 * 1024 * 1024
MAX_TOTAL_BYTES = 120 * 1024 * 1024
MAX_IMAGE_PIXELS = int(os.getenv("PANORAMA_MAX_IMAGE_PIXELS", "12500000"))
MAX_TOTAL_PIXELS = int(os.getenv("PANORAMA_MAX_TOTAL_IMAGE_PIXELS", "100000000"))
ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}
ALLOWED_IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
IMAGE_FORMAT_CONTENT_TYPES = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
}
IMAGE_EXTENSION_FORMATS = {
    "jpg": "JPEG",
    "jpeg": "JPEG",
    "png": "PNG",
    "webp": "WEBP",
}
CLOUDINARY_CLOUD_NAME = os.getenv("CLOUDINARY_CLOUD_NAME", "dpnsayn8m")
CLOUDINARY_UPLOAD_PRESET = os.getenv("CLOUDINARY_UPLOAD_PRESET", "libot_uploads")
CLOUDINARY_SOURCE_FOLDER = os.getenv(
    "CLOUDINARY_SOURCE_FOLDER", "libot/panorama-sources"
).strip("/")
CLOUDINARY_DELIVERY_HOST = "res.cloudinary.com"
MAX_REMOTE_URL_LENGTH = 2048
MAX_REMOTE_DOWNLOAD_SECONDS = 30
MAX_REMOTE_BATCH_SECONDS = 90
SECURITY_SETTINGS = security_settings()
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

if not CLOUDINARY_SOURCE_FOLDER or any(
    not re.fullmatch(r"[A-Za-z0-9_-]+", part)
    for part in CLOUDINARY_SOURCE_FOLDER.split("/")
):
    raise RuntimeError("CLOUDINARY_SOURCE_FOLDER contains unsupported characters.")

cloudinary_source_path_pattern = "/".join(
    re.escape(part) for part in CLOUDINARY_SOURCE_FOLDER.split("/")
)


class RemoteValidationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    image_urls: list[str] = Field(min_length=2, max_length=30)
    algorithm: Literal["orb", "sift"] = "sift"
    ransac_threshold: FiniteFloat = Field(default=4.0, ge=1.0, le=10.0)


class RemoteHybridRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    image_urls: list[str] = Field(min_length=6, max_length=24)
    algorithm: Literal["orb", "sift"] = "sift"
    ransac_threshold: FiniteFloat = Field(default=4.0, ge=1.0, le=10.0)
    fill_gaps: bool = True
    capture_views: list[Literal["around", "top", "bottom"]] | None = Field(default=None, max_length=24)

    @model_validator(mode="after")
    def validate_capture_views(self):
        if self.capture_views is not None and len(self.capture_views) != len(self.image_urls):
            raise ValueError("Provide one capture view for each image URL.")
        return self


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
if "*" in allowed_origins:
    raise RuntimeError("FRONTEND_ORIGINS must list explicit trusted origins; '*' is not allowed.")

app = FastAPI(
    title="LiBot Panorama API",
    description="ORB/SIFT feature-based panorama reconstruction with RANSAC alignment metrics.",
    version="1.0.0",
    docs_url=None if SECURITY_SETTINGS["production"] else "/docs",
    redoc_url=None if SECURITY_SETTINGS["production"] else "/redoc",
    openapi_url=None if SECURITY_SETTINGS["production"] else "/openapi.json",
)
app.add_middleware(StripVercelServicePrefix)
app.add_middleware(
    ApiSecurityMiddleware,
    verifier=FirebaseTokenVerifier(
        SECURITY_SETTINGS["project_id"],
        max_session_age_seconds=SECURITY_SETTINGS["max_session_age_seconds"],
    ),
    limiter=SlidingWindowRateLimiter(),
    max_request_bytes=SECURITY_SETTINGS["max_request_bytes"],
    max_concurrent_jobs=SECURITY_SETTINGS["max_concurrent_jobs"],
    max_upload_seconds=SECURITY_SETTINGS["max_upload_seconds"],
    auth_ip_limit=SECURITY_SETTINGS["auth_ip_limit"],
    auth_ip_window_seconds=SECURITY_SETTINGS["auth_ip_window_seconds"],
    required_roles=SECURITY_SETTINGS["required_roles"],
    trust_proxy_headers=SECURITY_SETTINGS["trust_proxy_headers"],
    policies=SECURITY_SETTINGS["policies"],
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Accept", "Authorization", "Content-Type", "X-Requested-With"],
    expose_headers=[
        "Retry-After",
        "X-Panorama-Capacity",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-Request-ID",
    ],
)
app.add_middleware(
    SecurityHeadersMiddleware,
    production=SECURITY_SETTINGS["production"],
)
app.mount("/outputs", StaticFiles(directory=str(OUTPUT_DIR)), name="outputs")

subscription_repository = FirestoreSubscriptionRepository()


def require_push_configuration() -> None:
    if os.getenv("PUSH_NOTIFICATIONS_ENABLED", "false").lower() != "true":
        raise HTTPException(status_code=503, detail="Push notifications are not enabled for this deployment.")

@app.post("/notifications/subscriptions", status_code=status.HTTP_201_CREATED)
async def register_push_subscription(request: Request, payload: PushSubscriptionRequest):
    require_push_configuration()
    user_id = str(request.state.firebase_user["sub"])
    return await subscription_repository.upsert(user_id, payload)

@app.get("/notifications/subscriptions")
async def list_push_subscriptions(request: Request):
    require_push_configuration()
    return {"subscriptions": await subscription_repository.list(str(request.state.firebase_user["sub"]))}

@app.delete("/notifications/subscriptions/{subscription_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_push_subscription(request: Request, subscription_id: str):
    require_push_configuration()
    if len(subscription_id) > 128 or not re.fullmatch(r"[A-Za-z0-9_-]+", subscription_id):
        raise HTTPException(status_code=422, detail="Invalid subscription ID.")
    await subscription_repository.delete(str(request.state.firebase_user["sub"]), subscription_id)


@app.get("/")
def home():
    return {
        "message": "LiBot Panorama API Running",
        "algorithms": ["orb", "sift"],
        "docs": None if SECURITY_SETTINGS["production"] else "/docs",
    }


@app.get("/health")
def health():
    return {"status": "healthy", "opencv_version": cv2.__version__, "sift_available": hasattr(cv2, "SIFT_create")}


def inspect_image_header(
    contents: bytes,
    label: str,
    *,
    declared_type: str = "",
    expected_format: str | None = None,
) -> tuple[int, int]:
    """Reject unsupported or oversized images before OpenCV allocates pixels."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", DecompressionBombWarning)
            with Image.open(BytesIO(contents)) as candidate:
                width, height = candidate.size
                image_format = candidate.format
                if getattr(candidate, "is_animated", False):
                    raise HTTPException(
                        status_code=415,
                        detail=f"{label} must not be an animated image.",
                    )
                candidate.verify()
    except (UnidentifiedImageError, OSError, SyntaxError):
        raise HTTPException(status_code=422, detail=f"{label} could not be decoded as an image.")
    except (DecompressionBombError, DecompressionBombWarning):
        raise HTTPException(status_code=413, detail=f"{label} has unsafe decoded dimensions.")

    if image_format not in ALLOWED_IMAGE_FORMATS:
        raise HTTPException(status_code=415, detail=f"{label} must be a JPEG, PNG, or WEBP image.")
    if declared_type and IMAGE_FORMAT_CONTENT_TYPES[image_format] != declared_type:
        raise HTTPException(
            status_code=415,
            detail=f"{label} content does not match its declared image type.",
        )
    if expected_format and image_format != expected_format:
        raise HTTPException(
            status_code=415,
            detail=f"{label} content does not match its storage extension.",
        )
    if width * height > MAX_IMAGE_PIXELS:
        raise HTTPException(
            status_code=413,
            detail=f"{label} exceeds the {MAX_IMAGE_PIXELS:,}-pixel decoded-image limit.",
        )
    if min(width, height) < 100:
        raise HTTPException(status_code=422, detail=f"{label} is too small for reliable feature matching.")
    return width, height


async def decode_uploaded_image(
    upload: UploadFile,
    label: str,
    *,
    remaining_bytes: int | None = None,
    remaining_pixels: int | None = None,
) -> tuple[np.ndarray, int, int]:
    declared_type = (upload.content_type or "").split(";", 1)[0].strip().lower()
    if declared_type and declared_type not in ALLOWED_IMAGE_CONTENT_TYPES:
        await upload.close()
        raise HTTPException(status_code=415, detail=f"{label} is not a supported image.")
    contents = await upload.read(MAX_FILE_BYTES + 1)
    await upload.close()
    return await decode_image_contents(
        contents,
        label,
        declared_type=declared_type,
        remaining_bytes=remaining_bytes,
        remaining_pixels=remaining_pixels,
    )


async def decode_image_contents(
    contents: bytes,
    label: str,
    *,
    declared_type: str = "",
    expected_format: str | None = None,
    remaining_bytes: int | None = None,
    remaining_pixels: int | None = None,
) -> tuple[np.ndarray, int, int]:
    if declared_type and declared_type not in ALLOWED_IMAGE_CONTENT_TYPES:
        raise HTTPException(status_code=415, detail=f"{label} is not a supported image.")
    if not contents:
        raise HTTPException(status_code=422, detail=f"{label} is empty.")
    if len(contents) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail=f"{label} exceeds the 15 MB limit.")
    if remaining_bytes is not None and len(contents) > remaining_bytes:
        raise HTTPException(status_code=413, detail="Combined uploads exceed the 120 MB limit.")

    width, height = await run_in_threadpool(
        inspect_image_header,
        contents,
        label,
        declared_type=declared_type,
        expected_format=expected_format,
    )
    pixel_count = width * height
    if remaining_pixels is not None and pixel_count > remaining_pixels:
        raise HTTPException(
            status_code=413,
            detail="Combined decoded image dimensions exceed the processing limit.",
        )
    image = await run_in_threadpool(
        cv2.imdecode,
        np.frombuffer(contents, np.uint8),
        cv2.IMREAD_COLOR,
    )
    if image is None:
        raise HTTPException(status_code=422, detail=f"{label} could not be decoded as an image.")
    return image, len(contents), pixel_count


def cloudinary_owner_folder_id(user_id: str) -> str:
    return sha256(user_id.encode("utf-8")).hexdigest()[:24]


def validate_cloudinary_source_url(value: str, user_id: str) -> str:
    """Accept only versioned image assets from the configured Cloudinary folder."""
    if (
        not value
        or len(value) > MAX_REMOTE_URL_LENGTH
        or not value.isascii()
        or value != value.strip()
        or any(ord(character) <= 32 or ord(character) == 127 for character in value)
        or "%" in value
        or "\\" in value
    ):
        raise HTTPException(status_code=422, detail="A source image URL is invalid.")
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as error:
        raise HTTPException(status_code=422, detail="A source image URL is invalid.") from error

    if (
        parsed.scheme != "https"
        or parsed.hostname != CLOUDINARY_DELIVERY_HOST
        or parsed.netloc != CLOUDINARY_DELIVERY_HOST
        or port not in {None, 443}
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise HTTPException(
            status_code=422,
            detail="Source images must come from the configured Cloudinary panorama folder.",
        )
    owner_folder = cloudinary_owner_folder_id(user_id)
    source_pattern = re.compile(
        rf"^/{re.escape(CLOUDINARY_CLOUD_NAME)}/image/upload/"
        rf"v[1-9][0-9]*/{cloudinary_source_path_pattern}/"
        rf"{owner_folder}/[A-Za-z0-9_-]{{1,128}}\.(?:jpe?g|png|webp)$",
        re.IGNORECASE,
    )
    if not source_pattern.fullmatch(parsed.path):
        raise HTTPException(
            status_code=422,
            detail="Source images must come from your Cloudinary panorama folder.",
        )
    return value


async def read_remote_images(
    image_urls: list[str],
    user_id: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> tuple[list[np.ndarray], list[str]]:
    if len(set(image_urls)) != len(image_urls):
        raise HTTPException(status_code=422, detail="Source image URLs must be unique.")

    validated_urls = [
        validate_cloudinary_source_url(value, user_id) for value in image_urls
    ]
    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient(
            timeout=httpx.Timeout(
                MAX_REMOTE_DOWNLOAD_SECONDS,
                connect=5.0,
                read=15.0,
            ),
            follow_redirects=False,
            trust_env=False,
            limits=httpx.Limits(max_connections=2, max_keepalive_connections=1),
        )

    images: list[np.ndarray] = []
    filenames: list[str] = []
    total_bytes = 0
    total_pixels = 0
    batch_deadline = time.monotonic() + MAX_REMOTE_BATCH_SECONDS
    try:
        for index, image_url in enumerate(validated_urls, start=1):
            label = f"Remote image {index}"
            remaining_batch_seconds = batch_deadline - time.monotonic()
            if remaining_batch_seconds <= 0:
                raise HTTPException(
                    status_code=504,
                    detail="The remote image batch timed out.",
                )
            try:
                async with asyncio.timeout(
                    min(MAX_REMOTE_DOWNLOAD_SECONDS, remaining_batch_seconds)
                ):
                    async with client.stream(
                        "GET",
                        image_url,
                        headers={
                            "Accept": "image/jpeg,image/png,image/webp",
                            "Accept-Encoding": "identity",
                            "User-Agent": "LiBot-Panorama-Processor/1.0",
                        },
                    ) as response:
                        if response.status_code != 200:
                            raise HTTPException(
                                status_code=502,
                                detail=f"{label} could not be retrieved from image storage.",
                            )
                        if response.headers.get("x-cld-error"):
                            raise HTTPException(
                                status_code=502,
                                detail=f"{label} could not be retrieved from image storage.",
                            )
                        content_encoding = response.headers.get(
                            "content-encoding", "identity"
                        ).strip().lower()
                        if content_encoding not in {"", "identity"}:
                            raise HTTPException(
                                status_code=502,
                                detail=f"{label} returned unsupported storage encoding.",
                            )
                        declared_type = (
                            response.headers.get("content-type", "")
                            .split(";", 1)[0]
                            .strip()
                            .lower()
                        )
                        if declared_type not in ALLOWED_IMAGE_CONTENT_TYPES:
                            raise HTTPException(
                                status_code=415,
                                detail=f"{label} is not a supported image.",
                            )
                        declared_length = response.headers.get("content-length")
                        if declared_length:
                            try:
                                expected_bytes = int(declared_length)
                            except ValueError as error:
                                raise HTTPException(
                                    status_code=502,
                                    detail=f"{label} returned invalid storage metadata.",
                                ) from error
                            if (
                                expected_bytes < 0
                                or expected_bytes > MAX_FILE_BYTES
                                or expected_bytes > MAX_TOTAL_BYTES - total_bytes
                            ):
                                raise HTTPException(
                                    status_code=413,
                                    detail=f"{label} exceeds the remote-download limit.",
                                )

                        contents = bytearray()
                        async for chunk in response.aiter_raw(chunk_size=64 * 1024):
                            contents.extend(chunk)
                            if (
                                len(contents) > MAX_FILE_BYTES
                                or len(contents) > MAX_TOTAL_BYTES - total_bytes
                            ):
                                raise HTTPException(
                                    status_code=413,
                                    detail=f"{label} exceeds the remote-download limit.",
                                )
            except TimeoutError as error:
                raise HTTPException(
                    status_code=504,
                    detail=f"{label} timed out while downloading.",
                ) from error
            except httpx.TimeoutException as error:
                raise HTTPException(
                    status_code=504,
                    detail=f"{label} timed out while downloading.",
                ) from error
            except httpx.HTTPError as error:
                raise HTTPException(
                    status_code=502,
                    detail=f"{label} could not be retrieved from image storage.",
                ) from error

            image, byte_count, pixel_count = await decode_image_contents(
                bytes(contents),
                label,
                declared_type=declared_type,
                expected_format=IMAGE_EXTENSION_FORMATS[
                    image_url.rsplit(".", 1)[-1].lower()
                ],
                remaining_bytes=MAX_TOTAL_BYTES - total_bytes,
                remaining_pixels=MAX_TOTAL_PIXELS - total_pixels,
            )
            total_bytes += byte_count
            total_pixels += pixel_count
            images.append(image)
            filenames.append(f"Remote image {index}")
    finally:
        if owns_client:
            await client.aclose()

    return images, filenames


async def read_uploaded_images(files: List[UploadFile]) -> tuple[list[np.ndarray], list[str]]:
    images: list[np.ndarray] = []
    filenames: list[str] = []
    total_bytes = 0
    total_pixels = 0
    for index, upload in enumerate(files, start=1):
        image, byte_count, pixel_count = await decode_uploaded_image(
            upload,
            f"File {index}",
            remaining_bytes=MAX_TOTAL_BYTES - total_bytes,
            remaining_pixels=MAX_TOTAL_PIXELS - total_pixels,
        )
        total_bytes += byte_count
        total_pixels += pixel_count
        images.append(image)
        filenames.append(upload.filename or f"Image {index}")
    return images, filenames


def validate_ransac_threshold(value: float) -> float:
    if not math.isfinite(value) or not 1.0 <= value <= 10.0:
        raise HTTPException(
            status_code=422,
            detail="RANSAC threshold must be a finite number between 1 and 10.",
        )
    return value


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
async def validate_images(
    files: List[UploadFile] = File(...),
    algorithm: str = Form("orb"),
    ransac_threshold: float = Form(4.0),
):
    if not 2 <= len(files) <= 30:
        raise HTTPException(status_code=422, detail="Upload between 2 and 30 overlapping images.")
    normalized_algorithm = algorithm.strip().lower()
    if normalized_algorithm not in {"orb", "sift"}:
        raise HTTPException(status_code=422, detail="Algorithm must be either 'orb' or 'sift'.")
    ransac_threshold = validate_ransac_threshold(ransac_threshold)
    images, filenames = await read_uploaded_images(files)
    try:
        analysis = await run_in_threadpool(
            analyze_image_sequence, images, filenames, normalized_algorithm, ransac_threshold
        )
    except StitchingError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {"success": True, "analysis": analysis}


@app.post("/validate/remote")
async def validate_remote_images(request: Request, payload: RemoteValidationRequest):
    user_id = str(request.state.firebase_user["sub"])
    images, filenames = await read_remote_images(payload.image_urls, user_id)
    try:
        analysis = await run_in_threadpool(
            analyze_image_sequence,
            images,
            filenames,
            payload.algorithm,
            payload.ransac_threshold,
        )
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
    validate_ransac_threshold(ransac_threshold)

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


async def build_hybrid_response(
    images: list[np.ndarray],
    filenames: list[str],
    algorithm: str,
    ransac_threshold: float,
    fill_gaps: bool,
    capture_views: list[str] | None = None,
) -> dict:
    try:
        panorama, generated_mask, metadata = await run_in_threadpool(
            reconstruct_hybrid_panorama,
            images,
            filenames,
            algorithm,
            ransac_threshold,
            fill_gaps,
            capture_views=capture_views,
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


@app.post("/reconstruct/hybrid", status_code=status.HTTP_201_CREATED)
async def reconstruct_hybrid(
    files: List[UploadFile] = File(...),
    algorithm: str = Form("orb"),
    ransac_threshold: float = Form(4.0),
    fill_gaps: bool = Form(True),
):
    """Evidence-first reconstruction with an auditable missing-region mask."""
    if not 6 <= len(files) <= 24:
        raise HTTPException(status_code=422, detail="Upload 6 to 24 overlapping landscape images, including ceiling and floor views.")
    normalized_algorithm = algorithm.strip().lower()
    if normalized_algorithm not in {"orb", "sift"}:
        raise HTTPException(status_code=422, detail="Algorithm must be either 'orb' or 'sift'.")
    validate_ransac_threshold(ransac_threshold)
    images, filenames = await read_uploaded_images(files)
    return await build_hybrid_response(
        images,
        filenames,
        normalized_algorithm,
        ransac_threshold,
        fill_gaps,
    )


@app.post("/reconstruct/hybrid/remote", status_code=status.HTTP_201_CREATED)
async def reconstruct_hybrid_remote(request: Request, payload: RemoteHybridRequest):
    user_id = str(request.state.firebase_user["sub"])
    if "application/x-ndjson" in request.headers.get("accept", ""):
        async def stream_result():
            stage = "Downloading photos"

            async def run_reconstruction():
                nonlocal stage
                images, filenames = await read_remote_images(payload.image_urls, user_id)
                stage = "Reconstructing and saving the tour"
                return await build_hybrid_response(
                    images,
                    filenames,
                    payload.algorithm,
                    float(payload.ransac_threshold),
                    payload.fill_gaps,
                    capture_views=payload.capture_views,
                )

            task = asyncio.create_task(run_reconstruction())
            try:
                yield json.dumps({"type": "progress", "stage": stage}) + "\n"
                while not task.done():
                    try:
                        await asyncio.wait_for(asyncio.shield(task), timeout=STREAM_HEARTBEAT_SECONDS)
                    except TimeoutError:
                        yield json.dumps({"type": "progress", "stage": stage}) + "\n"
                    except Exception:
                        break
                try:
                    result = task.result()
                except HTTPException as error:
                    yield json.dumps({"type": "error", "detail": str(error.detail)}) + "\n"
                except Exception:
                    logger.exception("Panorama reconstruction stream failed")
                    yield json.dumps({"type": "error", "detail": "The panorama processor could not finish this tour. Please retry."}) + "\n"
                else:
                    yield json.dumps({"type": "complete", "result": result}) + "\n"
            finally:
                if not task.done():
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)

        return StreamingResponse(
            stream_result(),
            media_type="application/x-ndjson",
            headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
        )
    images, filenames = await read_remote_images(payload.image_urls, user_id)
    return await build_hybrid_response(
        images,
        filenames,
        payload.algorithm,
        float(payload.ransac_threshold),
        payload.fill_gaps,
        capture_views=payload.capture_views,
    )


@app.post("/stitch/four-view", status_code=status.HTTP_201_CREATED)
async def stitch_four_view(
    front: UploadFile = File(...),
    left: UploadFile = File(...),
    right: UploadFile = File(...),
    top: UploadFile = File(...),
):
    images: dict[str, np.ndarray] = {}
    for label, upload in (("front", front), ("left", left), ("right", right), ("top", top)):
        image, _, _ = await decode_uploaded_image(upload, f"The {label} image")
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
