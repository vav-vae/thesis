"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Home,
  CalendarDays,
  ArrowUpRight,
  Search,
  Heart,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, onSnapshot, query, Timestamp, where } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { isRemoteImageUrl } from "@/lib/cloudinary";
import NotificationCenter from "@/components/NotificationCenter";
import { useBuyerFavorites } from "@/hooks/useBuyerFavorites";
import SafeImage from "@/components/SafeImage";
import BuyerAccountMenu from "@/components/BuyerAccountMenu";
import styles from "./dashboard.module.css";
import { isPublishedTour } from "@/lib/published-tour";
import { loadTourSummaries } from "@/lib/tour-summaries";
import { isBrowsableProperty } from "@/lib/property-visibility";
import { PROPERTY_TYPES } from "@/lib/propertyAmenities";

type RecentProperty = {
  id: string;
  title?: string;
  location?: string;
  price?: string;
  image?: string;
  viewedAt?: Timestamp;
};

type FeaturedProperty = { id: string; title?: string; location?: string; price?: string | number; image?: string; propertyType?: string; beds?: number; baths?: number };

type ViewingSchedule = { id: string; propertyId?: string; propertyTitle?: string; propertyLocation?: string; brokerName?: string; scheduledAt?: Timestamp; durationMinutes?: number; status?: "pending" | "confirmed" | "completed" | "cancelled" | "rejected" };

