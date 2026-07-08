import "./globals.css";
import "leaflet/dist/leaflet.css";
import { ReactNode } from "react";
import AccountStatusGuard from "@/components/AccountStatusGuard";
import ThemeController from "@/components/ThemeController";

export const metadata = {
  title: "LiBot - AI-Powered Virtual Tours",
  description: "Explore properties through immersive AI-powered virtual tours",
};

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
      </body>
    </html>
  );
}
