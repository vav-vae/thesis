import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException

from backend.authorization import read_account
from backend.main import app


class AuthorizationTests(unittest.IsolatedAsyncioTestCase):
    async def request(self, path, body=None):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await client.post(path, headers={"Authorization": "Bearer test"}, json=body or {})

    async def test_buyer_cannot_call_any_broker_compute_route(self):
        with patch("backend.security.FirebaseTokenVerifier.verify", new=AsyncMock(return_value={"sub": "role-test", "role": "admin"})), patch("backend.authorization.read_account", new=AsyncMock(return_value={"role": "buyer"})):
            for path in ["/validate", "/validate/remote", "/stitch", "/stitch/four-view", "/reconstruct/hybrid", "/reconstruct/hybrid/remote"]:
                response = await self.request(path)
                self.assertEqual(response.status_code, 403, path)

    async def test_buyer_cannot_create_or_read_panorama_jobs(self):
        with patch("backend.security.FirebaseTokenVerifier.verify", new=AsyncMock(return_value={"sub": "job-access-test"})), patch("backend.authorization.read_account", new=AsyncMock(return_value={"role": "buyer"})):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=("127.0.0.7", 12000)), base_url="http://test") as client:
                response = await client.post("/reconstruct/jobs/00000000-0000-4000-8000-000000000000", headers={"Authorization": "Bearer test"}, json={})
                self.assertEqual(response.status_code, 403)
                response = await client.get("/reconstruct/jobs/00000000-0000-4000-8000-000000000000", headers={"Authorization": "Bearer test"})
            self.assertEqual(response.status_code, 403)

    async def test_inactive_broker_and_missing_profile_are_denied(self):
        for account in [{"role": "broker", "accountStatus": "inactive"}, {}]:
            with patch("backend.security.FirebaseTokenVerifier.verify", new=AsyncMock(return_value={"sub": "role-test"})), patch("backend.authorization.read_account", new=AsyncMock(return_value=account)):
                response = await self.request("/validate/remote")
                self.assertEqual(response.status_code, 403)

    async def test_buyer_cannot_authorize_panorama_source_upload(self):
        with patch("backend.security.FirebaseTokenVerifier.verify", new=AsyncMock(return_value={"sub": "role-test"})), patch("backend.authorization.read_account", new=AsyncMock(return_value={"role": "buyer"})):
            response = await self.request("/uploads/sign", {"purpose": "panorama-source"})
            self.assertEqual(response.status_code, 403)

    async def test_role_lookup_failure_does_not_allow_compute(self):
        with patch("backend.security.FirebaseTokenVerifier.verify", new=AsyncMock(return_value={"sub": "role-test"})), patch("backend.authorization.read_account", new=AsyncMock(side_effect=HTTPException(503, "Unavailable"))):
            response = await self.request("/validate/remote")
            self.assertEqual(response.status_code, 503)

    async def test_active_broker_passes_authorization_to_request_validation(self):
        with patch("backend.security.FirebaseTokenVerifier.verify", new=AsyncMock(return_value={"sub": "role-test"})), patch("backend.authorization.read_account", new=AsyncMock(return_value={"role": "broker"})):
            response = await self.request("/validate/remote")
            self.assertEqual(response.status_code, 422)

    async def test_firestore_lookup_uses_verified_user_path_and_bearer_token(self):
        response = httpx.Response(200, json={"fields": {"role": {"stringValue": "broker"}}}, request=httpx.Request("GET", "https://firestore.googleapis.com"))
        with patch("backend.authorization.httpx.AsyncClient") as factory:
            client = factory.return_value.__aenter__.return_value
            client.get = AsyncMock(return_value=response)
            self.assertEqual((await read_account("safe/user", "Bearer verified"))["role"], "broker")
            args = client.get.call_args
            self.assertTrue(args.args[0].endswith("users/safe%2Fuser"))
            self.assertEqual(args.kwargs["headers"]["Authorization"], "Bearer verified")