export default function BuyerDashboard() {
  const router = useRouter();
  const [buyerName, setBuyerName] = useState("Buyer");
  const [profilePicture, setProfilePicture] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [recentProperties, setRecentProperties] = useState<RecentProperty[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [schedules, setSchedules] = useState<ViewingSchedule[]>([]);
  const [dashboardOpenedAt] = useState(() => Date.now());
  const [featuredProperties, setFeaturedProperties] = useState<FeaturedProperty[]>([]);
  const [tourPropertyIds, setTourPropertyIds] = useState<Set<string>>(new Set());
  const [listingsLoading, setListingsLoading] = useState(true);
  const [maxPrice, setMaxPrice] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const { favoriteIds } = useBuyerFavorites();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser: User | null) => {
      if (!currentUser) {
        setBuyerName("Buyer");
        setProfilePicture(null);
        setRecentProperties([]);
        setRecentLoading(false);
        return;
      }

      try {
        const userDoc = await getDoc(doc(db, "users", currentUser.uid));
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

  useEffect(() => {
    let cancelled = false;
    async function loadListings() {
      try {
        const [allProperties, tours] = await Promise.all([
          getDocs(collection(db, "properties")),
          loadTourSummaries(String(db.app.options.projectId)),
        ]);
        const listings = allProperties.docs.filter((item) => isBrowsableProperty(item.data()))
          .map((item) => ({ id: item.id, ...item.data() } as FeaturedProperty));
        const missingCovers = listings.filter((item) => !isRemoteImageUrl(item.image));
        const chunks = Array.from({ length: Math.ceil(missingCovers.length / 30) }, (_, index) => missingCovers.slice(index * 30, index * 30 + 30).map((item) => item.id));
        const covers = new Map<string, string>();
        const roomSnapshots = await Promise.all(chunks.map((ids) => getDocs(query(collection(db, "roomImages"), where("propertyId", "in", ids)))))
          .catch(() => []);
        roomSnapshots.forEach((snapshot) => snapshot.docs.forEach((item) => {
          const data = item.data();
          const cover = Array.isArray(data.imageUrls) ? data.imageUrls.find(isRemoteImageUrl) : undefined;
          if (typeof data.propertyId === "string" && cover && !covers.has(data.propertyId)) covers.set(data.propertyId, cover);
        }));
        if (!cancelled) {
          setFeaturedProperties(listings.map((item) => ({ ...item, image: isRemoteImageUrl(item.image) ? item.image : covers.get(item.id) })));
          setTourPropertyIds(new Set(tours.filter(isPublishedTour).map((item) => String(item.propertyId))));
        }
      } catch (error) {
        console.error("Unable to load dashboard listings:", error);
      } finally {
        if (!cancelled) setListingsLoading(false);
      }
    }
    void loadListings();
    return () => { cancelled = true; };
  }, []);

  const openSearch = () => {
    const params = new URLSearchParams();
    if (searchTerm.trim()) params.set("location", searchTerm.trim());
    if (propertyType) params.set("type", propertyType);
    if (maxPrice) params.set("maxPrice", maxPrice);
    router.push(`/buyer/properties${params.size ? `?${params}` : ""}`);
  };

  const upcomingViewings = schedules
    .filter((item) => item.scheduledAt?.toMillis && item.scheduledAt.toMillis() >= dashboardOpenedAt && ["pending", "confirmed"].includes(item.status ?? ""))
    .sort((first, second) => first.scheduledAt!.toMillis() - second.scheduledAt!.toMillis())
    .slice(0, 3);

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

  const tourHomes = featuredProperties.filter((property) => tourPropertyIds.has(property.id));
  const iloiloHomes = featuredProperties.filter((property) => /iloilo/i.test(property.location ?? ""));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-16 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-8">
          <p className="text-sm font-semibold">Overview</p>
          <div className="flex items-center gap-2"><NotificationCenter audience="buyer" /><BuyerAccountMenu onSignOut={handleSignOut} signingOut={signingOut} photo={profilePicture} /></div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 pb-16 pt-6 sm:px-8 sm:pt-9">
        <section className="workspace-intro mb-9" aria-labelledby="buyer-overview-title">
          <h1 id="buyer-overview-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">Find your next home, {buyerName}.</h1>
          <p className="mt-2 text-slate-600">Search Iloilo properties and step inside with a virtual tour.</p>
          <form className="mt-5 grid max-w-4xl items-end gap-3 min-[520px]:grid-cols-2 lg:grid-cols-[1.25fr_1fr_1fr_auto]" onSubmit={(event) => { event.preventDefault(); openSearch(); }} aria-label="Find a property">
            <label className="grid gap-1.5 text-sm font-medium">Location<input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Try Jaro, Iloilo" className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-base" /></label>
            <label className="grid gap-1.5 text-sm font-medium">Property type<select value={propertyType} onChange={(event) => setPropertyType(event.target.value)} className="ui-select h-12 w-full rounded-xl border border-slate-200 bg-white pl-3 text-base"><option value="">Any type</option>{PROPERTY_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
            <label className="grid gap-1.5 text-sm font-medium">Maximum price<select value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} className="ui-select h-12 w-full rounded-xl border border-slate-200 bg-white pl-3 text-base"><option value="">Any price</option><option value="3000000">Up to ₱3M</option><option value="5000000">Up to ₱5M</option><option value="10000000">Up to ₱10M</option></select></label>
            <button type="submit" className="ui-button ui-button-primary h-12"><Search size={18} aria-hidden="true" /> Search</button>
          </form>
        </section>
        <PropertyRail title="Homes you can tour" description="Take a closer look before you visit." properties={tourHomes} loading={listingsLoading} tourPropertyIds={tourPropertyIds} empty="Virtual tours are coming soon." />
        <div className="my-10 grid gap-3 md:grid-cols-3">
          <Link href="/buyer/properties" className={styles.quickLink}><Search size={26} /><span><strong>Explore all homes</strong><small>Browse available properties</small></span><ArrowUpRight size={18} /></Link>
          <Link href="/buyer/favorites" className={styles.quickLink}><Heart size={25} aria-hidden="true" /><span><strong>Your favorites</strong><small>{favoriteIds.length} saved {favoriteIds.length === 1 ? "home" : "homes"}</small></span><ArrowUpRight size={18} /></Link>
          <Link href="/buyer/calendar" className={styles.quickLink}><CalendarDays size={26} /><span><strong>Upcoming viewings</strong><small>{upcomingViewings.length} scheduled</small></span><ArrowUpRight size={18} /></Link>
        </div>
        <PropertyRail title="Explore Iloilo" description="Local homes, ready for your next chapter." properties={iloiloHomes.length ? iloiloHomes : featuredProperties} loading={listingsLoading} tourPropertyIds={tourPropertyIds} empty="No homes available right now." />
        {(recentLoading || recentProperties.length > 0) && <PropertyRail title="Recently viewed" description="Pick up where you left off." properties={recentProperties} loading={recentLoading} tourPropertyIds={tourPropertyIds} empty="" />}
        {upcomingViewings.length > 0 && <section className="mt-12"><div className="mb-5 flex items-center justify-between"><h2 className="text-2xl font-semibold">Upcoming viewings</h2><Link href="/buyer/calendar" className="text-sm font-semibold text-blue-700">View calendar →</Link></div><div className="grid gap-3 md:grid-cols-3">{upcomingViewings.map((item) => <Link key={item.id} href="/buyer/calendar" className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"><p className="font-semibold">{item.propertyTitle || "Property viewing"}</p><p className="mt-2 text-sm text-stone-500">{item.scheduledAt!.toDate().toLocaleDateString("en-PH", { month: "short", day: "numeric" })} · {item.scheduledAt!.toDate().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</p></Link>)}</div></section>}
      </main>
    </div>
  );
}

function PropertyRail({ title, description, properties, loading, tourPropertyIds, empty }: { title: string; description: string; properties: FeaturedProperty[]; loading: boolean; tourPropertyIds: Set<string>; empty: string }) {
  const railRef = useRef<HTMLDivElement>(null);
  const scroll = (direction: number) => railRef.current?.scrollBy({ left: direction * 640, behavior: "smooth" });
  return <section className={styles.railSection}>
    <div className="mb-4 flex items-end justify-between gap-4"><div><h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div><div className="hidden gap-2 sm:flex"><button type="button" onClick={() => scroll(-1)} aria-label={`Scroll ${title} left`} className={styles.railArrow}><ArrowLeft size={17} /></button><button type="button" onClick={() => scroll(1)} aria-label={`Scroll ${title} right`} className={styles.railArrow}><ArrowRight size={17} /></button></div></div>
    {loading ? <div className={styles.rail}>{[1, 2, 3, 4, 5].map((item) => <div key={item} className={`${styles.propertyCard} h-64 animate-pulse rounded-2xl bg-stone-200`} />)}</div> : properties.length ? <div ref={railRef} className={styles.rail}>{properties.map((property) => <Link key={property.id} href={`/buyer/properties/${property.id}`} className={styles.propertyCard}><div className={styles.propertyImage}>{property.image ? <SafeImage src={property.image} alt={property.title || "Property"} fill sizes="(max-width: 640px) 70vw, 260px" className="object-cover" /> : <div className="flex h-full items-center justify-center bg-[#e8efed] text-[#92aba7]"><Home size={40} /></div>}{tourPropertyIds.has(property.id) && <span className={styles.tourBadge}>360° Tour</span>}</div><p className="mt-2 truncate text-sm font-semibold">{property.title || "Home in Iloilo"}</p><p className="mt-0.5 truncate text-xs text-slate-500">{property.location || "Iloilo, Philippines"}</p><p className="mt-1 text-xs"><strong>₱{property.price ? Number(property.price).toLocaleString("en-PH") : "Contact broker"}</strong>{property.beds ? ` · ${property.beds} beds` : ""}</p></Link>)}</div> : <div className="rounded-2xl border border-dashed border-stone-200 bg-white px-6 py-10 text-sm text-stone-500">{empty}</div>}
  </section>;
}
