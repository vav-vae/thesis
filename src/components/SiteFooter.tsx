"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MapPin } from "lucide-react";
import AppLogo from "@/components/AppLogo";
import { isPublicBuyerListing } from "@/lib/role-access";

export default function SiteFooter() {
  const pathname = usePathname();
  if (pathname !== "/" && !isPublicBuyerListing(pathname)) return null;

  return (
    <footer className="bg-[#062f35] text-white">
      <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 lg:py-16">
        <div className="grid gap-10 border-b border-white/15 pb-10 md:grid-cols-[minmax(0,1.6fr)_1fr_1fr]">
          <div>
            <Link href="/" className="inline-flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white"><AppLogo className="h-9 w-9" /></span>
              <span className="text-xl font-semibold tracking-tight">LiBot</span>
            </Link>
            <p className="mt-5 flex items-center gap-2 text-sm text-white/60"><MapPin size={16} />Iloilo, Philippines</p>
          </div>
          <nav aria-label="Explore" className="flex flex-col items-start gap-3 text-sm">
            <h2 className="mb-1 font-semibold text-white">Explore</h2>
            <Link href="/buyer/properties" className="text-white/80 transition-colors hover:text-white">Browse properties</Link>
            <Link href="/buyer/properties?tour=1" className="text-white/80 transition-colors hover:text-white">Virtual tours</Link>
          </nav>
          <nav aria-label="Account" className="flex flex-col items-start gap-3 text-sm">
            <h2 className="mb-1 font-semibold text-white">Account</h2>
            <Link href="/login" className="text-white/80 transition-colors hover:text-white">Sign in</Link>
            <Link href="/register/choose" className="text-white/80 transition-colors hover:text-white">Create an account</Link>
          </nav>
        </div>
        <div className="flex flex-col gap-4 pt-6 text-xs text-white/55 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} LiBot. All rights reserved.</span>
          <Link href="/install" className="font-semibold text-white/80 transition-colors hover:text-white">Install LiBot</Link>
        </div>
      </div>
    </footer>
  );
}
