"""Push subscriptions and a durable Firestore-backed notification worker."""
from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PushKeys(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    p256dh: str = Field(min_length=16, max_length=256)
    auth: str = Field(min_length=8, max_length=128)


class PushSubscriptionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    endpoint: str = Field(min_length=20, max_length=2048)
    keys: PushKeys
    platform: str = "unknown"

    @field_validator("endpoint")
    @classmethod
    def https_only(cls, value: str) -> str:
        if not value.startswith("https://"):
            raise ValueError("Push endpoint must use HTTPS.")
        return value

    @field_validator("platform")
    @classmethod
    def known_platform(cls, value: str) -> str:
        if value not in {"android", "ios", "desktop", "unknown"}:
            raise ValueError("Unsupported platform.")
        return value


def admin_db():
    try:
        import firebase_admin
        from firebase_admin import firestore
    except ImportError as error:
        raise RuntimeError("firebase-admin is required for push notifications.") from error
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    return firestore.client()


class FirestoreSubscriptionRepository:
    def __init__(self, db: Any | None = None):
        self.db = db

    def _collection(self, user_id: str):
        return (self.db or admin_db()).collection("users").document(user_id).collection("pushSubscriptions")

    async def upsert(self, user_id: str, payload: PushSubscriptionRequest) -> dict[str, Any]:
        def write():
            existing = next(iter(self._collection(user_id).where("endpoint", "==", payload.endpoint).limit(1).stream()), None)
            reference = existing.reference if existing else self._collection(user_id).document()
            now = datetime.now(timezone.utc)
            values = {"endpoint": payload.endpoint, "keys": payload.keys.model_dump(), "platform": payload.platform, "updatedAt": now, "enabled": True, "failureCount": 0}
            if not existing:
                values["createdAt"] = now
            reference.set(values, merge=True)
            return {"id": reference.id, "enabled": True}
        return await asyncio.to_thread(write)

    async def list(self, user_id: str) -> list[dict[str, Any]]:
        def read():
            result = []
            for snapshot in self._collection(user_id).stream():
                data = snapshot.to_dict() or {}
                result.append({"id": snapshot.id, "platform": data.get("platform", "unknown"), "enabled": bool(data.get("enabled", False)), "createdAt": data.get("createdAt"), "updatedAt": data.get("updatedAt"), "lastSuccessAt": data.get("lastSuccessAt")})
            return result
        return await asyncio.to_thread(read)

    async def get(self, user_id: str, subscription_id: str) -> dict[str, Any] | None:
        def read():
            snapshot = self._collection(user_id).document(subscription_id).get()
            return {"id": snapshot.id, **(snapshot.to_dict() or {})} if snapshot.exists else None
        return await asyncio.to_thread(read)

    async def delete(self, user_id: str, subscription_id: str) -> bool:
        def remove():
            reference = self._collection(user_id).document(subscription_id)
            if not reference.get().exists:
                return False
            reference.delete()
            return True
        return await asyncio.to_thread(remove)

    async def remove(self, user_id: str, subscription_id: str) -> None:
        await self.delete(user_id, subscription_id)


class FirestoreQueue:
    def __init__(self, db: Any | None = None):
        self.db = db
        self.collection_name = os.getenv("NOTIFICATION_QUEUE_COLLECTION", "notificationQueue")

    def _collection(self):
        return (self.db or admin_db()).collection(self.collection_name)

    async def enqueue(self, event: dict[str, Any], event_id: str | None = None) -> str:
        identifier = event_id or uuid4().hex
        def write():
            reference = self._collection().document(identifier)
            reference.create({"payload": event, "status": "pending", "attempts": 0, "createdAt": datetime.now(timezone.utc), "nextAttemptAt": datetime.now(timezone.utc)})
            return identifier
        try:
            return await asyncio.to_thread(write)
        except Exception:
            # create() already provides idempotency for duplicate event IDs.
            return identifier

    async def lease(self, worker_id: str, limit: int = 10, lease_seconds: int = 60) -> list[dict[str, Any]]:
        def claim():
            from google.cloud.firestore_v1 import transactional
            now = datetime.now(timezone.utc)
            result = []
            for snapshot in self._collection().where("status", "in", ["pending", "retry"]).limit(limit).stream():
                @transactional
                def transaction(transaction):
                    fresh = snapshot.reference.get(transaction=transaction)
                    data = fresh.to_dict() or {}
                    if data.get("status") not in {"pending", "retry"} or (data.get("nextAttemptAt") and data["nextAttemptAt"] > now):
                        return None
                    transaction.update(snapshot.reference, {"status": "leased", "leaseOwner": worker_id, "leaseUntil": now + timedelta(seconds=lease_seconds), "attempts": int(data.get("attempts", 0)) + 1})
                    return {"id": snapshot.id, **data, "attempts": int(data.get("attempts", 0)) + 1}
                claimed = transaction(self._collection()._client.transaction())
                if claimed:
                    result.append(claimed)
            return result
        return await asyncio.to_thread(claim)

    async def complete(self, event_id: str, worker_id: str) -> None:
        await asyncio.to_thread(lambda: self._collection().document(event_id).update({"status": "complete", "completedAt": datetime.now(timezone.utc), "completedBy": worker_id}))

    async def retry(self, event_id: str, attempts: int, worker_id: str, permanent: bool = False) -> None:
        delay = min(3600, 2 ** max(0, attempts - 1))
        state = "dead" if permanent else "retry"
        await asyncio.to_thread(lambda: self._collection().document(event_id).update({"status": state, "nextAttemptAt": datetime.now(timezone.utc) + timedelta(seconds=delay), "lastErrorAt": datetime.now(timezone.utc), "lastErrorBy": worker_id}))


class PushNotConfigured(RuntimeError):
    pass


class WebPushSender:
    def __init__(self):
        self.private_key = os.getenv("VAPID_PRIVATE_KEY")
        self.subject = os.getenv("VAPID_SUBJECT")

    @property
    def configured(self) -> bool:
        return bool(self.private_key and self.subject)

    async def send(self, subscription: dict[str, Any], payload: str) -> None:
        if not self.configured:
            raise PushNotConfigured("Push delivery is not configured.")
        from pywebpush import webpush
        await asyncio.to_thread(webpush, subscription_info={"endpoint": subscription["endpoint"], "keys": subscription["keys"]}, data=payload, vapid_private_key=self.private_key, vapid_claims={"sub": self.subject}, ttl=300)


ALLOWED_TARGETS = {"property", "negotiation", "schedule"}
GENERIC_MESSAGES = {"new-viewing-request": ("New viewing request", "Open LiBot to review a viewing request."), "viewing-approved": ("Viewing approved", "Your LiBot viewing update is ready."), "viewing-declined": ("Viewing update", "Your LiBot viewing update is ready."), "viewing-rescheduled": ("Viewing rescheduled", "Your LiBot viewing update is ready."), "negotiation-update": ("Negotiation update", "Your LiBot negotiation has an update."), "broker-verification": ("Verification update", "Your LiBot verification status has changed."), "property-match": ("New property match", "A property matching your preferences is available.")}


class NotificationWorker:
    def __init__(self, repository: FirestoreSubscriptionRepository, queue: FirestoreQueue, sender: WebPushSender, max_attempts: int = 5):
        self.repository, self.queue, self.sender, self.max_attempts = repository, queue, sender, max_attempts

    async def process(self, item: dict[str, Any], worker_id: str) -> None:
        event = item.get("payload", {})
        kind, target_type = event.get("type"), event.get("targetType")
        if kind not in GENERIC_MESSAGES or target_type not in ALLOWED_TARGETS:
            await self.queue.complete(item["id"], worker_id); return
        user_id, subscription_id = str(event["userId"]), str(event["subscriptionId"])
        subscription = await self.repository.get(user_id, subscription_id)
        if not subscription:
            await self.queue.complete(item["id"], worker_id); return
        title, body = GENERIC_MESSAGES[kind]
        payload = json.dumps({"title": title, "body": body, "target": event.get("target", "/login")})
        try:
            await self.sender.send(subscription, payload)
            await self.queue.complete(item["id"], worker_id)
        except Exception as error:
            status_code = getattr(error, "status_code", None)
            invalid = status_code in {404, 410}
            if invalid:
                await self.repository.remove(user_id, subscription_id)
            await self.queue.retry(item["id"], int(item.get("attempts", 1)), worker_id, permanent=invalid or int(item.get("attempts", 1)) >= self.max_attempts)
