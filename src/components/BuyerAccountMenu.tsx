"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarDays, Heart, Home, LogOut, Menu, MessageSquare, Search, Settings, UserRound } from "lucide-react";

const links = [
  { href: "/buyer", label: "Dashboard", icon: Home },
  { href: "/buyer/properties", label: "Browse properties", icon: Search },
  { href: "/buyer/favorites", label: "Favorites", icon: Heart },
  { href: "/buyer/negotiations", label: "Negotiations", icon: MessageSquare },
  { href: "/buyer/calendar", label: "Viewing calendar", icon: CalendarDays },
  { href: "/buyer/profile", label: "Profile", icon: UserRound },
];

export default function BuyerAccountMenu({ onSignOut, signingOut = false, photo }: { onSignOut: () => void; signingOut?: boolean; photo?: string | null }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return <div ref={menuRef} className="relative">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-label="Account menu" aria-expanded={open} aria-controls="buyer-account-menu" className="flex h-11 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2.5 text-slate-700 transition-colors hover:bg-slate-100">
      {photo ? <span role="img" aria-label="Profile picture" style={{ backgroundImage: `url(${photo})` }} className="h-7 w-7 rounded-full bg-cover bg-center" /> : <UserRound size={18} />}
      <Menu size={19} />
    </button>
    {open && <nav id="buyer-account-menu" aria-label="Buyer account" className="absolute right-0 top-[calc(100%+0.75rem)] z-50 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
      <div className="border-b border-slate-100 px-3 py-3"><p className="text-sm font-semibold text-slate-900">LiBot account</p><p className="mt-0.5 text-xs text-slate-500">Find your next home</p></div>
      <div className="py-2">{links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Icon size={18} />{label}</Link>)}</div>
      <div className="border-t border-slate-100 pt-2"><Link href="/buyer/settings" onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Settings size={18} />Account settings</Link><button type="button" onClick={onSignOut} disabled={signingOut} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"><LogOut size={18} />{signingOut ? "Signing out…" : "Sign out"}</button></div>
    </nav>}
  </div>;
}
