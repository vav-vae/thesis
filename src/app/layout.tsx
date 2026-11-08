import "./globals.css";
import { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import AccountStatusGuard from "@/components/AccountStatusGuard";
import ThemeController from "@/components/ThemeController";
import PwaRegister from "@/components/PwaRegister";
import SiteFooter from "@/components/SiteFooter";

export const metadata: Metadata = {
  metadataBase: new URL("https://libot-weld.vercel.app"),
  title: {
    default: "LiBot | Real Estate Listings, Virtual Tours & Viewing Management",
    template: "%s | LiBot",
  },
  description: "Explore real estate listings, arrange property viewings, and manage virtual tours and buyer negotiations with LiBot.",
  applicationName: "LiBot",
  category: "real estate",
  keywords: ["real estate Philippines", "property listings", "virtual property tours", "property viewing schedules", "real estate negotiations"],
  openGraph: {
    type: "website",
    locale: "en_PH",
    siteName: "LiBot",
    title: "LiBot | Real Estate Listings, Virtual Tours & Viewing Management",
    description: "Explore real estate listings, arrange property viewings, and manage virtual tours and buyer negotiations with LiBot.",
    url: "https://libot-weld.vercel.app",
  },
  twitter: {
    card: "summary",
    title: "LiBot | Real Estate Listings, Virtual Tours & Viewing Management",
    description: "Explore real estate listings, arrange property viewings, and manage virtual tours and buyer negotiations with LiBot.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
  },
  manifest: "/manifest.webmanifest",
  icons: { icon: "/LiBot_Logo.svg", shortcut: "/LiBot_Logo.svg" },
  appleWebApp: { capable: true, title: "LiBot", statusBarStyle: "default" as const },
};

export const viewport: Viewport = { themeColor: "#06323B" };

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <AccountStatusGuard />
        {children}
        <SiteFooter />
        <ThemeController />
        <PwaRegister />
      </body>
    </html>
  );
}
