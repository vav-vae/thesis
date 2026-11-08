import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { robots: { index: false, follow: false, googleBot: { index: false, follow: false } } };

export default function BuyerLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
