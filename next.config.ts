import type { NextConfig } from "next";
import { backendUrl } from "./src/lib/backend-url.ts";

const isProduction = process.env.NODE_ENV === "production";
const panoramaApiUrl = backendUrl(process.env.NEXT_PUBLIC_PANORAMA_API_URL, isProduction);
const backendOrigins = panoramaApiUrl.startsWith("/") ? [] : [new URL(panoramaApiUrl).origin];
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"} https://www.googletagmanager.com`,
  "style-src 'self' 'unsafe-inline'",
  [
    "img-src 'self' blob: data:",
    ...backendOrigins,
    "https://images.unsplash.com",
    "https://res.cloudinary.com",
    "https://firebasestorage.googleapis.com",
    "https://storage.googleapis.com",
    "https://lh3.googleusercontent.com",
    "https://*.googleusercontent.com",
    "https://*.tile.openstreetmap.org",
  ].join(" "),
  "font-src 'self' data:",
  [
    "connect-src 'self'",
    ...backendOrigins,
    ...(isProduction
      ? []
      : [
          "http://127.0.0.1:8000",
          "http://localhost:8000",
          "ws://localhost:3000",
          "ws://127.0.0.1:3000",
        ]),
    "https://*.googleapis.com",
    "https://*.firebaseio.com",
    "wss://*.firebaseio.com",
    "https://api.cloudinary.com",
    "https://res.cloudinary.com",
    "https://nominatim.openstreetmap.org",
    "https://www.google-analytics.com",
    "https://*.google-analytics.com",
  ].join(" "),
  "media-src 'self' blob: https://res.cloudinary.com",
  "worker-src 'self' blob:",
  "frame-src 'self' https://*.firebaseapp.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isProduction ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  ...(isProduction
    ? [{
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      }]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    // Keep old browser bundles using /api/backend working after the cutover.
    // This is a routing proxy, not a Next.js function running the Python work.
    return backendOrigins.length ? [{
      source: "/api/backend/:path*",
      destination: `${panoramaApiUrl}/:path*`,
    }] : [];
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Content-Type", value: "application/manifest+json" }],
      },
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
      },
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
};

export default nextConfig;
