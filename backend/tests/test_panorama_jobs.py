import asyncio
import copy
import json
import unittest
from uuid import uuid4
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException
from backend.panorama_jobs import FirestoreJobStore, _signature, job_status, run_job


class MemoryStore:
    def __init__(self):
        self.values = {}

    async def save(self, identifier, job):
        self.values[identifier] = copy.deepcopy(job)

    async def create(self, identifier, job):
        if identifier in self.values:
            return False
        await self.save(identifier, job)
        return True

    async def get(self, identifier):
        return copy.deepcopy(self.values.get(identifier))


class PanoramaJobTests(unittest.IsolatedAsyncioTestCase):
    def job(self):
        return {"id": "job-1", "status": "queued", "stage": "Starting", "requestId": "req-1", "createdAt": 100, "input": {"image_urls": ["photo"], "property_id": "p-1", "room_type": "Living room"}}

    async def test_completed_result_and_draft_are_persisted_for_a_new_reader(self):
        store = MemoryStore()
        async def reconstruct(progress):
            progress("Rendering photos")
            return {"success": True, "panorama_url": "https://example.com/saved.jpg"}
        await run_job(store, self.job(), reconstruct)
        saved = store.values["job-1"]
        self.assertEqual(saved["status"], "completed")
        self.assertEqual(saved["result"]["panorama_url"], "https://example.com/saved.jpg")
        self.assertEqual(saved["input"]["room_type"], "Living room")
        self.assertNotIn("authorization", json.dumps(saved))

    async def test_explicit_failure_is_saved_instead_of_leaving_running_job(self):
        store = MemoryStore()
        async def reconstruct(progress):
            progress("Checking photo 6")
            raise HTTPException(422, "Photos 5 and 6 do not overlap.")
        await run_job(store, self.job(), reconstruct)
        self.assertEqual(store.values["job-1"]["status"], "failed")
        self.assertEqual(store.values["job-1"]["stage"], "Checking photo 6")
        self.assertIn("Photos 5 and 6", store.values["job-1"]["error"])

    async def test_unfinished_worker_expires_but_completed_results_remain_recoverable(self):
        self.assertEqual(job_status(self.job(), now=500)["code"], "TOUR_JOB_EXPIRED")
        self.assertEqual(job_status({**self.job(), "status": "completed"}, now=10000)["status"], "completed")

    async def test_snapshot_signature_binds_owner_job_and_content(self):
        with patch.dict("os.environ", {"PANORAMA_JOB_SECRET": "test-only-key"}):
            snapshot = json.dumps(self.job())
            signature = _signature("owner", "job-1", snapshot)
            self.assertNotEqual(signature, _signature("other", "job-1", snapshot))
            self.assertNotEqual(signature, _signature("owner", "job-2", snapshot))
            store = FirestoreJobStore("owner", "Bearer memory-only")
            store._request = AsyncMock(return_value=httpx.Response(200, json={"fields": {"brokerId": {"stringValue": "owner"}, "snapshot": {"stringValue": snapshot + " "}, "signature": {"stringValue": signature}}}))
            with self.assertRaises(HTTPException) as failure:
                await store.get("job-1")
            self.assertEqual(failure.exception.status_code, 409)

    async def test_worker_continues_when_no_status_reader_is_connected(self):
        store = MemoryStore()
        gate = asyncio.Event()
        entered = asyncio.Event()
        async def reconstruct(progress):
            entered.set()
            await gate.wait()
            return {"success": True}
        worker = asyncio.create_task(run_job(store, self.job(), reconstruct))
        await entered.wait()
        self.assertEqual(store.values["job-1"]["status"], "running")
        # No polling request exists: worker lifetime is independent of readers.
        gate.set()
        await worker
        self.assertEqual(store.values["job-1"]["status"], "completed")

    async def test_http_accepts_before_work_finishes_and_duplicate_submission_does_not_repeat_work(self):
        from backend.main import app
        store = MemoryStore()
        accepted = asyncio.Event()
        worker_entered = asyncio.Event()
        finish = asyncio.Event()
        identifier = str(uuid4())
        payload = {"image_urls": [f"https://example.com/{i}.jpg" for i in range(100)], "property_id": "p-1", "room_type": "Living room"}
        calls = 0
        async def reconstruct(*args, **kwargs):
            nonlocal calls
            calls += 1
            worker_entered.set()
            await finish.wait()
            return {"success": True, "panorama_url": "saved.jpg"}

        async def invoke(method):
            messages = []
            consumed = False
            async def receive():
                nonlocal consumed
                if consumed:
                    return {"type": "http.disconnect"}
                consumed = True
                return {"type": "http.request", "body": json.dumps(payload).encode() if method == "POST" else b"", "more_body": False}
            async def send(message):
                messages.append(message)
                if method == "POST" and message["type"] == "http.response.body":
                    accepted.set()
            scope = {"type": "http", "http_version": "1.1", "method": method, "scheme": "http", "path": f"/reconstruct/jobs/{identifier}", "raw_path": f"/reconstruct/jobs/{identifier}".encode(), "query_string": b"", "headers": [(b"authorization", b"Bearer test"), (b"content-type", b"application/json")], "client": ("127.0.0.6", 12000), "server": ("test", 80)}
            await app(scope, receive, send)
            status = next(message["status"] for message in messages if message["type"] == "http.response.start")
            body = b"".join(message.get("body", b"") for message in messages if message["type"] == "http.response.body")
            return status, json.loads(body)

        with patch("backend.security.FirebaseTokenVerifier.verify", new=AsyncMock(return_value={"sub": "job-broker"})), patch("backend.authorization.read_account", new=AsyncMock(return_value={"role": "broker"})), patch("backend.main.FirestoreJobStore", return_value=store), patch("backend.main.validate_cloudinary_source_url"), patch("backend.main.read_remote_images", new=AsyncMock(return_value=([], []))), patch("backend.main.build_hybrid_response", new=reconstruct), patch("backend.main.httpx.AsyncClient") as client_factory:
            client_factory.return_value.__aenter__.return_value.get = AsyncMock(return_value=httpx.Response(200, json={"fields": {"brokerId": {"stringValue": "job-broker"}}}))
            request = asyncio.create_task(invoke("POST"))
            await asyncio.wait_for(accepted.wait(), 3)
            await asyncio.wait_for(worker_entered.wait(), 3)
            self.assertFalse(request.done(), "202 was sent while the worker still owns the invocation")
            status, running = await invoke("GET")
            self.assertEqual(status, 200)
            self.assertEqual(running["status"], "running")
            finish.set()
            status, _ = await request
            self.assertEqual(status, 202)
            status, completed = await invoke("GET")
            self.assertEqual(completed["status"], "completed")
            status, duplicate = await invoke("POST")
            self.assertEqual(duplicate["status"], "completed")
            self.assertEqual(calls, 1)
