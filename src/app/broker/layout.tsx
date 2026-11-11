import type { Metadata } from "next";
import type { ReactNode } from "react";
import RoleGuard from "@/components/RoleGuard";

export const metadata: Metadata = { robots: { index: false, follow: false, googleBot: { index: false, follow: false } } };

export default function BrokerLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <RoleGuard role="broker">{children}</RoleGuard>;
}
