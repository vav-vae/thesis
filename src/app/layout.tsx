import "./globals.css";
import { ReactNode } from "react";
import type { Viewport } from "next";
import AccountStatusGuard from "@/components/AccountStatusGuard";
import ThemeController from "@/components/ThemeController";
import PwaRegister from "@/components/PwaRegister";

export const metadata = {
  title: "LiBot | Property Management and Virtual Tours",
  description: "Manage property listings, viewing schedules, negotiations, and virtual tours in one platform.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "LiBot", statusBarStyle: "default" as const },
};

export const viewport: Viewport = { themeColor: "#0f766e" };

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
        <ThemeController />
        <PwaRegister />
      </body>
    </html>
  );
}
