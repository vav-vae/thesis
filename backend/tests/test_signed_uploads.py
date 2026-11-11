import hashlib
import os
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException

from backend.cloudinary_uploads import signed_upload
from backend.main import app, cloudinary_owner_folder_id, upload_generated_image

CONFIG = {
    "CLOUDINARY_API_KEY": "test-key",
    "CLOUDINARY_API_SECRET": "test-private-secret",
    "CLOUDINARY_SIGNED_UPLOAD_PRESET": "test-signed-preset",
}


class SigningTests(unittest.TestCase):
    def test_signature_covers_all_constraints_without_exposing_secret(self):
        with patch.dict(os.environ, CONFIG), patch("backend.cloudinary_uploads.time.time", return_value=1700000000):
            params = signed_upload("libot/images/test-owner")
        unsigned = {key: value for key, value in params.items() if key not in {"api_key", "signature"}}
        canonical = "&".join(f"{key}={unsigned[key]}" for key in sorted(unsigned))
        expected = hashlib.sha256((canonical + CONFIG["CLOUDINARY_API_SECRET"]).encode()).hexdigest()
        self.assertEqual(params["signature"], expected)
        self.assertEqual(params["overwrite"], "false")
        self.assertNotIn("pdf", params["allowed_formats"])
        self.assertNotIn(CONFIG["CLOUDINARY_API_SECRET"], str(params))

    def test_missing_credentials_fail_closed(self):
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(HTTPException) as error:
            signed_upload("libot/images/test")
        self.assertEqual(error.exception.status_code, 503)


class SigningApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        account = patch("backend.authorization.read_account", new=AsyncMock(return_value={"role": "broker", "accountStatus": "active"}))
        account.start()
        self.addCleanup(account.stop)

    async def request(self, body, *, authenticated=True):
        headers = {"Authorization": "Bearer test"} if authenticated else {}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await client.post("/api/backend/uploads/sign", json=body, headers=headers)

    async def test_unsigned_requests_cannot_get_a_signature(self):
        response = await self.request({"purpose": "image"}, authenticated=False)
        self.assertEqual(response.status_code, 401)

    async def test_owner_folder_and_formats_are_selected_on_server(self):
        with patch.dict(os.environ, CONFIG), patch("backend.security.FirebaseTokenVerifier.verify", new=AsyncMock(return_value={"sub": "signing-user"})):
            response = await self.request({"purpose": "panorama-source"})
            self.assertEqual(response.status_code, 200)
            params = response.json()["params"]
            self.assertEqual(params["folder"], f"libot/panorama-sources/{cloudinary_owner_folder_id('signing-user')}")
            response = await self.request({"purpose": "document"})
            self.assertIn("pdf", response.json()["params"]["allowed_formats"])
            self.assertEqual(response.headers["cache-control"], "no-store")

    async def test_arbitrary_signing_parameters_are_rejected(self):
        with patch.dict(os.environ, CONFIG), patch("backend.security.FirebaseTokenVerifier.verify", new=AsyncMock(return_value={"sub": "signing-user"})):
            for body in [{"purpose": "image", "folder": "other-owner"}, {"purpose": "image", "overwrite": True}, {"purpose": "video"}]:
                response = await self.request(body)
                self.assertEqual(response.status_code, 422)

    async def test_generated_assets_also_use_signed_uploads(self):
        response = httpx.Response(200, json={"secure_url": "https://res.cloudinary.com/test/image/upload/tour.jpg"}, request=httpx.Request("POST", "https://api.cloudinary.com"))
        with patch.dict(os.environ, CONFIG), patch("backend.main.httpx.AsyncClient") as factory:
            client = factory.return_value.__aenter__.return_value
            client.post = AsyncMock(return_value=response)
            await upload_generated_image(b"test", "tour.jpg", "image/jpeg")
        params = client.post.call_args.kwargs["data"]
        self.assertIn("signature", params)
        self.assertEqual(params["folder"], "libot/virtual-tours")
        self.assertEqual(params["upload_preset"], "test-signed-preset")
