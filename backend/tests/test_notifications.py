import asyncio
import os
import unittest
from unittest.mock import AsyncMock, patch

from backend.notifications import PushNotConfigured, PushSubscriptionRequest, WebPushSender, NotificationWorker


class FakeQueue:
    def __init__(self): self.calls = []
    async def complete(self, *args): self.calls.append(("complete", args))
    async def retry(self, *args, **kwargs): self.calls.append(("retry", args, kwargs))


class NotificationTests(unittest.TestCase):
    def test_subscription_rejects_non_https(self):
        with self.assertRaises(ValueError):
            PushSubscriptionRequest(endpoint="http://example.com/" + "x" * 20, keys={"p256dh": "x" * 20, "auth": "x" * 8})

    def test_sender_gracefully_reports_missing_secrets(self):
        with patch.dict(os.environ, {}, clear=True):
            sender = WebPushSender()
            with self.assertRaises(PushNotConfigured):
                asyncio.run(sender.send({}, "{}"))

    def test_worker_removes_invalid_subscription_and_marks_job_permanent(self):
        repository = AsyncMock()
        repository.get.return_value = {"endpoint": "https://push.example", "keys": {"p256dh": "x", "auth": "y"}}
        queue = FakeQueue()
        sender = AsyncMock()
        error = RuntimeError("gone"); error.status_code = 410
        sender.send.side_effect = error
        worker = NotificationWorker(repository, queue, sender, max_attempts=5)
        asyncio.run(worker.process({"id": "job-1", "attempts": 1, "payload": {"type": "viewing-approved", "targetType": "schedule", "userId": "u1", "subscriptionId": "s1"}}, "w1"))
        repository.remove.assert_awaited_once_with("u1", "s1")
        self.assertEqual(queue.calls[0][0], "retry")
        self.assertTrue(queue.calls[0][2]["permanent"])


if __name__ == "__main__": unittest.main()
