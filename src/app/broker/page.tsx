"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, getDocs, onSnapshot, query, Timestamp, where } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  Home,
  UploadCloud,
  ArrowLeft,
  ArrowRight,
  Plus,
  Calendar,
  Users,
  Images,
} from "lucide-react";
import NotificationCenter from "@/components/NotificationCenter";
import BrokerAccountMenu from "@/components/BrokerAccountMenu";
import SafeImage from "@/components/SafeImage";
import { isRemoteImageUrl } from "@/lib/cloudinary";
import styles from "./dashboard.module.css";
import { DashboardStatSkeleton } from "@/components/Skeleton";

type PropertyRecord = { id: string; title?: string; location?: string; price?: string; image?: string; status?: string; createdAt?: Timestamp | Date };
type TourRecord = { id: string; propertyId?: string; status?: string };
type NegotiationRecord = { id: string; propertyTitle?: string; buyerName?: string; status?: "active" | "accepted" | "rejected"; updatedAt?: Timestamp; createdAt?: Timestamp };
type ViewingSchedule = { id: string; propertyTitle?: string; propertyLocation?: string; buyerName?: string; scheduledAt?: Timestamp; durationMinutes?: number; status?: "pending" | "confirmed" | "completed" | "cancelled" | "rejected" };

const millis = (value?: Timestamp | Date) => value instanceof Date ? value.getTime() : value?.toMillis?.() ?? 0;

