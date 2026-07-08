"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, onSnapshot, query, Timestamp, where } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  Home,
  UploadCloud,
  Settings,
  LogOut,
  Menu,
  X,
  Plus,
  Eye,
  Calendar,
  Users,
  FileText,
  UserRound,
  MessageSquare,
  Images,
} from "lucide-react";
import NotificationCenter from "@/components/NotificationCenter";

type PropertyRecord = { id: string; title?: string; location?: string; price?: string; status?: string; createdAt?: Timestamp | Date };
type TourRecord = { id: string; propertyId?: string; status?: string };
type NegotiationRecord = { id: string; propertyTitle?: string; buyerName?: string; status?: "active" | "accepted" | "rejected"; updatedAt?: Timestamp; createdAt?: Timestamp };
type ViewingSchedule = { id: string; propertyTitle?: string; propertyLocation?: string; buyerName?: string; scheduledAt?: Timestamp; durationMinutes?: number; status?: "pending" | "confirmed" | "completed" | "cancelled" | "rejected" };

const millis = (value?: Timestamp | Date) => value instanceof Date ? value.getTime() : value?.toMillis?.() ?? 0;

export default function BrokerPage() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [tours, setTours] = useState<TourRecord[]>([]);
  const [negotiations, setNegotiations] = useState<NegotiationRecord[]>([]);
  const [schedules, setSchedules] = useState<ViewingSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [dashboardOpenedAt] = useState(() => Date.now());

  useEffect(() => {
    let stopProperties = () => {};
    let stopTours = () => {};
    let stopNegotiations = () => {};
    let stopSchedules = () => {};
    const stopAuth = onAuthStateChanged(auth, (user) => {
      stopProperties(); stopTours(); stopNegotiations(); stopSchedules();
      if (!user) { setLoading(false); return; }
      const fail = (error: Error) => { console.error("Unable to load broker dashboard:", error); setDataError("Some dashboard data could not be loaded."); setLoading(false); };
      stopProperties = onSnapshot(query(collection(db, "properties"), where("brokerId", "==", user.uid)), (snapshot) => {
        setProperties(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as PropertyRecord)));
        setLoading(false);
      }, fail);
      stopTours = onSnapshot(query(collection(db, "roomTours"), where("brokerId", "==", user.uid)), (snapshot) => setTours(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as TourRecord))), fail);
      stopNegotiations = onSnapshot(query(collection(db, "negotiations"), where("brokerId", "==", user.uid)), (snapshot) => setNegotiations(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as NegotiationRecord))), fail);
      stopSchedules = onSnapshot(query(collection(db, "viewingSchedules"), where("brokerId", "==", user.uid)), (snapshot) => setSchedules(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as ViewingSchedule))), fail);
    });
    return () => { stopProperties(); stopTours(); stopNegotiations(); stopSchedules(); stopAuth(); };
  }, []);

  const handleSignOut = async () => {
    if (signingOut) return;

    setSigningOut(true);

    try {
      await signOut(auth);
      router.replace("/login");
    } catch (error) {
      console.error("Unable to sign out:", error);
      setSigningOut(false);
    }
  };

  const stats = [
    {
      label: "Total Properties",
      value: properties.length,
      change: `${properties.filter((property) => property.status !== "archived").length} active listings`,
      icon: Home,
      color: "bg-blue-100 text-blue-600",
    },
    {
      label: "Published Tours",
      value: tours.filter((tour) => (tour.status ?? "published") === "published").length,
      change: `${new Set(tours.map((tour) => tour.propertyId).filter(Boolean)).size} properties covered`,
      icon: Images,
      color: "bg-green-100 text-green-600",
    },
    {
      label: "Active Negotiations",
      value: negotiations.filter((item) => (item.status ?? "active") === "active").length,
      change: `${negotiations.length} total conversations`,
      icon: MessageSquare,
      color: "bg-amber-100 text-amber-600",
    },
    {
      label: "Upcoming Viewings",
      value: schedules.filter((item) => item.scheduledAt?.toMillis && item.scheduledAt.toMillis() >= dashboardOpenedAt && ["pending", "confirmed"].includes(item.status ?? "")).length,
      change: `${schedules.filter((item) => item.status === "pending").length} awaiting confirmation`,
      icon: Calendar,
      color: "bg-emerald-100 text-emerald-600",
    },
  ];

  const recentProperties = useMemo(() => [...properties].sort((a, b) => millis(b.createdAt) - millis(a.createdAt)).slice(0, 5), [properties]);
  const upcomingViewings = useMemo(() => schedules.filter((item) => item.scheduledAt?.toMillis && item.scheduledAt.toMillis() >= dashboardOpenedAt && ["pending", "confirmed"].includes(item.status ?? "")).sort((a, b) => a.scheduledAt!.toMillis() - b.scheduledAt!.toMillis()).slice(0, 3), [dashboardOpenedAt, schedules]);
  const recentInquiries = useMemo(() => [...negotiations].sort((a, b) => millis(b.updatedAt ?? b.createdAt) - millis(a.updatedAt ?? a.createdAt)).slice(0, 3), [negotiations]);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-slate-200 transition-transform duration-300 lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="p-8 border-b border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 relative flex-shrink-0">
                <img
                  src="/logo.png"
                  alt="LiBot Logo"
                  className="h-full w-full object-contain"
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
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-100 text-slate-900 font-medium">
              <Home size={20} />
              <span>Dashboard</span>
            </div>

            <Link
              href="/broker/create-tour"
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all font-medium"
            >
              <UploadCloud size={20} />
              <span>Create Virtual Tour</span>
            </Link>

            <Link
              href="/broker/properties"
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all font-medium"
            >
              <FileText size={20} />
              <span>My Properties</span>
            </Link>

            <Link
              href="/broker/virtual-tours"
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all font-medium"
            >
              <Images size={20} />
              <span>Manage Tours</span>
            </Link>

            <Link
              href="/broker/calendar"
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all font-medium"
            >
              <Calendar size={20} />
              <span>Viewing Calendar</span>
            </Link>

            <Link
              href="/broker/profile"
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all font-medium"
            >
              <UserRound size={20} />
              <span>Profile</span>
            </Link>

            <Link
              href="/broker/negotiations"
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all font-medium"
            >
              <MessageSquare size={20} />
              <span>Negotiations</span>
            </Link>
          </nav>

          {/* Settings & Logout */}
          <div className="p-6 space-y-2 border-t border-slate-200">
            <Link
              href="/broker/settings"
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
        {/* Header */}
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
          <div className="flex items-center justify-between p-6">
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
              <div>
                <h1 className="text-2xl font-light text-slate-900">
                  Broker Dashboard
                </h1>
                <p className="text-sm text-slate-500">
                  Welcome back! Here&apos;s your property overview.
                </p>
              </div>
            </div>

            <NotificationCenter audience="broker" />
          </div>
        </header>

        {/* Page Content */}
        <div className="p-6 lg:p-10">
          {dataError && <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{dataError}</div>}
          {/* Quick Action Buttons */}
          <div className="mb-10 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Link
              href="/broker/create-property"
              className="flex items-center gap-3 px-6 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium shadow-lg hover:shadow-xl"
            >
              <Plus size={20} />
              <span>Create New Property</span>
            </Link>

            <Link
              href="/broker/create-tour"
              className="flex items-center gap-3 px-6 py-4 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors font-medium shadow-lg hover:shadow-xl"
            >
              <UploadCloud size={20} />
              <span>Create Virtual Tour</span>
            </Link>
          </div>

          {/* Stats Grid */}
          <div className="mb-10">
            <h2 className="text-xl font-light text-slate-900 mb-6">
              Performance Overview
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {stats.map((stat, index) => {
                const Icon = stat.icon;
                return (
                  <div
                    key={index}
                    className="bg-white rounded-2xl border border-slate-200 p-6 hover:shadow-lg hover:border-slate-300 transition-all"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <p className="text-sm text-slate-600 mb-2">
                          {stat.label}
                        </p>
                        <p className="text-3xl font-light text-slate-900">{loading ? "—" : stat.value}</p>
                      </div>
                      <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${stat.color}`}>
                        <Icon size={24} />
                      </div>
                    </div>
                    <p className="text-xs text-slate-500">{stat.change}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent Properties */}
          <div className="mb-10">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-light text-slate-900">
                Recent Properties
              </h2>
              <Link
                href="/broker/properties"
                className="text-blue-600 hover:text-blue-700 font-medium text-sm"
              >
                View All →
              </Link>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">
                        Property
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">
                        Location
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">
                        Price
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">Tours</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">
                        Status
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {recentProperties.map((property) => (
                      <tr
                        key={property.id}
                        className="hover:bg-slate-50 transition-colors"
                      >
                        <td className="px-6 py-4">
                          <p className="font-medium text-slate-900">
                            {property.title || "Untitled property"}
                          </p>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-slate-600">
                            {property.location || "Location not specified"}
                          </p>
                        </td>
                        <td className="px-6 py-4">
                          <p className="font-semibold text-slate-900">
                            ₱{property.price ? Number(property.price).toLocaleString("en-PH") : "Contact"}
                          </p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1 text-slate-600">
                            <Eye size={16} />
                            {tours.filter((tour) => tour.propertyId === property.id && (tour.status ?? "published") === "published").length}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-semibold ${
                              property.status !== "archived"
                                ? "bg-green-100 text-green-700"
                                : "bg-yellow-100 text-yellow-700"
                            }`}
                          >
                            {property.status === "archived" ? "Archived" : "Active"}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <Link
                            href={`/broker/properties/${property.id}/edit`}
                            className="text-blue-600 hover:text-blue-700 font-medium text-sm"
                          >
                            Edit
                          </Link>
                        </td>
                      </tr>
                    ))}
                    {!loading && recentProperties.length === 0 && <tr><td colSpan={6} className="px-6 py-12 text-center"><Home className="mx-auto text-slate-300" size={30} /><p className="mt-3 text-sm font-medium text-slate-600">No properties yet</p><Link href="/broker/create-property" className="mt-3 inline-flex text-sm font-semibold text-blue-600">Create your first listing</Link></td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Calendar Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Calendar size={20} className="text-blue-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Upcoming Viewings
                </h3>
              </div>
              <div className="space-y-4">
                {upcomingViewings.map((item) => { const date = item.scheduledAt!.toDate(); return <Link key={item.id} href="/broker/calendar" className="flex items-start gap-4 border-b border-slate-200 pb-4 last:border-0"><div className="min-w-10 pt-1 text-center"><p className="text-2xl font-light text-blue-600">{date.getDate()}</p><p className="text-xs text-slate-500">{date.toLocaleDateString("en-PH", { month: "short" })}</p></div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className="truncate font-medium text-slate-900">{item.propertyTitle || "Property viewing"}</p><span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-semibold uppercase ${item.status === "confirmed" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{item.status}</span></div><p className="mt-1 text-sm text-slate-600">{date.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })} · {item.buyerName || "Buyer"}</p>{item.propertyLocation && <p className="mt-1 truncate text-xs text-slate-400">{item.propertyLocation}</p>}</div></Link>; })}
                {!loading && upcomingViewings.length === 0 && <div className="py-6 text-center"><Calendar className="mx-auto text-slate-300" size={28} /><p className="mt-3 text-sm text-slate-500">No upcoming property viewings.</p></div>}
                <Link href="/broker/calendar" className="inline-flex text-xs font-semibold text-blue-600">Open full calendar →</Link>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                  <Users size={20} className="text-purple-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Client Inquiries
                </h3>
              </div>
              <div className="space-y-4">
                {recentInquiries.map((item) => <Link key={item.id} href="/broker/negotiations" className="flex items-center justify-between gap-4 border-b border-slate-200 pb-4 last:border-0"><div className="min-w-0"><p className="truncate font-medium text-slate-900">{item.buyerName || "Buyer"}</p><p className="truncate text-sm text-slate-600">Interested in {item.propertyTitle || "a property"}</p></div><span className={`shrink-0 rounded px-2 py-1 text-xs font-semibold ${item.status === "accepted" ? "bg-emerald-100 text-emerald-700" : item.status === "rejected" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>{item.status === "accepted" ? "Accepted" : item.status === "rejected" ? "Declined" : "Active"}</span></Link>)}
                {!loading && recentInquiries.length === 0 && <div className="py-6 text-center"><Users className="mx-auto text-slate-300" size={28} /><p className="mt-3 text-sm text-slate-500">No buyer inquiries yet.</p></div>}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
