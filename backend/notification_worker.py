"""Scheduled worker entrypoint. Deploy this as a separate job/service, not FastAPI."""
from __future__ import annotations

import asyncio
import os
from uuid import uuid4

try:
    from .notifications import FirestoreQueue, FirestoreSubscriptionRepository, NotificationWorker, WebPushSender
except ImportError:
    from notifications import FirestoreQueue, FirestoreSubscriptionRepository, NotificationWorker, WebPushSender


async def run_once() -> int:
    worker_id = f"worker-{uuid4().hex}"
    queue = FirestoreQueue()
    worker = NotificationWorker(FirestoreSubscriptionRepository(), queue, WebPushSender(), max_attempts=int(os.getenv("NOTIFICATION_MAX_ATTEMPTS", "5")))
    items = await queue.lease(worker_id, limit=int(os.getenv("NOTIFICATION_BATCH_SIZE", "10")), lease_seconds=int(os.getenv("NOTIFICATION_LEASE_SECONDS", "60")))
    for item in items:
        await worker.process(item, worker_id)
    return len(items)


if __name__ == "__main__":
    print(f"processed={asyncio.run(run_once())}")
