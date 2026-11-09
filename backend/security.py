"""Security controls for the LiBot panorama API.

The in-process rate limiter and capacity gate protect each running instance.
Production deployments should also enforce an edge/distributed rate limit.
"""

from __future__ import annotations

import asyncio
import ipaddress
import os
import re
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Any, Callable, Mapping
from uuid import uuid4

import httpx
import jwt
from cryptography.x509 import load_pem_x509_certificate
from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

FIREBASE_CERTIFICATES_URL = (
    "https://www.googleapis.com/robot/v1/metadata/x509/"
    "securetoken@system.gserviceaccount.com"
)
BEARER_PATTERN = re.compile(r"^Bearer ([A-Za-z0-9._~-]+)$", re.IGNORECASE)
MAX_AGE_PATTERN = re.compile(r"(?:^|,)\s*max-age=(\d+)", re.IGNORECASE)
VERCEL_SERVICE_PREFIX = "/api/backend"


class InvalidFirebaseToken(ValueError):
    """Raised when a bearer token cannot be authenticated."""


class FirebaseVerificationUnavailable(RuntimeError):
    """Raised when Firebase public signing keys cannot be retrieved."""


class RequestBodyTooLarge(Exception):
    """Raised before a protected request can exceed the configured byte cap."""


class RequestBodyTimedOut(Exception):
    """Raised when an authenticated upload does not finish promptly."""


def _positive_int(name: str, default: int, *, minimum: int = 1) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if value >= minimum else default


def canonical_api_path(path: str) -> str:
    if path == VERCEL_SERVICE_PREFIX:
        return "/"
    if path.startswith(f"{VERCEL_SERVICE_PREFIX}/"):
        return path[len(VERCEL_SERVICE_PREFIX) :]
    return path


class FirebaseTokenVerifier:
    """Verify Firebase Authentication ID tokens using Google's rotating keys."""

    def __init__(
        self,
        project_id: str,
        *,
        certificates_url: str = FIREBASE_CERTIFICATES_URL,
        clock: Callable[[], float] = time.time,
        max_session_age_seconds: int = 8 * 60 * 60,
    ) -> None:
        if not project_id.strip():
            raise ValueError("FIREBASE_PROJECT_ID must not be empty.")
        self.project_id = project_id.strip()
        self.certificates_url = certificates_url
        self._clock = clock
        self.max_session_age_seconds = max_session_age_seconds
        self._certificates: dict[str, str] = {}
        self._certificates_expire_at = 0.0
        self._last_certificate_refresh_at = float("-inf")
        self._forced_refresh_cooldown_seconds = 60
        self._certificate_lock = asyncio.Lock()

    async def _fetch_certificates(self, *, force_refresh: bool = False) -> Mapping[str, str]:
        now = self._clock()
        if not force_refresh and self._certificates and now < self._certificates_expire_at:
            return self._certificates

        async with self._certificate_lock:
            now = self._clock()
            if not force_refresh and self._certificates and now < self._certificates_expire_at:
                return self._certificates
            if (
                force_refresh
                and self._certificates
                and now
                < self._last_certificate_refresh_at
                + self._forced_refresh_cooldown_seconds
            ):
                return self._certificates
            try:
                timeout = httpx.Timeout(5.0, connect=3.0)
                async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
                    response = await client.get(self.certificates_url)
                    response.raise_for_status()
                    payload = response.json()
            except (httpx.HTTPError, ValueError) as error:
                raise FirebaseVerificationUnavailable(
                    "Firebase signing keys are temporarily unavailable."
                ) from error

            if not isinstance(payload, dict) or not payload:
                raise FirebaseVerificationUnavailable(
                    "Firebase returned an invalid signing-key response."
                )
            certificates = {
                str(key): value
                for key, value in payload.items()
                if isinstance(key, str) and isinstance(value, str) and value
            }
            if not certificates:
                raise FirebaseVerificationUnavailable(
                    "Firebase returned no usable signing keys."
                )

            cache_control = response.headers.get("cache-control", "")
            match = MAX_AGE_PATTERN.search(cache_control)
            max_age = int(match.group(1)) if match else 3600
            self._certificates = certificates
            self._certificates_expire_at = now + max(300, min(max_age, 86400))
            self._last_certificate_refresh_at = now
            return self._certificates

    async def verify(self, token: str) -> dict[str, Any]:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as error:
            raise InvalidFirebaseToken("Malformed Firebase ID token.") from error

        if header.get("alg") != "RS256":
            raise InvalidFirebaseToken("Firebase ID tokens must use RS256.")
        key_id = header.get("kid")
        if not isinstance(key_id, str) or not key_id:
            raise InvalidFirebaseToken("Firebase ID token is missing its key ID.")

        certificates = await self._fetch_certificates()
        certificate = certificates.get(key_id)
        if certificate is None:
            certificates = await self._fetch_certificates(force_refresh=True)
            certificate = certificates.get(key_id)
        if certificate is None:
            raise InvalidFirebaseToken("Firebase ID token uses an unknown signing key.")

        try:
            # Google's metadata endpoint supplies X.509 certificates, whereas
            # PyJWT expects the RSA public key contained in each certificate.
            signing_key = (
                load_pem_x509_certificate(certificate.encode("ascii")).public_key()
                if certificate.startswith("-----BEGIN CERTIFICATE-----")
                else certificate
            )
            claims = jwt.decode(
                token,
                signing_key,
                algorithms=["RS256"],
                audience=self.project_id,
                issuer=f"https://securetoken.google.com/{self.project_id}",
                leeway=30,
                options={
                    "require": ["exp", "iat", "aud", "iss", "sub", "auth_time"],
                },
            )
        except (jwt.PyJWTError, ValueError) as error:
            raise InvalidFirebaseToken("Firebase ID token is invalid or expired.") from error

        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject or len(subject) > 128:
            raise InvalidFirebaseToken("Firebase ID token has an invalid subject.")
        auth_time = claims.get("auth_time")
        if not isinstance(auth_time, (int, float)) or auth_time > self._clock() + 30:
            raise InvalidFirebaseToken("Firebase ID token has an invalid authentication time.")
        if auth_time + self.max_session_age_seconds < self._clock() - 30:
            raise InvalidFirebaseToken("Firebase session has expired.")
        return claims


