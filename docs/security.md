# LiBot security controls

## Implemented application controls

The panorama API requires a valid Firebase Authentication ID token on every
compute endpoint:

- `POST /validate`
- `POST /validate/remote`
- `POST /stitch`
- `POST /reconstruct/hybrid`
- `POST /reconstruct/hybrid/remote`
- `POST /stitch/four-view`

The browser sends the token in `Authorization: Bearer <token>`. The API verifies
the RS256 signature against Google's rotating Firebase keys and validates the
issuer, audience, expiry, issue time, authentication time, and subject. Missing
or invalid credentials are rejected before multipart parsing.

LiBot also imposes an eight-hour absolute session limit. The browser signs out
when the Firebase `authTime` reaches that limit, and the panorama API rejects
tokens authenticated more than `PANORAMA_MAX_SESSION_AGE_SECONDS` ago. Token
refreshes do not extend the deadline. Set that variable to a positive number of
seconds if the production policy requires a different duration.

Each API instance also applies sliding-window quotas:

| Workload | Per authenticated user | Per IP address |
| --- | ---: | ---: |
| Image validation | 60 requests / 5 minutes | 120 requests / 5 minutes |
| Reconstruction | 4 requests / 10 minutes | 10 requests / 10 minutes |

The multipart and remote-JSON variants share these quota buckets, so switching
transport does not grant an additional allowance.

At most one OpenCV job runs concurrently per instance. Further jobs receive a
temporary `503` response instead of consuming unbounded CPU and memory.

Upload controls include:

- 126 MiB maximum HTTP request body;
- 120-second authenticated upload deadline;
- 15 MiB per file and 120 MiB combined file data;
- JPEG, PNG, and WEBP only, checked from both declared type and actual header;
- 12.5 million decoded pixels per image and 100 million per request;
- finite RANSAC thresholds between 1 and 10; and
- route-specific image-count limits.

The active broker workflow uploads source images directly from the browser to
Cloudinary, then sends a small authenticated JSON request to
`/validate/remote` or `/reconstruct/hybrid/remote`. The remote routes add these
controls:

- 64 KiB maximum JSON request body;
- 2–30 unique URLs for validation and 6–12 for hybrid reconstruction;
- 2,048 characters per URL;
- exact HTTPS host, Cloudinary account, versioned delivery path, configured
  source folder, and authenticated-user folder;
- no URL credentials, alternate ports, query strings, fragments,
  transformations, redirects, compressed responses, or proxy inheritance;
- 30-second maximum per download and 90 seconds for the batch; and
- the same 15 MiB per-image, 120 MiB aggregate, format, and decoded-pixel
  checks applied to multipart uploads.

This strict allowlist prevents the API from acting as a general URL fetcher.
Source delivery URLs are still public references, not proof that Cloudinary
authenticated the uploader.

The backend returns no-store, content-sniffing, frame, referrer, permissions,
request-ID, and production HSTS headers. Interactive API documentation is
disabled in production. The Next.js frontend sets a CSP and complementary
browser security headers and removes the framework identification header.

See [`backend/.env.example`](../backend/.env.example) for backend limits and
[`.env.example`](../.env.example) for browser-visible configuration.

## Cloudinary source-upload configuration

The following values must describe the same Cloudinary account and source
folder:

| Browser | Backend |
| --- | --- |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | `CLOUDINARY_CLOUD_NAME` |
| `NEXT_PUBLIC_CLOUDINARY_SOURCE_FOLDER` | `CLOUDINARY_SOURCE_FOLDER` |

`NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET` selects the browser upload preset. All
`NEXT_PUBLIC_*` values are public configuration and must never contain a
Cloudinary API secret.

The current browser flow needs the upload preset to be unsigned and to preserve
the caller-supplied source folder in the returned, versioned `secure_url`.
Configure this preset to:

- accept image uploads only and allow only JPG/JPEG, PNG, and WEBP;
- cap each upload at 15 MiB and constrain decoded dimensions;
- keep unsigned overwrite disabled;
- enable `disallow_public_id`, set `use_filename=false` and
  `unique_filename=true`, and let Cloudinary assign a random public ID;
- avoid unneeded incoming transformations and metadata;
- avoid forcing a conflicting folder or public-ID prefix.

Cloudinary folder mode and preset precedence can change the returned delivery
path. Test the preset with a non-production asset and confirm that its
`secure_url` has this exact shape:

```text
https://res.cloudinary.com/<cloud>/image/upload/v<version>/<source-folder>/<uid-hash>/<generated-id>.<jpg|jpeg|png|webp>
```

The browser rejects any upload response outside that shape, and the backend
independently applies the same check. Cloudinary documents the relevant
[unsigned-upload restrictions](https://cloudinary.com/documentation/image_upload_api_reference#unsigned_upload_parameters)
and [upload-preset precedence and safeguards](https://cloudinary.com/documentation/upload_presets#signed_and_unsigned_upload_preset_security).

An unsigned preset is a transitional control: its name is visible to every
browser and folder naming is not cryptographic ownership proof. The stronger
production design is an authenticated backend endpoint that issues a
short-lived Cloudinary upload signature constrained to a server-chosen object
ID, folder, type, size policy, and timestamp. The browser can still upload
bytes directly, while the backend verifies the signed upload response and
stores the object ID against the Firebase UID. Keep `CLOUDINARY_API_SECRET`
exclusively on the backend. Cloudinary describes this pattern in its
[client-side signed-upload guidance](https://cloudinary.com/documentation/client_side_uploading#cors_origins_and_signing_for_direct_browser_uploads).

## Required production controls

The application rate limiter is intentionally a second line of defense. Vercel
can run multiple isolated backend instances, so memory-based counters are not a
deployment-wide quota.

Configure Vercel WAF rate-limit rules for `/api/backend/*`, keyed by the client
IP. A practical starting point is 60 requests per 5 minutes for the whole API
and 6 requests per 10 minutes for reconstruction routes. Tune these values from
real traffic without exceeding the stricter per-user limits in the app.

Vercel Functions currently limit request and response bodies to 4.5 MB. The
active browser workflow avoids sending panorama bytes through the function by
using direct Cloudinary uploads followed by the 64 KiB remote-JSON routes.

The legacy multipart routes remain available for local development and compute
infrastructure that explicitly supports the configured 126 MiB request limit.
They are not a viable fallback through a standard Vercel Function for normal
6–12-image panorama batches. See [Vercel Functions
limits](https://vercel.com/docs/functions/limitations#request-body-size).

Monitor Cloudinary usage and storage growth, alert on spikes, and replace a
leaked or abused unsigned preset. Use a separate, independently constrained
preset for government-ID or license uploads; panorama-source settings should
not silently broaden document-upload permissions.

For stronger bot and scripted-client resistance, enable Firebase App Check with
reCAPTCHA Enterprise and require `X-Firebase-AppCheck` on the panorama API.
Firebase Authentication proves user identity; App Check adds evidence that the
request originated from an authorized application instance.

## Firebase data warning

The repository's Firestore rules were reconciled with the deployed rules and
deployed on September 16, 2026, after emulator verification. Broker registration
may create a pending profile but cannot grant verification or administrator
privileges. Do not treat client-side route guards as data authorization.

The current `users/{uid}` documents mix public profile fields with sensitive
government-ID and license URLs. Firestore reads are document-wide, so safely
sharing profile/contact information while hiding those documents requires a
schema split. Move shareable identity fields to `publicProfiles/{uid}`, keep
verification documents in a private owner/admin-only collection, and move
privileged negotiation/contact-copy operations to trusted backend code before
enforcing restrictive production rules.
