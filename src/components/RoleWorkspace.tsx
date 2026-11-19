"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Compass, Heart, House, Images, LayoutDashboard, MessageSquare, Settings, UserRound, Video } from "lucide-react";
import WorkspaceFrame from "@/components/WorkspaceFrame";
import { isPublicBuyerListing } from "@/lib/role-access";

const workspaces = {
  buyer: {
    label: "Buyer workspace",
    links: [
      { href: "/buyer", label: "Overview", icon: LayoutDashboard },
      { href: "/buyer/properties", label: "Browse properties", icon: Compass },
      { href: "/buyer/favorites", label: "Favorites", icon: Heart },
      { href: "/buyer/calendar", label: "Viewing calendar", icon: CalendarDays },
      { href: "/buyer/negotiations", label: "Negotiations", icon: MessageSquare },
      { href: "/buyer/profile", label: "Profile", icon: UserRound },
      { href: "/buyer/settings", label: "Settings", icon: Settings },
    ],
  },
  broker: {
    label: "Broker workspace",
    links: [
      { href: "/broker", label: "Overview", icon: LayoutDashboard },
      { href: "/broker/properties", label: "My properties", icon: House, related: ["/broker/create-property", "/broker/upload-images"] },
      { href: "/broker/create-tour", label: "Create a tour", icon: Video, related: ["/broker/panorama-test"] },
      { href: "/broker/virtual-tours", label: "Manage tours", icon: Images },
      { href: "/broker/calendar", label: "Viewing calendar", icon: CalendarDays },
      { href: "/broker/negotiations", label: "Negotiations", icon: MessageSquare },
      { href: "/broker/profile", label: "Profile", icon: UserRound },
      { href: "/broker/settings", label: "Settings", icon: Settings },
    ],
  },
};

export default function RoleWorkspace({ role, children }: { role: keyof typeof workspaces; children: ReactNode }) {
  const pathname = usePathname();
  if (role === "buyer" && isPublicBuyerListing(pathname)) return children;

  const { label, links } = workspaces[role];
  const home = `/${role}`;

  return (
    <WorkspaceFrame key={pathname} label={label} home={home} navigation={(close) => links.map(({ href, label, icon: Icon, ...item }) => {
      const exact = pathname === href;
      const active = exact || (href !== home && pathname.startsWith(`${href}/`)) || ("related" in item && item.related?.includes(pathname));
      return (
        <Link key={href} href={href} onClick={close} aria-current={active ? (exact ? "page" : "location") : undefined} className="workspace-link">
          <Icon size={18} aria-hidden="true" /> {label}
        </Link>
      );
    })}>
      {children}
    </WorkspaceFrame>
  );
}
