import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/login", "/register"],
      disallow: ["/admin", "/buyer", "/broker", "/offline"],
    },
    sitemap: "https://libot-weld.vercel.app/sitemap.xml",
    host: "https://libot-weld.vercel.app",
  };
}
