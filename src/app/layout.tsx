import "./globals.css";
import "leaflet/dist/leaflet.css";
import { ReactNode } from "react";
import AccountStatusGuard from "@/components/AccountStatusGuard";

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
    <html lang="en">
      <body className="bg-[#111111] text-white antialiased">
        <AccountStatusGuard />
        {children}
      </body>
    </html>
  );
}
