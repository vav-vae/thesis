# Railway backend migration

The target is Vercel for the Next.js website and Railway for the FastAPI API
and OpenCV panorama processing. Firebase and Cloudinary remain the data and
image services. Production browsers call Railway directly so CPU-heavy work
does not execute in Vercel Functions.

The checked-in `vercel.json` intentionally retains the existing Vercel backend
until Railway has been provisioned and verified. `deploy/vercel.railway.json`
is the frontend-only replacement. Do not remove the live backend before the
Railway URL, credentials, CORS, and a real panorama have been checked.

## Railway service

1. Use the existing GitHub repository `vav-vae/thesis`, branch `main`.
2. Create a Python backend service with **Root Directory** `/backend` and
   **Config File** `/backend/railway.json`. Railway's config file path is
   relative to the repository, not to the service root.
3. Select the Singapore region if available. Use Hobby paid hosting for the
   survey; monitor actual memory and CPU consumption to determine the budget.
4. The Dockerfile installs Python 3.12 and all native Python dependencies at
   build time. Leave the dashboard's build/start command overrides empty.
5. Generate a public HTTPS domain. Do not create a TCP proxy. Target the port
   supplied by Railway's `PORT` variable; the application binds `0.0.0.0`.
6. The config uses one replica, disables sleeping, checks `/health`, restarts
   on failure, and allows 300 seconds for graceful shutdown. Keep one Uvicorn
   worker and one concurrent panorama job to preserve the capacity gate. Size
   memory from a representative multi-photo generation before the survey;
   a low memory limit can still kill a job even on paid hosting.

Configure these Railway runtime variables before switching traffic:

| Variable | Value |
| --- | --- |
| `FIREBASE_PROJECT_ID` | `libot-790e6` |
| `ENVIRONMENT` | `production` (also supplied by the image) |
| `FRONTEND_ORIGINS` | Exact production website origin(s), comma-separated, no trailing slashes |
| `TRUST_PROXY_HEADERS` | `true`, only for Railway public HTTP ingress |
| `CLOUDINARY_CLOUD_NAME` | Existing cloud name |
| `CLOUDINARY_API_KEY` | Existing private server credential |
| `CLOUDINARY_API_SECRET` | Existing private server credential |
| `CLOUDINARY_SIGNED_UPLOAD_PRESET` | Existing signed upload preset |
| `CLOUDINARY_SOURCE_FOLDER` | `libot/panorama-sources` |
| `PANORAMA_JOB_SECRET` | Preserve the existing value if set; otherwise leave unset to retain the Cloudinary-secret fallback |
| `PANORAMA_MAX_CONCURRENT_JOBS` | `1` |

Use `backend/.env.example` for the remaining limits. Transfer credentials
directly between provider consoles; do not put them in Git, command arguments,
browser-visible variables, screenshots, or chat. Do not copy `VERCEL` or
`VERCEL_*` variables to Railway. Keep signing secrets stable so saved jobs
remain readable. The app uses Railway's overwritten `X-Real-IP` only when
proxy trust is explicitly enabled; private/TCP ingress must not expose it to
untrusted callers.

If push notifications are currently enabled, preserve their `VAPID_*` values
and `PUSH_NOTIFICATIONS_ENABLED` setting. The separate notification worker
still needs its existing scheduler and Firebase Admin credentials; deploying
the API does not automatically schedule `notification_worker.py`.

## Verify and switch

From the repository root, using Node.js 22.18 or newer:

```powershell
node scripts/railway-cutover.mjs --backend-url https://YOUR-SERVICE.up.railway.app --frontend-origin https://YOUR-WEBSITE
```

This checks health, SIFT availability, production CORS, and unauthenticated
upload rejection without needing credentials or running panorama compute.
It does not prove private Cloudinary credentials or a full generation work.

Set `NEXT_PUBLIC_PANORAMA_API_URL` in the Vercel Production environment to
the Railway HTTPS base URL. Use the same value for Preview only if that
preview origin is explicitly included in Railway's `FRONTEND_ORIGINS`.
The variable is public and frozen into the browser bundle at build time;
a new Vercel build is required. Do not use a localhost URL in production.

Before retiring the Vercel backend, test a preview with an active broker:
sign in, request an upload signature, upload retained photos, generate a
panorama, disconnect/reconnect the phone, review, publish, and open the
published tour as a buyer. Verify browser Network requests go directly to
Railway and generated tours use persistent Cloudinary URLs. Try a second
generation concurrently and check that busy responses remain readable and
do not crash the API. Check Railway logs, peak RAM, and projected spend.

After that smoke test, prepare the frontend-only Vercel configuration:

```powershell
node scripts/railway-cutover.mjs --backend-url https://YOUR-SERVICE.up.railway.app --frontend-origin https://YOUR-WEBSITE --apply
```

The script repeats the checks, saves the previous Vercel configuration under
gitignored `.local/railway-cutover/`, and removes the backend service and its
ingress rule from `vercel.json`, preserving other settings. Review,
commit, and push the tested migration changes to GitHub `main`, preserving
the user's author identity and unrelated unfinished changes, then deploy
that exact commit. Verify GitHub `main` matches the deployed commit.

Next.js includes an external rewrite for `/api/backend/:path*` so older
browser bundles can still reach Railway through Vercel routing. New bundles
use the direct URL. This compatibility path still uses Vercel networking;
Next.js rendering may also continue to consume some CPU. Railway migration
does not clear Vercel CPU usage already recorded.

The current background-job processing deadline remains 240 seconds and its
stale-job recovery remains unchanged. This migration does not add a durable
worker queue or automatic replay after a container crash. Do not redeploy
during survey captures. Generated hybrid tours persist in Cloudinary;
legacy `/outputs` files are temporary and disappear on container replacement.

## Rollback

Restore the saved Vercel configuration, remove the Production
`NEXT_PUBLIC_PANORAMA_API_URL` override (or restore its previous value), and
commit/push the rollback to `main` before deploying. Keep the old server
secrets until the survey cutover is verified. The Vercel fallback is available
only while its usage quota permits it; it is not protection against an
exhausted Vercel CPU allowance.

References: [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles),
[configuration](https://docs.railway.com/config-as-code/reference),
[health checks](https://docs.railway.com/deployments/healthchecks),
[public networking specifications](https://docs.railway.com/networking/public-networking/specs-and-limits).
