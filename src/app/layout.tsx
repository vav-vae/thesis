import "./globals.css";
import { ReactNode } from "react";

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
        {children}
      </body>
    </html>
  );
}