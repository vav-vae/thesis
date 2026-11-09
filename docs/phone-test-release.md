# Phone-test release — 17 September 2026

Live site: https://libot-weld.vercel.app

Production deployment: `dpl_5otjHfWbJoLFeiah8shtddTQBwzF`.

Photo uploads go directly to Cloudinary; validation and reconstruction receive small JSON requests containing source URLs. Plain-text upload-limit and gateway responses now produce readable errors instead of JSON parser exceptions. Firebase signing certificates are decoded before verifying API tokens. Panorama reconstruction uses spherical camera alignment. The interactive viewer is contained within the mobile screen, and the install manifest permits landscape orientation.

Verification completed:

- Production Next.js build and ESLint passed.
- 45 backend tests and 5 HTTP-response regression tests passed.
- 12 Firebase emulator tests passed; approved Firestore rules and indexes deployed.
- Seven existing full-resolution photos reconstructed locally into a 4096×2048 panorama.
- Generated synthetic images exercised deployed upload, quality checks, reconstruction, preview, Firestore publication, and buyer property playback.
- The final live domain served the new login screen and healthy OpenCV backend. The live tour rendered a WebGL canvas at a 390-pixel viewport with no horizontal overflow or reported browser errors.

Push notifications remain disabled by the user's release decision. Physical phone camera permissions and device-specific behavior still need an on-device test. Missing ceiling/floor coverage and reconstruction seams remain subject to the preview's disclosure and visual review.

Only synthetic fixtures were uploaded during automated verification. Non-sensitive synthetic Cloudinary assets remain because the unsigned preset did not provide deletion tokens. Runtime-log retrieval failed with a network error; direct API and browser checks succeeded.
