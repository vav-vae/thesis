"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, type LucideIcon } from "lucide-react";
import AppLogo from "@/components/AppLogo";

export type DashboardNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  items: DashboardNavItem[];
  footer?: React.ReactNode;
};

export default function DashboardSidebar({ open, onClose, items, footer }: Props) {
  const pathname = usePathname();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[2px] lg:hidden"
        />
      )}
      <aside
        aria-label="Primary navigation"
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(17rem,calc(100vw-2rem))] flex-col border-r border-slate-200 bg-white shadow-2xl transition-transform duration-300 lg:z-40 lg:w-64 lg:translate-x-0 lg:shadow-none ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex min-h-24 items-center justify-between px-6">
          <Link href={items[0]?.href ?? "/"} onClick={onClose} className="flex items-center gap-3 rounded-xl">
            <AppLogo className="h-10 w-10 object-contain" />
            <div>
              <p className="text-xl font-semibold tracking-tight text-slate-900">LiBot</p>
            </div>
          </Link>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
          >
            <X size={21} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-6">
          {items.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-md border-l-2 px-4 py-3 text-sm ${
                  active
                    ? "border-slate-700 bg-slate-100 font-semibold text-slate-900"
                    : "border-transparent font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <Icon size={17} strokeWidth={1.5} aria-hidden="true" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        {footer && <div className="border-t border-slate-200 p-4">{footer}</div>}
      </aside>
    </>
  );
}
