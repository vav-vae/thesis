# LiBot push notifications — Phase 2 contract

This document defines the subscription model and API boundary before any settings UI or event producers are added. Phase 2 uses Web Push with VAPID. The browser never sends a private key to LiBot, and notification payloads contain no property, offer, message, or personal details.

## Firestore model

Collection: `users/{userId}/pushSubscriptions/{subscriptionId}`

```text
endpoint: string                 # Web Push endpoint; unique per browser profile
keys: { p256dh: string, auth: string }
platform: "android" | "ios" | "desktop" | "unknown"
userAgentFamily: string          # coarse family only; no raw UA required
createdAt: server timestamp
updatedAt: server timestamp
lastSuccessAt: server timestamp | null
failureCount: number             # bounded, reset after successful delivery
expiresAt: timestamp | null      # endpoint-provided expiry when available
enabled: boolean
```

`subscriptionId` is a server-generated opaque ID. The endpoint is stored as data, not as a document ID, so endpoint hashing or rotation does not expose transport details in paths. A user can have multiple active devices; an upsert replaces the matching endpoint for that user only.

## Backend endpoints

All endpoints require a verified Firebase ID token. The authenticated subject is always taken from the token (`request.state.firebase_user["sub"]`); a client-supplied user ID is rejected or ignored.

### `POST /notifications/subscriptions`

Register or update one device subscription. Request body is strict and limited to the Web Push subscription shape plus a coarse platform value:

```json
{
  "endpoint": "https://push-service.example/...",
  "keys": { "p256dh": "...", "auth": "..." },
  "platform": "android"
}
```

The server validates HTTPS endpoints, key lengths/encoding, payload size, and platform values. It returns only `{ "id": "opaque-id", "enabled": true }`.

### `DELETE /notifications/subscriptions/{subscriptionId}`

Disable and delete one subscription belonging to the authenticated user. Deletion is idempotent.

### `GET /notifications/subscriptions`

Return metadata only (`id`, `platform`, `enabled`, `createdAt`, `updatedAt`, `lastSuccessAt`). Never return endpoint or encryption keys.

## Delivery rules

The trusted backend event producer sends a generic payload such as:

```json
{ "type": "viewing-approved", "target": "/buyer/calendar", "notificationId": "opaque-id" }
```

Allowed `type` values map to known server-generated routes. `target` is allow-listed to property, negotiation, or schedule routes and is never accepted directly from an untrusted notification request. The service worker resolves the target and displays a generic title/body without sensitive previews.

On delivery:

- `201/202` records `lastSuccessAt` and resets `failureCount`.
- `404`, `410`, or an invalid subscription response deletes the subscription immediately.
- Other failures increment `failureCount`; subscriptions are disabled after a bounded retry threshold and removed by cleanup.
- Delivery runs in a background worker/queue, never inside a user-facing request.

VAPID private key and subject remain backend-only environment secrets. The public VAPID key may be exposed to the browser through a read-only configuration endpoint or build-time public variable.

## Firestore rules and operational constraints

Clients must not write `pushSubscriptions` directly. Only the trusted backend service account can create, update, disable, or delete subscription documents. Event producers may enqueue only allow-listed event types with server-derived recipients. Subscription writes and delivery endpoints are rate-limited per authenticated user and IP, with a strict body limit.

The initial implementation intentionally does not include offline editing, background sync, notification UI, or event producers. Those follow after this contract and the backend storage/queue credentials are available.
