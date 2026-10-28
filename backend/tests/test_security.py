from io import BytesIO
from datetime import datetime, timedelta, timezone
import time
import unittest
from unittest.mock import AsyncMock, patch

import httpx
import jwt
import numpy as np
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives.asymmetric import rsa
from PIL import Image

try:
    from backend import main as main_module
    from backend.main import (
        CLOUDINARY_CLOUD_NAME,
        CLOUDINARY_SOURCE_FOLDER,
        MAX_FILE_BYTES,
        app,
        cloudinary_owner_folder_id,
        inspect_image_header,
        read_remote_images,
        validate_cloudinary_source_url,
        validate_ransac_threshold,
    )
    from backend.security import (
        ApiSecurityMiddleware,
        FirebaseTokenVerifier,
        InvalidFirebaseToken,
        SlidingWindowRateLimiter,
    )
except ImportError:
    import main as main_module
    from main import (
        CLOUDINARY_CLOUD_NAME,
        CLOUDINARY_SOURCE_FOLDER,
        MAX_FILE_BYTES,
        app,
        cloudinary_owner_folder_id,
        inspect_image_header,
        read_remote_images,
        validate_cloudinary_source_url,
        validate_ransac_threshold,
    )
    from security import ApiSecurityMiddleware, FirebaseTokenVerifier, InvalidFirebaseToken, SlidingWindowRateLimiter


class MutableClock:
    def __init__(self, value: float = 1000.0) -> None:
        self.value = value

    def __call__(self) -> float:
        return self.value


TEST_USER_ID = "firebase-user-1"


def cloudinary_source_url(
    asset_name: str = "source-1",
    extension: str = "jpg",
    *,
    user_id: str = TEST_USER_ID,
) -> str:
    owner_folder = cloudinary_owner_folder_id(user_id)
    return (
        f"https://res.cloudinary.com/{CLOUDINARY_CLOUD_NAME}/image/upload/"
        f"v1719307544/{CLOUDINARY_SOURCE_FOLDER}/{owner_folder}/"
        f"{asset_name}.{extension}"
    )


def encoded_image(image_format: str = "JPEG") -> bytes:
    output = BytesIO()
    Image.new("RGB", (120, 100), color=(42, 73, 105)).save(
        output,
        format=image_format,
    )
    return output.getvalue()


class ChunkedBytesStream(httpx.AsyncByteStream):
    def __init__(self, *chunks: bytes) -> None:
        self.chunks = chunks

    async def __aiter__(self):
        for chunk in self.chunks:
            yield chunk


def streaming_response(
    body: bytes,
    *,
    content_type: str,
    status_code: int = 200,
    headers: dict[str, str] | None = None,
) -> httpx.Response:
    response_headers = {
        "Content-Type": content_type,
        "Content-Length": str(len(body)),
    }
    if headers:
        response_headers.update(headers)
    return httpx.Response(
        status_code,
        headers=response_headers,
        stream=ChunkedBytesStream(body),
    )


class RateLimiterTests(unittest.IsolatedAsyncioTestCase):
    async def test_same_bucket_is_limited_then_resets(self):
        clock = MutableClock()
        limiter = SlidingWindowRateLimiter(clock=clock)

        first = await limiter.check_many([("user:test", 2, 60)])
        second = await limiter.check_many([("user:test", 2, 60)])
        blocked = await limiter.check_many([("user:test", 2, 60)])

        self.assertTrue(first.allowed)
        self.assertEqual(second.remaining, 0)
        self.assertFalse(blocked.allowed)
        self.assertEqual(blocked.retry_after, 60)

        clock.value += 61
        reset = await limiter.check_many([("user:test", 2, 60)])
        self.assertTrue(reset.allowed)

    async def test_user_buckets_are_isolated(self):
        limiter = SlidingWindowRateLimiter(clock=MutableClock())
        await limiter.check_many([("user:one", 1, 60)])
        blocked = await limiter.check_many([("user:one", 1, 60)])
        other_user = await limiter.check_many([("user:two", 1, 60)])

        self.assertFalse(blocked.allowed)
        self.assertTrue(other_user.allowed)


class FirebaseTokenVerifierTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.now = int(time.time())
        self.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.public_key = self.private_key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("ascii")
        self.verifier = FirebaseTokenVerifier(
            "libot-test",
            clock=lambda: float(self.now),
        )
        self.verifier._fetch_certificates = AsyncMock(  # type: ignore[method-assign]
            return_value={"test-key": self.public_key}
        )

    def token(self, **overrides):
        claims = {
            "sub": "firebase-user-1",
            "aud": "libot-test",
            "iss": "https://securetoken.google.com/libot-test",
            "iat": self.now - 10,
            "auth_time": self.now - 20,
            "exp": self.now + 3600,
        }
        claims.update(overrides)
        return jwt.encode(
            claims,
            self.private_key,
            algorithm="RS256",
            headers={"kid": "test-key"},
        )

    async def test_valid_token_returns_verified_subject(self):
        claims = await self.verifier.verify(self.token())
        self.assertEqual(claims["sub"], "firebase-user-1")

    async def test_google_style_x509_certificate_verifies_real_signature(self):
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Firebase signing test')])
        now = datetime.now(timezone.utc)
        certificate = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                       .public_key(self.private_key.public_key()).serial_number(x509.random_serial_number())
                       .not_valid_before(now - timedelta(days=1)).not_valid_after(now + timedelta(days=1))
                       .sign(self.private_key, hashes.SHA256()))
        self.verifier._fetch_certificates = AsyncMock(return_value={
            'test-key': certificate.public_bytes(serialization.Encoding.PEM).decode('ascii')
        })
        claims = await self.verifier.verify(self.token())
        self.assertEqual(claims['sub'], 'firebase-user-1')
        with self.assertRaises(InvalidFirebaseToken):
            await self.verifier.verify(self.token(aud='wrong-project'))

    async def test_wrong_audience_and_expired_tokens_are_rejected(self):
        for token in (
            self.token(aud="another-project"),
            self.token(exp=self.now - 60),
        ):
            with self.subTest(token=token[:20]):
                with self.assertRaises(InvalidFirebaseToken):
                    await self.verifier.verify(token)

    async def test_session_authenticated_more_than_max_age_is_rejected(self):
        verifier = FirebaseTokenVerifier(
            "libot-test",
            clock=lambda: float(self.now),
            max_session_age_seconds=8 * 60 * 60,
        )
        verifier._fetch_certificates = AsyncMock(  # type: ignore[method-assign]
            return_value={"test-key": self.public_key}
        )

        with self.assertRaises(InvalidFirebaseToken):
            await verifier.verify(self.token(auth_time=self.now - (8 * 60 * 60) - 31))

    async def test_non_rs256_token_is_rejected_before_key_lookup(self):
        token = jwt.encode(
            {"sub": "user"},
            "unsafe-test-secret-with-at-least-32-bytes",
            algorithm="HS256",
            headers={"kid": "test-key"},
        )
        with self.assertRaises(InvalidFirebaseToken):
            await self.verifier.verify(token)
        self.verifier._fetch_certificates.assert_not_awaited()

    async def test_unknown_key_does_not_force_repeated_certificate_downloads(self):
        verifier = FirebaseTokenVerifier(
            "libot-test",
            clock=lambda: float(self.now),
        )
        verifier._certificates = {"known-key": self.public_key}
        verifier._certificates_expire_at = self.now + 3600
        verifier._last_certificate_refresh_at = self.now
        token = jwt.encode(
            {
                "sub": "firebase-user-1",
                "aud": "libot-test",
                "iss": "https://securetoken.google.com/libot-test",
                "iat": self.now - 10,
                "auth_time": self.now - 20,
                "exp": self.now + 3600,
            },
            self.private_key,
            algorithm="RS256",
            headers={"kid": "unknown-key"},
        )

        with patch("backend.security.httpx.AsyncClient") as http_client:
            with self.assertRaises(InvalidFirebaseToken):
                await verifier.verify(token)
        http_client.assert_not_called()


class ApiSecurityIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def request(self, method: str, path: str, **kwargs) -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.request(method, path, **kwargs)

    async def test_health_is_public_and_has_security_headers(self):
        response = await self.request("GET", "/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        self.assertEqual(response.headers["x-frame-options"], "DENY")
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertIn("x-request-id", response.headers)

    async def test_compute_route_rejects_missing_token_before_multipart(self):
        response = await self.request(
            "POST",
            "/validate",
            content=b"not-a-multipart-body",
            headers={"Content-Type": "multipart/form-data; boundary=broken"},
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers["www-authenticate"], "Bearer")
        self.assertEqual(
            response.json()["detail"],
            "A valid Firebase sign-in token is required.",
        )

    async def test_vercel_prefixed_compute_route_has_same_auth_policy(self):
        response = await self.request("POST", "/api/backend/reconstruct/hybrid")
        self.assertEqual(response.status_code, 401)

    async def test_remote_compute_routes_require_authentication(self):
        for path in (
            "/validate/remote",
            "/reconstruct/hybrid/remote",
            "/api/backend/validate/remote",
            "/api/backend/reconstruct/hybrid/remote",
        ):
            with self.subTest(path=path):
                response = await self.request("POST", path, json={"image_urls": []})
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.headers["www-authenticate"], "Bearer")

    async def test_busy_compute_response_is_explicitly_marked_for_safe_retry(self):
        # Build the lazy FastAPI middleware stack, locate the capacity limiter,
        # and occupy its only slot to exercise the real busy response.
        await self.request("GET", "/health")
        middleware = app.middleware_stack
        while not isinstance(middleware, ApiSecurityMiddleware):
            middleware = middleware.app

        await middleware.capacity.acquire()
        try:
            with patch(
                "backend.security.FirebaseTokenVerifier.verify",
                new=AsyncMock(return_value={"sub": TEST_USER_ID}),
            ):
                response = await self.request(
                    "POST",
                    "/validate/remote",
                    json={"image_urls": []},
                    headers={"Authorization": "Bearer test.token.value"},
                )
        finally:
            middleware.capacity.release()

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["retry-after"], "5")
        self.assertEqual(response.headers["x-panorama-capacity"], "busy")

    async def test_declared_oversized_body_is_rejected_before_auth(self):
        response = await self.request(
            "POST",
            "/validate",
            content=b"",
            headers={"Content-Length": str(127 * 1024 * 1024)},
        )
        self.assertEqual(response.status_code, 413)

    async def test_remote_json_body_limit_is_enforced_before_auth(self):
        response = await self.request(
            "POST",
            "/validate/remote",
            content=b"",
            headers={"Content-Length": str((64 * 1024) + 1)},
        )
        self.assertEqual(response.status_code, 413)

    async def test_valid_identity_reaches_fastapi_validation(self):
        with patch(
            "backend.security.FirebaseTokenVerifier.verify",
            new=AsyncMock(return_value={"sub": "firebase-user-1"}),
        ):
            response = await self.request(
                "POST",
                "/validate",
                headers={"Authorization": "Bearer test.token.value"},
            )
        self.assertEqual(response.status_code, 422)
        self.assertIn("x-ratelimit-limit", response.headers)

    async def test_cors_preflight_allows_authorization_from_trusted_origin(self):
        response = await self.request(
            "OPTIONS",
            "/validate",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["access-control-allow-origin"],
            "http://localhost:3000",
        )
        self.assertIn(
            "Authorization",
            response.headers["access-control-allow-headers"],
        )

    async def test_remote_validation_uses_verified_user_and_small_json_payload(self):
        urls = [
            cloudinary_source_url("source-1"),
            cloudinary_source_url("source-2"),
        ]
        images = [
            np.zeros((100, 120, 3), dtype=np.uint8),
            np.ones((100, 120, 3), dtype=np.uint8),
        ]
        reader = AsyncMock(return_value=(images, ["Remote image 1", "Remote image 2"]))
        analysis = {"images": [], "pairs": []}
        with (
            patch(
                "backend.security.FirebaseTokenVerifier.verify",
                new=AsyncMock(return_value={"sub": TEST_USER_ID}),
            ),
            patch.object(main_module, "read_remote_images", reader),
            patch.object(main_module, "analyze_image_sequence", return_value=analysis) as analyzer,
        ):
            response = await self.request(
                "POST",
                "/validate/remote",
                json={"image_urls": urls, "algorithm": "sift", "ransac_threshold": 5.5},
                headers={"Authorization": "Bearer test.token.value"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"success": True, "analysis": analysis})
        self.assertIn("x-ratelimit-limit", response.headers)
        reader.assert_awaited_once_with(urls, TEST_USER_ID)
        analyzer.assert_called_once_with(images, ["Remote image 1", "Remote image 2"], "sift", 5.5)

    async def test_remote_hybrid_uses_strict_typed_options(self):
        urls = [cloudinary_source_url(f"source-{index}") for index in range(1, 7)]
        images = [np.zeros((100, 120, 3), dtype=np.uint8) for _ in urls]
        filenames = [f"Remote image {index}" for index in range(1, 7)]
        capture_views = ['around'] * 4 + ['top', 'bottom']
        reader = AsyncMock(return_value=(images, filenames))
        builder = AsyncMock(
            return_value={
                "success": True,
                "panorama_url": "https://example.test/panorama.jpg",
                "ai_mask_url": "https://example.test/mask.png",
                "storage": "cloudinary",
                "metadata": {},
            }
        )
        with (
            patch(
                "backend.security.FirebaseTokenVerifier.verify",
                new=AsyncMock(return_value={"sub": TEST_USER_ID}),
            ),
            patch.object(main_module, "read_remote_images", reader),
            patch.object(main_module, "build_hybrid_response", builder),
        ):
            response = await self.request(
                "POST",
                "/reconstruct/hybrid/remote",
                json={
                    "image_urls": urls,
                    "algorithm": "sift",
                    "ransac_threshold": 5.5,
                    "fill_gaps": False,
                    "capture_views": capture_views,
                },
                headers={"Authorization": "Bearer test.token.value"},
            )

        self.assertEqual(response.status_code, 201)
        reader.assert_awaited_once_with(urls, TEST_USER_ID)
        builder.assert_awaited_once_with(images, filenames, "sift", 5.5, False, capture_views=capture_views)

    async def test_top_bottom_request_bounds_and_legacy_compatibility(self):
        from pydantic import ValidationError
        urls = [cloudinary_source_url(f"source-{index}") for index in range(24)]
        payload = main_module.RemoteHybridRequest(image_urls=urls, capture_views=['around'] * 12 + ['top'] * 6 + ['bottom'] * 6)
        self.assertEqual(len(payload.image_urls), 24)
        self.assertIsNone(main_module.RemoteHybridRequest(image_urls=urls[:6]).capture_views)
        for options in (
            {'image_urls': urls + urls[:1]},
            {'image_urls': urls, 'capture_views': ['top']},
            {'image_urls': urls, 'capture_views': ['unknown'] * 24},
        ):
            with self.assertRaises(ValidationError):
                main_module.RemoteHybridRequest(**options)

    async def test_remote_models_reject_invalid_counts_types_and_extra_fields(self):
        valid_urls = [
            cloudinary_source_url("source-1"),
            cloudinary_source_url("source-2"),
        ]
        invalid_payloads = (
            {"image_urls": valid_urls[:1], "algorithm": "orb"},
            {"image_urls": valid_urls, "algorithm": "ORB"},
            {"image_urls": valid_urls, "algorithm": "orb", "unexpected": True},
            {"image_urls": valid_urls, "ransac_threshold": 0.0},
            {"image_urls": valid_urls, "ransac_threshold": 11.0},
            {"image_urls": valid_urls, "ransac_threshold": "4.0"},
        )
        with patch(
            "backend.security.FirebaseTokenVerifier.verify",
            new=AsyncMock(return_value={"sub": TEST_USER_ID}),
        ):
            for payload in invalid_payloads:
                with self.subTest(payload=payload):
                    response = await self.request(
                        "POST",
                        "/validate/remote",
                        json=payload,
                        headers={"Authorization": "Bearer test.token.value"},
                    )
                    self.assertEqual(response.status_code, 422)

            hybrid_response = await self.request(
                "POST",
                "/reconstruct/hybrid/remote",
                json={
                    "image_urls": [
                        cloudinary_source_url(f"source-{index}")
                        for index in range(1, 7)
                    ],
                    "algorithm": "orb",
                    "ransac_threshold": "4.0",
                    "fill_gaps": "false",
                },
                headers={"Authorization": "Bearer test.token.value"},
            )
        self.assertEqual(hybrid_response.status_code, 422)


