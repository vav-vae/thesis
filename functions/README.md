# LiBot trusted notification producers

These Firebase Functions are the trusted producers for the existing browser-first Firestore architecture. They derive recipients from the changed document, fan out only to that recipient’s enabled subscriptions, and write generic payloads to `notificationQueue` using deterministic SHA-256 document IDs.

Deploy from this directory with Firebase Admin credentials supplied by the Firebase CLI or CI. The queue consumer remains a separate scheduled worker; these functions never call `pywebpush` and never use in-process notification delivery.

Expected fields are `brokerId`, `buyerId`, `status`, `updatedAt`, `lastSenderId`, and `messages`, matching the current app records. If a field is absent, the producer skips the event safely.
