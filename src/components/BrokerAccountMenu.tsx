"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarDays, FileText, Home, Images, LogOut, Menu, MessageSquare, Settings, UploadCloud, UserRound } from "lucide-react";

const links = [
  { href: "/broker", label: "Dashboard", icon: Home },
  { href: "/broker/properties", label: "My properties", icon: FileText },
  { href: "/broker/create-tour", label: "Create virtual tour", icon: UploadCloud },
  { href: "/broker/virtual-tours", label: "Manage tours", icon: Images },
  { href: "/broker/calendar", label: "Viewing calendar", icon: CalendarDays },
  { href: "/broker/negotiations", label: "Negotiations", icon: MessageSquare },
  { href: "/broker/profile", label: "Profile", icon: UserRound },
];

export default function BrokerAccountMenu({ onSignOut, signingOut }: { onSignOut: () => void; signingOut: boolean }) {
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
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [open]);

  return <div ref={menuRef} className="relative">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-label="Account menu" aria-expanded={open} aria-controls="broker-account-menu" className="flex h-11 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2.5 text-slate-700 hover:bg-slate-100"><UserRound size={18} /><Menu size={19} /></button>
    {open && <nav id="broker-account-menu" aria-label="Broker account" className="absolute right-0 top-[calc(100%+0.75rem)] z-50 max-h-[calc(100dvh-6rem)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
      <div className="border-b border-slate-100 px-3 py-3"><p className="text-sm font-semibold">LiBot broker</p><p className="mt-0.5 text-xs text-slate-500">Manage your listings</p></div>
      <div className="py-2">{links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Icon size={18} />{label}</Link>)}</div>
      <div className="border-t border-slate-100 pt-2"><Link href="/broker/settings" onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Settings size={18} />Account settings</Link><button type="button" onClick={onSignOut} disabled={signingOut} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"><LogOut size={18} />{signingOut ? "Signing out…" : "Sign out"}</button></div>
    </nav>}
  </div>;
}