class RemoteImageSecurityTests(unittest.IsolatedAsyncioTestCase):
    async def read_with_handler(self, image_urls, handler):
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(
            transport=transport,
            follow_redirects=False,
        ) as client:
            return await read_remote_images(
                image_urls,
                TEST_USER_ID,
                client=client,
            )

    def test_cloudinary_url_accepts_only_canonical_owned_source_path(self):
        canonical = cloudinary_source_url()
        self.assertEqual(
            validate_cloudinary_source_url(canonical, TEST_USER_ID),
            canonical,
        )

    def test_cloudinary_url_rejects_ssrf_and_path_bypass_variants(self):
        canonical = cloudinary_source_url()
        owner = cloudinary_owner_folder_id(TEST_USER_ID)
        other_owner = cloudinary_owner_folder_id("another-user")
        malicious_urls = {
            "scheme": canonical.replace("https://", "http://", 1),
            "host": canonical.replace(
                "res.cloudinary.com",
                "res.cloudinary.com.evil.test",
                1,
            ),
            "userinfo": canonical.replace(
                "https://",
                "https://attacker@",
                1,
            ),
            "explicit port": canonical.replace(
                "res.cloudinary.com",
                "res.cloudinary.com:443",
                1,
            ),
            "query": f"{canonical}?download=1",
            "fragment": f"{canonical}#ignored",
            "percent encoding": canonical.replace("source-1", "%73ource-1"),
            "backslash": canonical.replace("/image/upload/", r"/image\upload/"),
            "transformation": canonical.replace(
                "/image/upload/",
                "/image/upload/w_100/",
            ),
            "wrong cloud": canonical.replace(
                f"/{CLOUDINARY_CLOUD_NAME}/",
                "/another-cloud/",
                1,
            ),
            "wrong source folder": canonical.replace(
                f"/{CLOUDINARY_SOURCE_FOLDER}/",
                "/libot/other-sources/",
                1,
            ),
            "wrong owner": canonical.replace(f"/{owner}/", f"/{other_owner}/", 1),
            "unversioned": canonical.replace("/v1719307544/", "/", 1),
            "zero version": canonical.replace("/v1719307544/", "/v0/", 1),
            "nested asset": canonical.replace(
                "/source-1.jpg",
                "/nested/source-1.jpg",
            ),
            "unsupported extension": canonical.replace(".jpg", ".svg"),
            "non-ascii": canonical.replace("source-1", "sourcé-1"),
            "leading whitespace": f" {canonical}",
        }

        for label, value in malicious_urls.items():
            with self.subTest(label=label, value=value):
                with self.assertRaises(Exception) as raised:
                    validate_cloudinary_source_url(value, TEST_USER_ID)
                self.assertEqual(getattr(raised.exception, "status_code", None), 422)

    async def test_valid_mocked_downloads_decode_without_network_access(self):
        jpeg = encoded_image("JPEG")
        urls = [
            cloudinary_source_url("source-1"),
            cloudinary_source_url("source-2"),
        ]
        requests = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return streaming_response(jpeg, content_type="image/jpeg")

        images, filenames = await self.read_with_handler(urls, handler)

        self.assertEqual(len(images), 2)
        self.assertEqual(images[0].shape, (100, 120, 3))
        self.assertEqual(filenames, ["Remote image 1", "Remote image 2"])
        self.assertEqual(len(requests), 2)
        for request in requests:
            self.assertEqual(request.url.host, "res.cloudinary.com")
            self.assertEqual(request.headers["accept-encoding"], "identity")

    async def test_redirects_cloudinary_errors_and_content_encoding_are_rejected(self):
        jpeg = encoded_image("JPEG")
        cases = (
            (
                "redirect",
                lambda _: httpx.Response(
                    302,
                    headers={"Location": "https://evil.test/image.jpg"},
                ),
                502,
            ),
            (
                "cloudinary error",
                lambda _: streaming_response(
                    jpeg,
                    content_type="image/jpeg",
                    headers={"X-Cld-Error": "asset denied"},
                ),
                502,
            ),
            (
                "compressed response",
                lambda _: streaming_response(
                    jpeg,
                    content_type="image/jpeg",
                    headers={"Content-Encoding": "gzip"},
                ),
                502,
            ),
        )
        for label, handler, expected_status in cases:
            with self.subTest(label=label):
                with self.assertRaises(Exception) as raised:
                    await self.read_with_handler(
                        [cloudinary_source_url()],
                        handler,
                    )
                self.assertEqual(
                    getattr(raised.exception, "status_code", None),
                    expected_status,
                )

    async def test_declared_and_streamed_download_size_limits_are_enforced(self):
        def oversized_header(_: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                headers={
                    "Content-Type": "image/jpeg",
                    "Content-Length": str(MAX_FILE_BYTES + 1),
                },
            )

        with self.assertRaises(Exception) as raised:
            await self.read_with_handler(
                [cloudinary_source_url()],
                oversized_header,
            )
        self.assertEqual(getattr(raised.exception, "status_code", None), 413)

        def oversized_stream(_: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                headers={"Content-Type": "image/jpeg"},
                stream=ChunkedBytesStream(b"a" * 40, b"b" * 40),
            )

        with patch.object(main_module, "MAX_FILE_BYTES", 64):
            with self.assertRaises(Exception) as streamed:
                await self.read_with_handler(
                    [cloudinary_source_url()],
                    oversized_stream,
                )
        self.assertEqual(getattr(streamed.exception, "status_code", None), 413)

    async def test_duplicate_urls_are_rejected_before_any_download(self):
        url = cloudinary_source_url()
        transport_called = False

        def handler(_: httpx.Request) -> httpx.Response:
            nonlocal transport_called
            transport_called = True
            return httpx.Response(500)

        with self.assertRaises(Exception) as raised:
            await self.read_with_handler([url, url], handler)
        self.assertEqual(getattr(raised.exception, "status_code", None), 422)
        self.assertFalse(transport_called)

    async def test_mime_extension_and_body_mismatches_are_rejected(self):
        jpeg = encoded_image("JPEG")
        png = encoded_image("PNG")
        cases = (
            (
                "declared MIME does not match body",
                cloudinary_source_url(extension="png"),
                {"Content-Type": "image/jpeg"},
                png,
                415,
            ),
            (
                "extension does not match body",
                cloudinary_source_url(extension="jpg"),
                {"Content-Type": "image/png"},
                png,
                415,
            ),
            (
                "unsupported MIME",
                cloudinary_source_url(),
                {"Content-Type": "application/octet-stream"},
                jpeg,
                415,
            ),
            (
                "invalid image body",
                cloudinary_source_url(),
                {"Content-Type": "image/jpeg"},
                b"this is not an image",
                422,
            ),
        )

        for label, url, headers, body, expected_status in cases:
            with self.subTest(label=label):
                def handler(
                    _: httpx.Request,
                    response_headers=headers,
                    response_body=body,
                ) -> httpx.Response:
                    return streaming_response(
                        response_body,
                        content_type=response_headers["Content-Type"],
                    )

                with self.assertRaises(Exception) as raised:
                    await self.read_with_handler([url], handler)
                self.assertEqual(
                    getattr(raised.exception, "status_code", None),
                    expected_status,
                )


class ParameterValidationTests(unittest.TestCase):
    def test_ransac_threshold_rejects_unsafe_values(self):
        for value in (0.0, 10.1, float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=value):
                with self.assertRaises(Exception) as raised:
                    validate_ransac_threshold(value)
                self.assertEqual(getattr(raised.exception, "status_code", None), 422)

    def test_ransac_threshold_accepts_documented_range(self):
        self.assertEqual(validate_ransac_threshold(1.0), 1.0)
        self.assertEqual(validate_ransac_threshold(10.0), 10.0)

    def test_decoded_pixel_limit_is_checked_from_image_header(self):
        output = BytesIO()
        Image.new("RGB", (200, 200)).save(output, format="PNG")
        with patch("backend.main.MAX_IMAGE_PIXELS", 10_000):
            with self.assertRaises(Exception) as raised:
                inspect_image_header(output.getvalue(), "Test image")
        self.assertEqual(getattr(raised.exception, "status_code", None), 413)


if __name__ == "__main__":
    unittest.main()
