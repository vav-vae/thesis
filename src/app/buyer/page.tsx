"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LogOut,
  Home,
  Heart,
  Settings,
  Menu,
  Search,
  ChevronDown,
  ChevronRight,
  UserRound,
  Eye,
  MessageSquare,
  CalendarDays,
  Clock3,
  MapPin,
} from "lucide-react";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, onSnapshot, query, Timestamp, where } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { isRemoteImageUrl } from "@/lib/cloudinary";
import NotificationCenter from "@/components/NotificationCenter";
import { useBuyerFavorites } from "@/hooks/useBuyerFavorites";
import SafeImage from "@/components/SafeImage";
import DashboardSidebar, { type DashboardNavItem } from "@/components/DashboardSidebar";
import Skeleton from "@/components/Skeleton";

type RecentProperty = {
  id: string;
  title?: string;
  location?: string;
  price?: string;
  image?: string;
  viewedAt?: Timestamp;
};

type ViewingSchedule = { id: string; propertyId?: string; propertyTitle?: string; propertyLocation?: string; brokerName?: string; scheduledAt?: Timestamp; durationMinutes?: number; status?: "pending" | "confirmed" | "completed" | "cancelled" | "rejected" };

const buyerNavigation: DashboardNavItem[] = [
  { href: "/buyer", label: "Dashboard", icon: Home, exact: true },
  { href: "/buyer/properties", label: "Browse Properties", icon: Search },
  { href: "/buyer/favorites", label: "Favorites", icon: Heart },
  { href: "/buyer/negotiations", label: "Negotiations", icon: MessageSquare },
  { href: "/buyer/calendar", label: "Viewing Calendar", icon: CalendarDays },
  { href: "/buyer/profile", label: "Profile", icon: UserRound },
  { href: "/buyer/settings", label: "Settings", icon: Settings },
];

