import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to LiBot to manage property listings, virtual tours, viewing schedules, and real estate negotiations.",
  alternates: { canonical: "/login" },
};

export default function LoginLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
