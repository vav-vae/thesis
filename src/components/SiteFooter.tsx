"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, MapPin } from "lucide-react";
import AppLogo from "@/components/AppLogo";

export default function SiteFooter() {
  const pathname = usePathname();
  if (pathname !== "/" && !pathname.startsWith("/buyer") && !pathname.startsWith("/broker")) return null;
  const isBroker = pathname.startsWith("/broker");
  const isBuyer = pathname.startsWith("/buyer");

  return (
    <footer className="bg-[#062f35] text-white">
      <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 lg:py-16">
        <div className="grid gap-10 border-b border-white/15 pb-10 md:grid-cols-[minmax(0,1.6fr)_1fr_1fr]">
          <div>
            <Link href="/" className="inline-flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white"><AppLogo className="h-9 w-9" /></span>
              <span className="text-xl font-semibold tracking-tight">LiBot</span>
            </Link>
            <p className="mt-5 max-w-sm text-sm leading-6 text-white/70">{isBroker ? "Manage your properties, virtual tours, and buyer inquiries in one place." : "Find a place worth exploring. Browse properties and step inside with virtual tours."}</p>
            <p className="mt-5 flex items-center gap-2 text-sm text-white/60"><MapPin size={16} />Iloilo, Philippines</p>
          </div>
          <nav aria-label={isBroker ? "Broker tools" : "Explore"} className="flex flex-col items-start gap-3 text-sm">
            <h2 className="mb-1 font-semibold text-white">{isBroker ? "Broker tools" : "Explore"}</h2>
            {isBroker ? <><Link href="/broker/properties" className="text-white/70 transition-colors hover:text-white">My properties</Link><Link href="/broker/virtual-tours" className="text-white/70 transition-colors hover:text-white">Manage tours</Link></> : <><Link href="/buyer/properties" className="text-white/70 transition-colors hover:text-white">Browse properties</Link><Link href="/buyer/properties?tour=1" className="text-white/70 transition-colors hover:text-white">Homes with tours</Link></>}
          </nav>
          <nav aria-label="Account" className="flex flex-col items-start gap-3 text-sm">
            <h2 className="mb-1 font-semibold text-white">Account</h2>
            {isBroker ? <><Link href="/broker/profile" className="text-white/70 transition-colors hover:text-white">Profile</Link><Link href="/broker/settings" className="text-white/70 transition-colors hover:text-white">Settings</Link></> : isBuyer ? <><Link href="/buyer/profile" className="text-white/70 transition-colors hover:text-white">Profile</Link><Link href="/buyer/settings" className="text-white/70 transition-colors hover:text-white">Settings</Link></> : <><Link href="/login" className="text-white/70 transition-colors hover:text-white">Sign in</Link><Link href="/register/choose" className="text-white/70 transition-colors hover:text-white">Get started</Link></>}
          </nav>
        </div>
        <div className="flex flex-col gap-4 pt-6 text-xs text-white/55 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} LiBot. All rights reserved.</span>
          <Link href={isBroker ? "/broker/create-property" : "/buyer/properties"} className="inline-flex items-center gap-1 font-semibold text-white/80 transition-colors hover:text-white">{isBroker ? "Add a property" : "Explore listings"} <ArrowUpRight size={15} /></Link>
        </div>
      </div>
    </footer>
  );
}
