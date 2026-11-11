# Signed Cloudinary uploads

Browser uploads request `/api/backend/uploads/sign` using a Firebase bearer
token. The API selects the folder, generates a random asset ID and signs a
timestamp, preset, format allowlist and `overwrite=false` using SHA-256.
Clients cannot submit arbitrary parameters to the signer. Panorama sources
retain the hashed owner folder required by reconstruction. Generated tour
images use the same signing helper on the backend. There is no unsigned fallback.

## Configure before deploying

1. In Cloudinary create a **signed** upload preset `libot_signed_uploads`.
   Restrict file size to 15 MB (`15728640` bytes) and formats to
   `jpg,jpeg,png,webp,pdf`. Do not configure a fixed folder/public ID or automatic
   paid add-ons. Keep delivery folder behavior compatible with `folder` in URLs.
2. In Vercel's project environment settings add `CLOUDINARY_API_KEY`,
   `CLOUDINARY_API_SECRET` and `CLOUDINARY_SIGNED_UPLOAD_PRESET` for Production.
   The last value is the preset name; the secret must remain server-only.
   Configure Development separately for local uploads. The cloud name defaults
   to the existing account and must match the public cloud name.
3. Deploy frontend and backend together; verify property photo, registration
   document, panorama source and generated-tour uploads.
4. After the signed deployment passes, disable unsigned uploads on the old
   `libot_uploads` preset (or delete that preset). Removing the name from source
   does not disable its use: old builds and Git history still contain it.

The signature route requires authentication and applies per-user/IP throttling
and a 1 KB request limit. Current rate limiting is process-local, not an
account-wide spending quota. Configure Cloudinary limits and usage alerts too.
Signed uploads control who can upload; they do not make delivery URLs private.
Government ID/document delivery privacy is a separate access-control concern.

Cloudinary signatures are valid for one hour. The signed random public ID and
`overwrite=false` constrain reuse to that asset, but signatures are not a
general one-time credential. Size enforcement must be set in the signed preset;
browser size validation alone cannot prevent a modified client uploading more.

Reference: https://cloudinary.com/documentation/authentication_signatures
