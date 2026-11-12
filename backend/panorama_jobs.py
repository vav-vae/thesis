"""Persistent broker jobs. Tokens stay in worker memory, never in job documents.

Firestore REST uses the requesting broker's existing permissions. A signed
snapshot prevents client writes from impersonating worker progress/results.
The ASGI BackgroundTask is awaited by the invocation, not detached create_task.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import time
from datetime import datetime, timezone
from urllib.parse import quote
from uuid import uuid4

import httpx
from fastapi import HTTPException

logger = logging.getLogger(__name__)
JOB_TIMEOUT_SECONDS = 240
JOB_STALE_SECONDS = 330


def _signature(broker_id: str, job_id: str, snapshot: str) -> str:
    secret = os.getenv("PANORAMA_JOB_SECRET") or os.getenv("CLOUDINARY_API_SECRET", "")
    if not secret:
        raise HTTPException(503, "Background tour jobs are not configured.")
    return hmac.new(secret.encode(), f"libot-tour-job-v1\n{broker_id}\n{job_id}\n{snapshot}".encode(), hashlib.sha256).hexdigest()


class FirestoreJobStore:
    def __init__(self, broker_id: str, authorization: str):
        self.broker_id = broker_id
        self.authorization = authorization
        project = os.getenv("FIREBASE_PROJECT_ID", "libot-790e6")
        self.base = f"https://firestore.googleapis.com/v1/projects/{quote(project, safe='')}/databases/(default)/documents/tourJobs"

    async def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    response = await client.request(method, url, headers={"Authorization": self.authorization}, **kwargs)
                if response.status_code < 500 or attempt == 2:
                    return response
            except httpx.HTTPError:
                if attempt == 2:
                    raise HTTPException(503, "Job storage is temporarily unavailable. Reconnect to check this job.") from None
            await asyncio.sleep(0.3 * (attempt + 1))
        raise HTTPException(503, "Job storage is temporarily unavailable.")

    def _document(self, job_id: str, job: dict) -> dict:
        snapshot = json.dumps(job, separators=(",", ":"), allow_nan=False)
        if len(snapshot.encode()) > 850_000:
            raise HTTPException(500, "The tour job result exceeded its storage limit.")
        return {"fields": {"brokerId": {"stringValue": self.broker_id}, "snapshot": {"stringValue": snapshot}, "signature": {"stringValue": _signature(self.broker_id, job_id, snapshot)}}}

    async def get(self, job_id: str) -> dict | None:
        response = await self._request("GET", f"{self.base}/{quote(job_id, safe='')}")
        if response.status_code == 404:
            return None
        if response.status_code == 403:
            raise HTTPException(403, "You cannot access this tour job. Check account access and job rules.")
        if not response.is_success:
            raise HTTPException(503, "Job storage could not be read. Reconnect to check this job.")
        fields = response.json().get("fields", {})
        snapshot = fields.get("snapshot", {}).get("stringValue", "")
        signature = fields.get("signature", {}).get("stringValue", "")
        if fields.get("brokerId", {}).get("stringValue") != self.broker_id or not hmac.compare_digest(signature, _signature(self.broker_id, job_id, snapshot)):
            raise HTTPException(409, "The saved job could not be verified. Start a new generation.")
        return json.loads(snapshot)

    async def create(self, job_id: str, job: dict) -> bool:
        response = await self._request("POST", self.base, params={"documentId": job_id}, json=self._document(job_id, job))
        if response.status_code == 409:
            return False
        if not response.is_success:
            raise HTTPException(503, "Could not save the tour job. Check Firestore job rules before retrying.")
        return True

    async def save(self, job_id: str, job: dict):
        response = await self._request("PATCH", f"{self.base}/{quote(job_id, safe='')}", params={"currentDocument.exists": "true"}, json=self._document(job_id, job))
        if not response.is_success:
            raise HTTPException(503, "Could not save tour job progress. Reconnect to check this job.")

    async def log(self, job: dict):
        """Admin events continue even while the phone is disconnected."""
        try:
            level = "error" if job["status"] == "failed" else "info"
            fields = {key: {"stringValue": value} for key, value in {
                "brokerId": self.broker_id, "sessionId": job["id"], "propertyId": job["input"]["property_id"],
                "level": level, "message": f"Tour worker: {job['stage']}",
                "detail": f"Job ID: {job['id']}\nRequest ID: {job['requestId']}\nStatus: {job['status']}\nElapsed: {job.get('elapsedMs', 0)} ms\n{job.get('error', '')}",
                "page": "/broker/create-tour", "browser": "Server worker", "clientTime": datetime.now(timezone.utc).isoformat(),
            }.items()}
            fields["online"] = {"booleanValue": True}
            database = self.base.split("/documents/")[0]
            await self._request("POST", f"{database}/documents:commit", json={"writes": [{"update": {"name": f"{database.split('/v1/')[1]}/documents/tourLogs/{uuid4().hex}", "fields": fields}, "updateTransforms": [{"fieldPath": "createdAt", "setToServerValue": "REQUEST_TIME"}]}]})
        except Exception:
            logger.warning("panorama_job_log_unavailable job_id=%s", job["id"])


def job_status(job: dict, now: float | None = None) -> dict:
    """A killed/timed-out invocation must never leave an endless spinner."""
    if job["status"] in {"queued", "running"} and (now if now is not None else time.time()) - job["createdAt"] > JOB_STALE_SECONDS:
        return {**job, "status": "failed", "code": "TOUR_JOB_EXPIRED", "error": "The worker stopped before saving a result. Retry this saved capture set; no recapture is needed."}
    return job


async def run_job(store, job: dict, reconstruct):
    job = {**job, "status": "running"}
    latest_stage = "Downloading photos"
    started = time.monotonic()
    last_logged = started

    def progress(stage: str):
        nonlocal latest_stage
        latest_stage = stage

    task = None
    try:
        await store.save(job["id"], job)
        if hasattr(store, "log"):
            await store.log(job)
        task = asyncio.create_task(reconstruct(progress))
        while not task.done():
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=3)
            except TimeoutError:
                job.update(stage=latest_stage, elapsedMs=round((time.monotonic() - started) * 1000))
                await store.save(job["id"], job)
                if hasattr(store, "log") and time.monotonic() - last_logged >= 15:
                    await store.log(job)
                    last_logged = time.monotonic()
                if time.monotonic() - started > JOB_TIMEOUT_SECONDS:
                    raise HTTPException(504, "Generation exceeded its processing limit. Retry with fewer or smaller photos.")
            except Exception:
                break
        job.update(status="completed", stage="Tour ready to review", result=task.result())
        logger.info("panorama_job_complete job_id=%s request_id=%s elapsed_seconds=%.1f", job["id"], job["requestId"], time.monotonic() - started)
    except Exception as error:
        job.update(status="failed", stage=latest_stage, code="TOUR_JOB_FAILED", error=str(error.detail) if isinstance(error, HTTPException) else "The processor could not finish this job. Use the job and request IDs to inspect server logs.")
        logger.exception("panorama_job_failed job_id=%s request_id=%s stage=%s", job["id"], job["requestId"], latest_stage)
    finally:
        if task is not None and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    job["elapsedMs"] = round((time.monotonic() - started) * 1000)
    await store.save(job["id"], job)
    if hasattr(store, "log"):
        await store.log(job)