function viewedTime(value?: Timestamp) {
  if (!value?.toDate) return "Recently";
  const date = value.toDate();
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : date.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

export default function BuyerDashboard() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [buyerName, setBuyerName] = useState("Buyer");
  const [profilePicture, setProfilePicture] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [recentProperties, setRecentProperties] = useState<RecentProperty[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [inquiryCount, setInquiryCount] = useState(0);
  const [schedules, setSchedules] = useState<ViewingSchedule[]>([]);
  const [dashboardOpenedAt] = useState(() => Date.now());
  const { favoriteIds } = useBuyerFavorites();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser: User | null) => {
      if (!currentUser) {
        setBuyerName("Buyer");
        setProfilePicture(null);
        setRecentProperties([]);
        setInquiryCount(0);
        setRecentLoading(false);
        return;
      }

      try {
        const [userDoc, inquirySnapshot] = await Promise.all([
          getDoc(doc(db, "users", currentUser.uid)),
          getDocs(query(collection(db, "negotiations"), where("buyerId", "==", currentUser.uid))),
        ]);
        setInquiryCount(inquirySnapshot.size);
        const data = userDoc.data();
        const firstName = data?.firstName?.trim()
          || data?.name?.trim().split(/\s+/)[0]
          || currentUser.displayName?.trim().split(/\s+/)[0]
          || "Buyer";
        setBuyerName(firstName);
        setProfilePicture(isRemoteImageUrl(data?.profilePicture) ? data.profilePicture : null);
        const storedViews = Array.isArray(data?.recentViews)
          ? data.recentViews.filter((item: unknown): item is { propertyId: string; viewedAt?: Timestamp } => Boolean(item && typeof item === "object" && "propertyId" in item && typeof (item as { propertyId?: unknown }).propertyId === "string")).slice(0, 5)
          : [];
        const recentPropertyIds = storedViews.map((view) => view.propertyId);
        const [resolved, roomImagesSnapshot] = await Promise.all([
          Promise.all(storedViews.map(async (view: { propertyId: string; viewedAt?: Timestamp }) => {
          const propertySnapshot = await getDoc(doc(db, "properties", view.propertyId));
          if (!propertySnapshot.exists()) return null;
          const property = propertySnapshot.data();
          return { id: propertySnapshot.id, ...property, image: property.image, viewedAt: view.viewedAt } as RecentProperty;
          })),
          recentPropertyIds.length
            ? getDocs(query(collection(db, "roomImages"), where("propertyId", "in", recentPropertyIds)))
            : Promise.resolve(null),
        ]);
        const galleryCovers = new Map<string, string>();
        roomImagesSnapshot?.docs.forEach((item) => {
          const room = item.data();
          const firstImage = Array.isArray(room.imageUrls) ? room.imageUrls.find(isRemoteImageUrl) : undefined;
          if (room.propertyId && firstImage && !galleryCovers.has(String(room.propertyId))) {
            galleryCovers.set(String(room.propertyId), firstImage);
          }
        });
        setRecentProperties(resolved.filter((item): item is RecentProperty => item !== null).map((property) => ({
          ...property,
          image: isRemoteImageUrl(property.image) ? property.image : galleryCovers.get(property.id),
        })));
      } catch (error) {
        console.log(error);
        setBuyerName(currentUser.displayName?.trim().split(/\s+/)[0] || "Buyer");
        setProfilePicture(null);
        setRecentProperties([]);
        setInquiryCount(0);
      } finally {
        setRecentLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let stopSchedules = () => {};
    const stopAuth = onAuthStateChanged(auth, (user) => {
      stopSchedules();
      if (!user) { setSchedules([]); return; }
      stopSchedules = onSnapshot(query(collection(db, "viewingSchedules"), where("buyerId", "==", user.uid)), (snapshot) => {
        setSchedules(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as ViewingSchedule)));
      }, (scheduleError) => console.error("Unable to load buyer schedules:", scheduleError));
    });
    return () => { stopSchedules(); stopAuth(); };
  }, []);

  const upcomingViewings = schedules
    .filter((item) => item.scheduledAt?.toMillis && item.scheduledAt.toMillis() >= dashboardOpenedAt && ["pending", "confirmed"].includes(item.status ?? ""))
    .sort((first, second) => first.scheduledAt!.toMillis() - second.scheduledAt!.toMillis())
    .slice(0, 3);

  const handleSignOut = async () => {
    if (signingOut) return;

    setSigningOut(true);

    try {
      await signOut(auth);
      setUserMenuOpen(false);
      router.replace("/login");
    } catch (error) {
      console.error("Unable to sign out:", error);
      setSigningOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <DashboardSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        items={buyerNavigation}
        footer={<button type="button" onClick={handleSignOut} disabled={signingOut} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"><LogOut size={19} /><span>{signingOut ? "Signing out…" : "Sign out"}</span></button>}
      />

      {/* Main Content */}
      <main className="lg:ml-64">
        {/* Top Navigation */}
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
          <div className="flex min-h-20 items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                aria-label="Open navigation"
                aria-expanded={sidebarOpen}
                className="rounded-lg p-2 text-slate-700 transition-colors hover:bg-slate-100 hover:text-blue-600 lg:hidden"
              >
                <Menu size={24} />
              </button>
              <h1 className="text-2xl font-light text-slate-900">Dashboard</h1>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <NotificationCenter audience="buyer" />

              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  aria-label="Open profile menu"
                  aria-expanded={userMenuOpen}
                  className="flex h-11 items-center gap-3 rounded-xl border border-transparent px-2 text-left transition-all hover:border-slate-200 hover:bg-slate-50 sm:pr-3"
                >
                  <div
                    role={profilePicture ? "img" : undefined}
                    aria-label={profilePicture ? `${buyerName}'s profile picture` : undefined}
                    style={profilePicture ? { backgroundImage: `url(${profilePicture})` } : undefined}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 bg-cover bg-center text-white shadow-sm"
                  >
                    {!profilePicture && <UserRound size={18} aria-hidden="true" />}
                  </div>
                  <span className="hidden max-w-32 truncate text-sm font-medium text-slate-700 sm:block">
                    {buyerName}
                  </span>
                  <ChevronDown
                    size={16}
                    className={`text-slate-400 transition-transform ${userMenuOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                    <Link
                      href="/buyer/profile"
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                    >
                      <UserRound size={17} />
                      View Profile
                    </Link>
                    <button
                      type="button"
                      onClick={handleSignOut}
                      disabled={signingOut}
                      className="mt-1 flex w-full items-center gap-3 rounded-lg border-t border-slate-100 px-3 py-2.5 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <LogOut size={17} />
                      {signingOut ? "Signing Out..." : "Sign Out"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="p-6 lg:p-10">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <h2 className="text-3xl font-medium tracking-tight text-slate-900">Your property search</h2>
            <Link href="/buyer/properties" className="rounded-md bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-800">Browse properties</Link>
          </div>
          <div className="summary-strip mb-10">
            <div><p className="summary-label">Properties viewed</p><p className="summary-value">{recentProperties.length}</p></div>
            <Link href="/buyer/favorites"><p className="summary-label">Favorites</p><p className="summary-value">{favoriteIds.length}</p></Link>
            <Link href="/buyer/negotiations"><p className="summary-label">Inquiries</p><p className="summary-value">{inquiryCount}</p></Link>
            <Link href="/buyer/calendar"><p className="summary-label">Upcoming viewings</p><p className="summary-value">{upcomingViewings.length}</p></Link>
          </div>

          <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8"><div className="mb-6 flex items-center justify-between gap-4"><div><h3 className="text-xl font-medium text-slate-900">Upcoming viewings</h3></div><Link href="/buyer/calendar" className="shrink-0 text-sm font-semibold text-blue-600">View calendar →</Link></div>{upcomingViewings.length ? <div className="grid gap-3 lg:grid-cols-3">{upcomingViewings.map((item) => { const date = item.scheduledAt!.toDate(); return <Link key={item.id} href="/buyer/calendar" className="rounded-2xl border border-slate-200 p-4 transition hover:border-blue-200 hover:bg-blue-50/30"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-900">{item.propertyTitle || "Property viewing"}</p><p className="mt-1 text-xs text-slate-500">with {item.brokerName || "Property broker"}</p></div><span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase ${item.status === "confirmed" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{item.status}</span></div><div className="mt-4 space-y-2 text-xs text-slate-500"><p className="flex items-center gap-2"><CalendarDays size={14} />{date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</p><p className="flex items-center gap-2"><Clock3 size={14} />{date.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })} · {item.durationMinutes ?? 60} minutes</p>{item.propertyLocation && <p className="flex items-center gap-2"><MapPin size={14} /><span className="truncate">{item.propertyLocation}</span></p>}</div></Link>; })}</div> : <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center"><p className="mt-3 text-sm font-medium text-slate-600">No upcoming viewings</p><Link href="/buyer/properties" className="mt-3 inline-flex text-sm font-semibold text-blue-600">Browse properties</Link></div>}</section>

          {/* Recently Viewed Properties */}
          <div className="bg-white rounded-2xl border border-slate-200 p-8">
            <h3 className="text-xl font-medium text-slate-900 mb-6">Recently viewed</h3>

            {recentLoading ? <div className="space-y-4" aria-label="Loading recently viewed properties">{[1, 2, 3].map((item) => <div key={item} className="rounded-xl border border-slate-200 p-4"><Skeleton className="h-20 w-full" /></div>)}</div> : recentProperties.length > 0 ? <div className="space-y-4">
              {recentProperties.map((property) => (
                <Link
                  key={property.id}
                  href={`/buyer/properties/${property.id}`}
                  className="group flex items-center gap-4 p-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all"
                >
                  <div className="relative flex h-24 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-blue-50 to-slate-200 text-slate-400">{property.image ? <SafeImage src={property.image} alt={`${property.title || "Property"} cover`} fill sizes="96px" className="object-cover" /> : <Home size={28} />}</div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-slate-900 mb-1 group-hover:text-blue-600 transition-colors">
                      {property.title || "Untitled property"}
                    </h4>
                    <p className="text-sm text-slate-600 mb-2">{property.location || "Location not specified"}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><p className="text-lg font-semibold text-slate-900">₱{property.price ? Number(property.price).toLocaleString("en-PH") : "Contact broker"}</p><span className="text-xs text-slate-400">Viewed {viewedTime(property.viewedAt)}</span></div>
                  </div>
                  <ChevronRight size={20} className="text-slate-400 group-hover:translate-x-1 transition-transform" />
                </Link>
              ))}
            </div> : <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center"><Eye className="mx-auto text-slate-300" size={32} /><h4 className="mt-4 font-semibold text-slate-700">No recently viewed properties</h4><p className="mt-2 text-sm text-slate-500">Properties you open will appear here automatically.</p><Link href="/buyer/properties" className="mt-5 inline-flex rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white">Browse properties</Link></div>}
          </div>
        </div>
      </main>
    </div>
  );
}
