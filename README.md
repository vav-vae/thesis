This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

The panorama service requires Firebase bearer tokens and applies upload,
rate-limit, and concurrency controls. See [docs/security.md](docs/security.md)
for local configuration and required production WAF, Cloudinary, and Firestore
controls.

Tour generation uses persisted background jobs. After photos finish uploading,
the broker receives a job ID and the browser polls short status requests. The
latest draft is remembered on the same device for the signed-in broker; returning
to Create Tour restores progress or the completed preview, including its source
photos and room details. Publishing still requires the broker's review.

Deploy `firestore.rules` when enabling this feature. The backend uses the broker's
Firebase token in memory to access private `tourJobs` snapshots, signed with
`PANORAMA_JOB_SECRET` (or the existing server-only `CLOUDINARY_API_SECRET`). Tokens
are never saved in jobs. Keep the signing secret stable while jobs are retained.
Background work shares the existing 300-second Vercel invocation limit; jobs that
lose their worker expire after 330 seconds and offer Retry saved photos instead
of waiting indefinitely. This provides recovery from phone disconnections, not
automatic recovery from a killed compute worker. Server job events also appear
in Admin → Virtual Tour Logs while the phone is disconnected.

Each room job accepts up to 64 source photos. Remote sources are resized during
loading to share the existing 100-million-pixel working budget, with a maximum
long edge of 1600 pixels. Every photo is retained; original source-dimension,
download-size, ownership, and decoding safety checks still apply.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