@dataclass(frozen=True)
class RateLimitPolicy:
    name: str
    user_limit: int
    ip_limit: int
    window_seconds: int
    max_request_bytes: int | None = None


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    limit: int
    remaining: int
    retry_after: int


class SlidingWindowRateLimiter:
    """Atomic, in-memory sliding-window limiter with bounded stale-state cleanup."""

    def __init__(self, *, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()
        self._checks = 0
        self._max_window_seen = 1

    async def check_many(
        self,
        checks: list[tuple[str, int, int]],
    ) -> RateLimitResult:
        """Check (key, limit, window_seconds) buckets as one atomic operation."""
        now = self._clock()
        async with self._lock:
            buckets: list[tuple[deque[float], int, int]] = []
            retry_after = 0
            blocked_limit = 0
            for key, limit, window_seconds in checks:
                self._max_window_seen = max(self._max_window_seen, window_seconds)
                bucket = self._events[key]
                cutoff = now - window_seconds
                while bucket and bucket[0] <= cutoff:
                    bucket.popleft()
                buckets.append((bucket, limit, window_seconds))
                if len(bucket) >= limit:
                    wait = max(1, int(bucket[0] + window_seconds - now + 0.999))
                    if wait >= retry_after:
                        retry_after = wait
                        blocked_limit = limit

            if retry_after:
                return RateLimitResult(False, blocked_limit, 0, retry_after)

            for bucket, _, _ in buckets:
                bucket.append(now)

            self._checks += 1
            if self._checks % 256 == 0:
                self._remove_stale_buckets(now)

            remaining = min(limit - len(bucket) for bucket, limit, _ in buckets)
            return RateLimitResult(
                True,
                min(limit for _, limit, _ in buckets),
                max(0, remaining),
                0,
            )

    def _remove_stale_buckets(self, now: float) -> None:
        cutoff = now - self._max_window_seen
        for bucket in self._events.values():
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
        empty_keys = [key for key, bucket in self._events.items() if not bucket]
        for key in empty_keys:
            self._events.pop(key, None)


def _client_ip(scope: Scope, *, trust_proxy_headers: bool) -> str:
    headers = Headers(scope=scope)
    candidates: list[str] = []
    if trust_proxy_headers:
        forwarded = headers.get("x-forwarded-for", "")
        if forwarded:
            candidates.append(forwarded.split(",", 1)[0].strip())
    client = scope.get("client")
    if client:
        candidates.append(str(client[0]))

    for candidate in candidates:
        try:
            return ipaddress.ip_address(candidate).compressed
        except ValueError:
            continue
    return "unknown"


def _json_error(
    status_code: int,
    detail: str,
    *,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        {"detail": detail},
        status_code=status_code,
        headers=dict(headers or {}),
    )


class ApiSecurityMiddleware:
    """Authenticate, throttle, and capacity-limit protected API routes."""

    DEFAULT_PROTECTED_POLICIES = {
        "/validate": RateLimitPolicy("validate", 60, 120, 300),
        "/validate/remote": RateLimitPolicy("validate", 60, 120, 300, 64 * 1024),
        "/stitch": RateLimitPolicy("reconstruct", 4, 10, 600),
        "/reconstruct/hybrid": RateLimitPolicy("reconstruct", 4, 10, 600),
        "/reconstruct/hybrid/remote": RateLimitPolicy(
            "reconstruct", 4, 10, 600, 64 * 1024
        ),
        "/stitch/four-view": RateLimitPolicy("reconstruct", 4, 10, 600),
        "/notifications/subscriptions": RateLimitPolicy("notifications", 30, 60, 300, 32 * 1024),
    }

    def __init__(
        self,
        app: ASGIApp,
        *,
        verifier: FirebaseTokenVerifier,
        limiter: SlidingWindowRateLimiter,
        max_request_bytes: int,
        max_concurrent_jobs: int,
        max_upload_seconds: int,
        auth_ip_limit: int,
        auth_ip_window_seconds: int,
        required_roles: frozenset[str] = frozenset(),
        trust_proxy_headers: bool = False,
        policies: Mapping[str, RateLimitPolicy] | None = None,
    ) -> None:
        self.app = app
        self.verifier = verifier
        self.limiter = limiter
        self.max_request_bytes = max_request_bytes
        self.max_upload_seconds = max_upload_seconds
        self.auth_ip_limit = auth_ip_limit
        self.auth_ip_window_seconds = auth_ip_window_seconds
        self.required_roles = required_roles
        self.trust_proxy_headers = trust_proxy_headers
        self.policies = dict(policies or self.DEFAULT_PROTECTED_POLICIES)
        self.capacity = asyncio.Semaphore(max_concurrent_jobs)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") not in {"GET", "POST", "DELETE"}:
            await self.app(scope, receive, send)
            return

        path = canonical_api_path(scope.get("path", ""))
        policy = self.policies.get(path)
        if policy is None and path.startswith("/notifications/subscriptions/"):
            policy = self.policies.get("/notifications/subscriptions")
        if policy is None:
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        request_byte_limit = min(
            self.max_request_bytes,
            policy.max_request_bytes or self.max_request_bytes,
        )
        content_length = headers.get("content-length")
        if content_length:
            try:
                declared_length = int(content_length)
            except ValueError:
                await _json_error(400, "Invalid Content-Length header.")(scope, receive, send)
                return
            if declared_length < 0:
                await _json_error(400, "Invalid Content-Length header.")(scope, receive, send)
                return
            if declared_length > request_byte_limit:
                await _json_error(413, "Request body exceeds the upload limit.")(
                    scope, receive, send
                )
                return

        client_ip = _client_ip(scope, trust_proxy_headers=self.trust_proxy_headers)
        auth_rate = await self.limiter.check_many(
            [
                (
                    f"authentication:ip:{client_ip}",
                    self.auth_ip_limit,
                    self.auth_ip_window_seconds,
                )
            ]
        )
        if not auth_rate.allowed:
            await _json_error(
                429,
                "Too many authentication attempts. Try again later.",
                headers={"Retry-After": str(auth_rate.retry_after)},
            )(scope, receive, send)
            return

        authorization = headers.get("authorization", "")
        match = BEARER_PATTERN.fullmatch(authorization)
        if match is None:
            await _json_error(
                401,
                "A valid Firebase sign-in token is required.",
                headers={"WWW-Authenticate": "Bearer"},
            )(scope, receive, send)
            return

        try:
            claims = await self.verifier.verify(match.group(1))
        except InvalidFirebaseToken:
            await _json_error(
                401,
                "A valid Firebase sign-in token is required.",
                headers={"WWW-Authenticate": "Bearer"},
            )(scope, receive, send)
            return
        except FirebaseVerificationUnavailable:
            await _json_error(
                503,
                "Authentication is temporarily unavailable.",
                headers={"Retry-After": "30"},
            )(scope, receive, send)
            return

        user_id = str(claims["sub"])
        if self.required_roles:
            role = claims.get("role")
            roles = claims.get("roles")
            claimed_roles = {role} if isinstance(role, str) else set()
            if isinstance(roles, list):
                claimed_roles.update(item for item in roles if isinstance(item, str))
            if not claimed_roles.intersection(self.required_roles):
                await _json_error(403, "This account cannot run panorama jobs.")(
                    scope, receive, send
                )
                return

        # A request rejected because the processor is occupied did no compute
        # work and must not consume the user's validation/reconstruction quota.
        capacity_acquired = False
        if policy.name in {"validate", "reconstruct"}:
            try:
                await asyncio.wait_for(self.capacity.acquire(), timeout=0.05)
                capacity_acquired = True
            except TimeoutError:
                await _json_error(
                    503,
                    "The panorama processor is busy. Try again shortly.",
                    headers={
                        "Retry-After": "5",
                        "X-Panorama-Capacity": "busy",
                    },
                )(scope, receive, send)
                return

        result = await self.limiter.check_many(
            [
                (
                    f"{policy.name}:user:{user_id}",
                    policy.user_limit,
                    policy.window_seconds,
                ),
                (
                    f"{policy.name}:ip:{client_ip}",
                    policy.ip_limit,
                    policy.window_seconds,
                ),
            ]
        )
        if not result.allowed:
            if capacity_acquired:
                self.capacity.release()
            await _json_error(
                429,
                "Too many panorama API requests. Try again later.",
                headers={
                    "Retry-After": str(result.retry_after),
                    "X-RateLimit-Limit": str(result.limit),
                    "X-RateLimit-Remaining": "0",
                },
            )(scope, receive, send)
            return

        received_bytes = 0
        body_complete = False
        upload_deadline = time.monotonic() + self.max_upload_seconds

        async def limited_receive() -> Message:
            nonlocal received_bytes, body_complete
            if body_complete:
                return await receive()
            remaining_seconds = upload_deadline - time.monotonic()
            if remaining_seconds <= 0:
                raise RequestBodyTimedOut
            try:
                message = await asyncio.wait_for(
                    receive(),
                    timeout=min(15.0, remaining_seconds),
                )
            except TimeoutError as error:
                raise RequestBodyTimedOut from error
            if message["type"] == "http.request":
                received_bytes += len(message.get("body", b""))
                if received_bytes > request_byte_limit:
                    raise RequestBodyTooLarge
                if not message.get("more_body", False):
                    body_complete = True
            return message

        response_started = False

        async def rate_limit_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
                response_headers = MutableHeaders(scope=message)
                response_headers.setdefault("X-RateLimit-Limit", str(result.limit))
                response_headers.setdefault(
                    "X-RateLimit-Remaining", str(result.remaining)
                )
            await send(message)

        try:
            scope.setdefault("state", {})
            scope["state"]["firebase_user"] = claims
            await self.app(scope, limited_receive, rate_limit_send)
        except RequestBodyTooLarge:
            if not response_started:
                await _json_error(413, "Request body exceeds the upload limit.")(
                    scope, receive, send
                )
        except RequestBodyTimedOut:
            if not response_started:
                await _json_error(408, "Request body upload timed out.")(
                    scope, receive, send
                )
        finally:
            if capacity_acquired:
                self.capacity.release()


class SecurityHeadersMiddleware:
    """Attach defensive response headers to frontend-facing API responses."""

    def __init__(self, app: ASGIApp, *, production: bool = False) -> None:
        self.app = app
        self.production = production

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = uuid4().hex
        path = canonical_api_path(scope.get("path", ""))

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.setdefault("X-Content-Type-Options", "nosniff")
                headers.setdefault("X-Frame-Options", "DENY")
                headers.setdefault("Referrer-Policy", "no-referrer")
                headers.setdefault(
                    "Permissions-Policy",
                    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
                )
                headers.setdefault("X-Request-ID", request_id)
                if not path.startswith("/outputs"):
                    headers.setdefault("Cache-Control", "no-store")
                if self.production:
                    headers.setdefault(
                        "Strict-Transport-Security",
                        "max-age=31536000; includeSubDomains",
                    )
            await send(message)

        await self.app(scope, receive, send_with_headers)


def security_settings() -> dict[str, Any]:
    production = bool(os.getenv("VERCEL")) or os.getenv("ENVIRONMENT", "").lower() in {
        "production",
        "prod",
    }
    required_roles = frozenset(
        role.strip()
        for role in os.getenv("PANORAMA_REQUIRED_ROLES", "").split(",")
        if role.strip()
    )
    trust_proxy_default = "true" if os.getenv("VERCEL") else "false"
    trust_proxy_headers = (
        os.getenv("TRUST_PROXY_HEADERS", trust_proxy_default).strip().lower() == "true"
    )
    validation_window = _positive_int("PANORAMA_VALIDATE_WINDOW_SECONDS", 300)
    reconstruction_window = _positive_int(
        "PANORAMA_RECONSTRUCT_WINDOW_SECONDS", 600
    )
    return {
        "production": production,
        "project_id": os.getenv("FIREBASE_PROJECT_ID", "libot-790e6"),
        "max_request_bytes": _positive_int(
            "PANORAMA_MAX_REQUEST_BYTES", 126 * 1024 * 1024
        ),
        "max_concurrent_jobs": _positive_int("PANORAMA_MAX_CONCURRENT_JOBS", 1),
        "max_upload_seconds": _positive_int("PANORAMA_MAX_UPLOAD_SECONDS", 120),
        "auth_ip_limit": _positive_int("PANORAMA_AUTH_IP_LIMIT", 60),
        "auth_ip_window_seconds": _positive_int(
            "PANORAMA_AUTH_IP_WINDOW_SECONDS", 60
        ),
        "max_session_age_seconds": _positive_int(
            "PANORAMA_MAX_SESSION_AGE_SECONDS", 8 * 60 * 60
        ),
        "required_roles": required_roles,
        "trust_proxy_headers": trust_proxy_headers,
        "policies": {
            "/validate": RateLimitPolicy(
                "validate",
                _positive_int("PANORAMA_VALIDATE_USER_LIMIT", 60),
                _positive_int("PANORAMA_VALIDATE_IP_LIMIT", 120),
                validation_window,
            ),
            "/validate/remote": RateLimitPolicy(
                "validate",
                _positive_int("PANORAMA_VALIDATE_USER_LIMIT", 60),
                _positive_int("PANORAMA_VALIDATE_IP_LIMIT", 120),
                validation_window,
                64 * 1024,
            ),
            "/stitch": RateLimitPolicy(
                "reconstruct",
                _positive_int("PANORAMA_RECONSTRUCT_USER_LIMIT", 4),
                _positive_int("PANORAMA_RECONSTRUCT_IP_LIMIT", 10),
                reconstruction_window,
            ),
            "/reconstruct/hybrid": RateLimitPolicy(
                "reconstruct",
                _positive_int("PANORAMA_RECONSTRUCT_USER_LIMIT", 4),
                _positive_int("PANORAMA_RECONSTRUCT_IP_LIMIT", 10),
                reconstruction_window,
            ),
            "/reconstruct/hybrid/remote": RateLimitPolicy(
                "reconstruct",
                _positive_int("PANORAMA_RECONSTRUCT_USER_LIMIT", 4),
                _positive_int("PANORAMA_RECONSTRUCT_IP_LIMIT", 10),
                reconstruction_window,
                64 * 1024,
            ),
            "/stitch/four-view": RateLimitPolicy(
                "reconstruct",
                _positive_int("PANORAMA_RECONSTRUCT_USER_LIMIT", 4),
                _positive_int("PANORAMA_RECONSTRUCT_IP_LIMIT", 10),
                reconstruction_window,
            ),
            "/notifications/subscriptions": RateLimitPolicy(
                "notifications",
                _positive_int("NOTIFICATION_USER_LIMIT", 30),
                _positive_int("NOTIFICATION_IP_LIMIT", 60),
                _positive_int("NOTIFICATION_WINDOW_SECONDS", 300),
                32 * 1024,
            ),
        },
    }
