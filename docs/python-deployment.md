# Python backend packaging

The `libot` Vercel project builds `backend/main.py` with Python dependencies
bundled at build time. Keep these non-secret project environment variables set
to `1` for Production and Preview, then redeploy after changing them:

- `VERCEL_PYTHON_DISABLE_RUNTIME_INSTALL`: disables cold-start `uv sync`.
- `VERCEL_SUPPORT_LARGE_FUNCTIONS`: permits a fully bundled Python function
  when its native dependencies exceed the standard bundle limit.

Fluid compute must be enabled. No plan upgrade is needed for this setting.
Keep OpenCV, NumPy, Firebase Admin and web-push dependencies: they are used by
panorama generation and notifications. Base uvicorn is enough for local ASGI
development; its optional reload/websocket dependencies are not required.
Tests, bytecode caches, local environments and generated outputs are excluded
from the backend function through its resolved `main.py` entrypoint.

## Why build-time bundling is required

On November 13, 2026, an upload-signing request failed before the application
started. Vercel attempted to install native dependencies into temporary storage;
extracting `cv2/cv2.abi3.so` failed with `No space left on device (os error 28)`.
The process exited and `/api/backend/uploads/sign` returned a non-JSON HTTP 500.
The upload client had misleadingly reported Cloudinary as the failing endpoint.

Build-time bundling avoids dependency downloads and extraction in temporary
storage on a live request. It also moves missing/incompatible package failures
to deployment validation. It does not remove temporary disk limits for generated
panoramas; those outputs still need bounded sizes and normal lifecycle cleanup.

## Release verification

1. Run the HTTP-response, capture-diagnostic and tour-log-diagnosis tests and
   the signed-upload backend tests.
2. Verify both packaging variables are set for the intended deployment target.
3. Inspect the backend build output: all dependencies must be bundled; there
   must be no cold-start runtime dependency install configuration.
4. After deployment, check `/api/backend/health` and concurrent POST requests
   to `/api/backend/uploads/sign` without a token. The latter must return JSON
   HTTP 401, not an installation failure or HTTP 500.
5. With an active broker account, retry retained photos and confirm signing,
   Cloudinary uploads and panorama generation. Use Vercel request IDs to
   correlate any new server failures.

References: [Python runtime](https://vercel.com/docs/functions/runtimes/python),
[large functions](https://vercel.com/docs/functions/limitations#large-functions-beta),
[Python packaging implementation](https://github.com/vercel/vercel/blob/main/packages/python/src/dependency-externalizer.ts).
