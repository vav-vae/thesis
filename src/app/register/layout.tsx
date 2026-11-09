import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Create a LiBot account to explore property listings or manage real estate viewings and virtual tours.",
  alternates: { canonical: "/register" },
};

export default function RegisterLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
