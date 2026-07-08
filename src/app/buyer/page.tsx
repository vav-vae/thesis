"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  LogOut,
  Home,
  Heart,
  Settings,
  Menu,
  X,
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

type RecentProperty = {
  id: string;
  title?: string;
  location?: string;
  price?: string;
  image?: string;
  viewedAt?: Timestamp;
};

type ViewingSchedule = { id: string; propertyId?: string; propertyTitle?: string; propertyLocation?: string; brokerName?: string; scheduledAt?: Timestamp; durationMinutes?: number; status?: "pending" | "confirmed" | "completed" | "cancelled" | "rejected" };

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
        const [userDoc, inquirySnapshot, roomImagesSnapshot] = await Promise.all([
          getDoc(doc(db, "users", currentUser.uid)),
          getDocs(query(collection(db, "negotiations"), where("buyerId", "==", currentUser.uid))),
          getDocs(collection(db, "roomImages")),
        ]);
        const galleryCovers = new Map<string, string>();
        roomImagesSnapshot.docs
          .sort((first, second) => {
            const firstCreated = first.data().createdAt;
            const secondCreated = second.data().createdAt;
            const firstTime = typeof firstCreated?.toMillis === "function" ? firstCreated.toMillis() : new Date(firstCreated ?? 0).getTime();
            const secondTime = typeof secondCreated?.toMillis === "function" ? secondCreated.toMillis() : new Date(secondCreated ?? 0).getTime();
            return firstTime - secondTime;
          })
          .forEach((item) => {
            const room = item.data();
            const firstImage = Array.isArray(room.imageUrls) ? room.imageUrls[0] : undefined;
            if (room.propertyId && firstImage && !galleryCovers.has(String(room.propertyId))) galleryCovers.set(String(room.propertyId), String(firstImage));
          });
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
        const resolved = await Promise.all(storedViews.map(async (view: { propertyId: string; viewedAt?: Timestamp }) => {
          const propertySnapshot = await getDoc(doc(db, "properties", view.propertyId));
          if (!propertySnapshot.exists()) return null;
          const property = propertySnapshot.data();
          return { id: propertySnapshot.id, ...property, image: property.image || galleryCovers.get(propertySnapshot.id), viewedAt: view.viewedAt } as RecentProperty;
        }));
        setRecentProperties(resolved.filter((item): item is RecentProperty => item !== null));
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
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-slate-200 transition-transform duration-300 lg:translate-x-0 ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      }`}>
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="p-8 border-b border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 relative flex-shrink-0">
                <Image
                  src="/logo.png"
                  alt="LiBot Logo"
                  fill
                  className="object-contain"
                />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">LiBot</p>
                <p className="text-xs text-slate-500">Real Estate</p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-6 space-y-2">
            <Link
              href="/buyer"
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all font-medium"
            >
              <Home size={20} />
              <span>Dashboard</span>
            </Link>

            <Link
              href="/buyer/properties"
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all font-medium"
            >
              <Search size={20} />
              <span>Browse Properties</span>
            </Link>

            <Link
              href="/buyer/profile"
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all font-medium"
            >
              <UserRound size={20} />
              <span>Profile</span>
            </Link>

            <Link
              href="/buyer/favorites"
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all font-medium"
            >
              <Heart size={20} />
              <span>Favorites</span>
            </Link>

            <Link
              href="/buyer/negotiations"
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all font-medium"
            >
              <MessageSquare size={20} />
              <span>Negotiations</span>
            </Link>

            <Link
              href="/buyer/calendar"
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all font-medium"
            >
              <CalendarDays size={20} />
              <span>Viewing Calendar</span>
            </Link>
          </nav>

          {/* Settings & Logout */}
          <div className="p-6 space-y-2 border-t border-slate-200">
            <Link
              href="/buyer/settings"
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all font-medium"
            >
              <Settings size={20} />
              <span>Settings</span>
            </Link>

            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-600 hover:bg-red-50 transition-all font-medium disabled:cursor-not-allowed disabled:opacity-60"
            >
              <LogOut size={20} />
              <span>{signingOut ? "Signing Out..." : "Sign Out"}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="lg:ml-64">
        {/* Top Navigation */}
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
          <div className="flex min-h-20 items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="rounded-lg p-2 text-slate-700 transition-colors hover:bg-slate-100 hover:text-blue-600 lg:hidden"
              >
                {sidebarOpen ? (
                  <X size={24} />
                ) : (
                  <Menu size={24} />
                )}
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
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 bg-cover bg-center text-white shadow-sm"
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
          {/* Welcome Section */}
          <div className="mb-12">
            <h2 className="text-4xl font-light text-slate-900 mb-2">
              Welcome back, {buyerName}
            </h2>
            <p className="text-slate-600">
              Explore and manage your favorite properties
            </p>
          </div>

          {/* Stats Grid */}
          <div className="mb-12 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-600 text-sm font-medium mb-2">Properties Viewed</p>
                  <p className="text-3xl font-light text-slate-900">{recentProperties.length}</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                  <Eye size={24} className="text-blue-600" />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-600 text-sm font-medium mb-2">Favorites</p>
                  <p className="text-3xl font-light text-slate-900">{favoriteIds.length}</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center">
                  <Heart size={24} className="text-red-600" fill="currentColor" />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-600 text-sm font-medium mb-2">Inquiries</p>
                  <p className="text-3xl font-light text-slate-900">{inquiryCount}</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center">
                  <MessageSquare size={24} className="text-green-600" />
                </div>
              </div>
            </div>

            <Link href="/buyer/calendar" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"><div className="flex items-center justify-between"><div><p className="mb-2 text-sm font-medium text-slate-600">Upcoming Viewings</p><p className="text-3xl font-light text-slate-900">{upcomingViewings.length}</p></div><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100"><CalendarDays size={24} className="text-emerald-600" /></div></div></Link>
          </div>

          <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8"><div className="mb-6 flex items-center justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Your appointments</p><h3 className="mt-2 text-2xl font-light text-slate-900">Upcoming property viewings</h3></div><Link href="/buyer/calendar" className="shrink-0 text-sm font-semibold text-blue-600">View calendar →</Link></div>{upcomingViewings.length ? <div className="grid gap-3 lg:grid-cols-3">{upcomingViewings.map((item) => { const date = item.scheduledAt!.toDate(); return <Link key={item.id} href="/buyer/calendar" className="rounded-2xl border border-slate-200 p-4 transition hover:border-blue-200 hover:bg-blue-50/30"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-900">{item.propertyTitle || "Property viewing"}</p><p className="mt-1 text-xs text-slate-500">with {item.brokerName || "Property broker"}</p></div><span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase ${item.status === "confirmed" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{item.status}</span></div><div className="mt-4 space-y-2 text-xs text-slate-500"><p className="flex items-center gap-2"><CalendarDays size={14} />{date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</p><p className="flex items-center gap-2"><Clock3 size={14} />{date.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })} · {item.durationMinutes ?? 60} minutes</p>{item.propertyLocation && <p className="flex items-center gap-2"><MapPin size={14} /><span className="truncate">{item.propertyLocation}</span></p>}</div></Link>; })}</div> : <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center"><CalendarDays className="mx-auto text-slate-300" size={32} /><p className="mt-3 text-sm font-medium text-slate-600">No upcoming viewings</p><Link href="/buyer/properties" className="mt-3 inline-flex text-sm font-semibold text-blue-600">Browse properties to request one</Link></div>}</section>

          {/* Recently Viewed Properties */}
          <div className="bg-white rounded-2xl border border-slate-200 p-8">
            <h3 className="text-2xl font-light text-slate-900 mb-6">Recently Viewed</h3>

            {recentLoading ? <div className="space-y-4">{[1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />)}</div> : recentProperties.length > 0 ? <div className="space-y-4">
              {recentProperties.map((property) => (
                <Link
                  key={property.id}
                  href={`/buyer/properties/${property.id}`}
                  className="group flex items-center gap-4 p-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all"
                >
                  <div role={property.image ? "img" : undefined} aria-label={property.image ? `${property.title || "Property"} cover` : undefined} style={property.image ? { backgroundImage: `url(${property.image})` } : undefined} className="flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-50 to-slate-200 bg-cover bg-center text-slate-400">{!property.image && <Home size={28} />}</div>
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
