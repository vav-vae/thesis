"""Exercise the production cross-origin boundary without real Firebase credentials."""
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import unittest
from unittest.mock import patch

from backend.security import _client_ip


class RailwayHostingTests(unittest.TestCase):
    def test_entrypoint_binds_railway_port_with_one_worker(self):
        with patch.dict(os.environ, {"PORT": "9876"}), patch("uvicorn.run") as run:
            runpy.run_path(str(Path(__file__).resolve().parents[1] / "start.py"), run_name="__main__")
        self.assertEqual(run.call_args.kwargs["port"], 9876)
        self.assertEqual(run.call_args.kwargs["host"], "0.0.0.0")
        self.assertEqual(run.call_args.kwargs["workers"], 1)
        self.assertFalse(run.call_args.kwargs["proxy_headers"])
        self.assertGreaterEqual(run.call_args.kwargs["timeout_graceful_shutdown"], 240)

    def test_railway_rate_limits_use_trusted_real_ip_and_ignore_forwarded_chain(self):
        scope = {"type": "http", "client": ("10.0.0.1", 80), "headers": [(b"x-real-ip", b"203.0.113.10"), (b"x-forwarded-for", b"198.51.100.99")]}
        with patch.dict(os.environ, {"RAILWAY_PROJECT_ID": "test-project"}):
            self.assertEqual(_client_ip(scope, trust_proxy_headers=True), "203.0.113.10")
            self.assertEqual(_client_ip(scope, trust_proxy_headers=False), "10.0.0.1")
            scope["headers"][0] = (b"x-real-ip", b"invalid")
            self.assertEqual(_client_ip(scope, trust_proxy_headers=True), "10.0.0.1")

    def test_production_health_auth_and_cors(self):
        # A new process loads the production environment before FastAPI creates
        # its middleware, matching a fresh Railway container.
        script = '''
import asyncio, json, httpx
from backend.main import app
async def check():
    origin = "https://libot-survey.example"
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://backend.example") as client:
        health = await client.get("/health")
        assert health.status_code == 200 and health.json()["sift_available"]
        assert "strict-transport-security" in health.headers
        for path in ["/docs", "/openapi.json"]:
            assert (await client.get(path)).status_code == 404
        for path in ["/uploads/sign", "/api/backend/uploads/sign"]:
            response = await client.post(path, json={"purpose": "image"}, headers={"Origin": origin})
            assert response.status_code == 401
            assert response.headers["access-control-allow-origin"] == origin
            assert "x-request-id" in response.headers
            assert "x-request-id" in response.headers["access-control-expose-headers"].lower()
        headers = {"Origin": origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type"}
        allowed = await client.options("/uploads/sign", headers=headers)
        assert allowed.status_code == 200
        headers["Origin"] = "https://untrusted.example"
        blocked = await client.options("/uploads/sign", headers=headers)
        assert blocked.status_code == 400
        assert "access-control-allow-origin" not in blocked.headers
    print(json.dumps({"passed": True}))
asyncio.run(check())
'''
        environment = {**os.environ, "ENVIRONMENT": "production", "FRONTEND_ORIGINS": "https://libot-survey.example", "RAILWAY_PROJECT_ID": "test-project"}
        result = subprocess.run([sys.executable, "-c", script], cwd=Path(__file__).resolve().parents[2], env=environment, capture_output=True, text=True, timeout=45)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)["passed"])


if __name__ == "__main__":
    unittest.main()
