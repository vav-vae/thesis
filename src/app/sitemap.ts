import type { MetadataRoute } from "next";

const siteUrl = "https://libot-weld.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${siteUrl}/login`,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/register`,
      changeFrequency: "monthly",
      priority: 0.7,
    },
  ];
}