export default function BrokerPage() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [galleryCovers, setGalleryCovers] = useState<Map<string, string>>(new Map());
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

  useEffect(() => {
    const ids = properties.filter((property) => !isRemoteImageUrl(property.image)).map((property) => property.id);
    if (!ids.length) return;
    let cancelled = false;
    const chunks = Array.from({ length: Math.ceil(ids.length / 30) }, (_, index) => ids.slice(index * 30, index * 30 + 30));
    void Promise.all(chunks.map((group) => getDocs(query(collection(db, "roomImages"), where("propertyId", "in", group)))))
      .then((snapshots) => {
        if (cancelled) return;
        const covers = new Map<string, string>();
        snapshots.forEach((snapshot) => snapshot.docs.forEach((item) => {
          const room = item.data();
          const cover = Array.isArray(room.imageUrls) ? room.imageUrls.find(isRemoteImageUrl) : undefined;
          if (typeof room.propertyId === "string" && cover && !covers.has(room.propertyId)) covers.set(room.propertyId, cover);
        }));
        setGalleryCovers(covers);
      })
      .catch((error) => console.error("Unable to load broker listing covers:", error));
    return () => { cancelled = true; };
  }, [properties]);

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
    },
    {
      label: "Published Tours",
      value: tours.filter((tour) => (tour.status ?? "published") === "published").length,
      change: `${new Set(tours.map((tour) => tour.propertyId).filter(Boolean)).size} properties covered`,
    },
    {
      label: "Active Negotiations",
      value: negotiations.filter((item) => (item.status ?? "active") === "active").length,
      change: `${negotiations.length} total conversations`,
    },
    {
      label: "Upcoming Viewings",
      value: schedules.filter((item) => item.scheduledAt?.toMillis && item.scheduledAt.toMillis() >= dashboardOpenedAt && ["pending", "confirmed"].includes(item.status ?? "")).length,
      change: `${schedules.filter((item) => item.status === "pending").length} awaiting confirmation`,
    },
  ];

  const recentProperties = useMemo(() => [...properties].sort((a, b) => millis(b.createdAt) - millis(a.createdAt)).slice(0, 5), [properties]);
  const upcomingViewings = useMemo(() => schedules.filter((item) => item.scheduledAt?.toMillis && item.scheduledAt.toMillis() >= dashboardOpenedAt && ["pending", "confirmed"].includes(item.status ?? "")).sort((a, b) => a.scheduledAt!.toMillis() - b.scheduledAt!.toMillis()).slice(0, 3), [dashboardOpenedAt, schedules]);
  const recentInquiries = useMemo(() => [...negotiations].sort((a, b) => millis(b.updatedAt ?? b.createdAt) - millis(a.updatedAt ?? a.createdAt)).slice(0, 3), [negotiations]);

  return (
    <div className="min-h-screen bg-[#fbfaf8]">
      <main>
        <header className="sticky top-0 z-30 border-b border-[#e9e8e3] bg-white/95 backdrop-blur-md">
          <div className="mx-auto flex min-h-20 max-w-[1440px] items-center justify-between gap-4 px-5 sm:px-8">
            <Link href="/broker" className="text-2xl font-bold tracking-tight text-[#076267]">LiBot <span className="ml-1 text-xs font-semibold uppercase tracking-widest text-[#7b8884]">Broker</span></Link>
            <div className="flex items-center gap-2"><NotificationCenter audience="broker" /><BrokerAccountMenu onSignOut={handleSignOut} signingOut={signingOut} /></div>
          </div>
        </header>

        <div className="mx-auto max-w-[1440px] px-5 pb-16 pt-9 sm:px-8">
          {dataError && <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{dataError}</div>}
          <div className={`${styles.intro} mb-8 flex flex-wrap items-end justify-between gap-5`}>
            <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#087d7d]">Broker workspace</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#183c3e] sm:text-4xl">Your listings at a glance.</h1><p className="mt-2 text-sm text-[#71817d]">Manage homes, tours, and buyer activity.</p></div>
            <Link href="/broker/create-property" className="inline-flex h-11 items-center gap-2 rounded-full bg-[#076267] px-5 text-sm font-semibold text-white transition hover:bg-[#034b50]"><Plus size={17} />Add property</Link>
          </div>
          <div className={`${styles.stats} mb-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4`}>
            {loading ? [1, 2, 3, 4].map((item) => <DashboardStatSkeleton key={item} />) : stats.map((stat) => <div key={stat.label} className="rounded-2xl border border-[#e9e8e3] bg-white p-5 shadow-sm"><p className="text-xs font-medium text-[#75817e]">{stat.label}</p><p className="mt-2 text-3xl font-semibold text-[#183c3e]">{stat.value}</p><p className="mt-1 text-xs text-[#75817e]">{stat.change}</p></div>)}
          </div>
          <section className={`${styles.railSection} mb-10`}>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-2xl font-semibold text-[#183c3e]">Recent properties</h2><p className="mt-1 text-sm text-[#75817e]">Your newest listings and their tour status.</p></div><div className="flex items-center gap-2"><Link href="/broker/properties" className="mr-3 text-sm font-semibold text-[#076267]">View all →</Link><button type="button" aria-label="Scroll properties left" onClick={() => document.getElementById("broker-property-rail")?.scrollBy({ left: -640, behavior: "smooth" })} className={styles.railArrow}><ArrowLeft size={17} /></button><button type="button" aria-label="Scroll properties right" onClick={() => document.getElementById("broker-property-rail")?.scrollBy({ left: 640, behavior: "smooth" })} className={styles.railArrow}><ArrowRight size={17} /></button></div></div>
            {recentProperties.length ? <div id="broker-property-rail" className={styles.rail}>{recentProperties.map((property) => <Link key={property.id} href={`/broker/properties/${property.id}/edit`} className={styles.propertyCard}><div className={styles.propertyImage}>{(isRemoteImageUrl(property.image) || galleryCovers.has(property.id)) ? <SafeImage src={isRemoteImageUrl(property.image) ? property.image : galleryCovers.get(property.id)!} alt={property.title || "Property"} fill sizes="(max-width: 640px) 70vw, 270px" className="object-cover" /> : <div className="flex h-full items-center justify-center bg-[#e8efed] text-[#92aba7]"><Home size={40} /></div>}<span className={styles.statusBadge}>{property.status === "archived" ? "Archived" : "Active"}</span></div><h3 className="mt-2 truncate text-sm font-semibold">{property.title || "Untitled property"}</h3><p className="mt-0.5 truncate text-xs text-[#75817e]">{property.location || "Location not specified"}</p><p className="mt-1 text-xs font-semibold">₱{property.price ? Number(property.price).toLocaleString("en-PH") : "Contact"} · {tours.filter((tour) => tour.propertyId === property.id && (tour.status ?? "published") === "published").length} tours</p></Link>)}</div> : !loading && <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-10 text-center text-sm text-stone-500">No properties yet. <Link href="/broker/create-property" className="font-semibold text-[#076267]">Add your first listing</Link></div>}
          </section>
          <div className="mb-10 grid gap-3 sm:grid-cols-2"><Link href="/broker/create-tour" className={styles.quickLink}><UploadCloud size={25} /><span><strong>Create virtual tour</strong><small>Give buyers a closer look</small></span><ArrowRight size={17} /></Link><Link href="/broker/virtual-tours" className={styles.quickLink}><Images size={25} /><span><strong>Manage tours</strong><small>Review room panoramas</small></span><ArrowRight size={17} /></Link></div>

          {/* Calendar Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-8">
              <div className="flex items-center gap-3 mb-6">
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
