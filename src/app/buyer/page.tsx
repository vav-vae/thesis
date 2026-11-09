"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Home,
  CalendarDays,
  ArrowUpRight,
  Search,
  X,
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
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const searchRef = useRef<HTMLDivElement>(null);
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
        const [active, legacy, tours] = await Promise.all([
          getDocs(query(collection(db, "properties"), where("status", "==", "active"))),
          getDocs(query(collection(db, "properties"), where("status", "==", null))),
          getDocs(query(collection(db, "roomTours"), where("status", "==", "published"))),
        ]);
        const listings = [...new Map([...active.docs, ...legacy.docs].map((item) => [item.id, item])).values()]
          .map((item) => ({ id: item.id, ...item.data() } as FeaturedProperty));
        const chunks = Array.from({ length: Math.ceil(listings.length / 30) }, (_, index) => listings.slice(index * 30, index * 30 + 30).map((item) => item.id));
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
          setTourPropertyIds(new Set(tours.docs.filter((item) => item.data().panoramaUrl).map((item) => String(item.data().propertyId))));
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

  useEffect(() => {
    if (!searchExpanded) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !searchRef.current?.contains(event.target)) setSearchExpanded(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setSearchExpanded(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [searchExpanded]);

  const openSearch = () => {
    const params = new URLSearchParams();
    if (searchTerm.trim()) params.set("q", searchTerm.trim());
    if (propertyType) params.set("type", propertyType);
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
    <div className="min-h-screen bg-[#fbfaf8] text-[#183c3e]">
      <header className="sticky top-0 z-30 border-b border-[#ebe8e2] bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-[76px] max-w-[1440px] items-center justify-between gap-4 px-5 sm:px-8">
          <Link href="/buyer" className="text-2xl font-bold tracking-tight text-[#076267]">LiBot</Link>
          <div className="flex items-center gap-2"><NotificationCenter audience="buyer" /><BuyerAccountMenu onSignOut={handleSignOut} signingOut={signingOut} photo={profilePicture} /></div>
        </div>
        <div ref={searchRef} className={`${styles.searchWrap} ${searchExpanded ? styles.searchExpanded : ""}`}>
          <div className={styles.searchBar}>
            <button type="button" onClick={() => setSearchExpanded(true)} className={styles.searchField}><span className={styles.searchLabel}>Where</span><span className={styles.searchValue}>{searchTerm || "Search Iloilo homes"}</span></button>
            <span className={styles.searchDivider} />
            <button type="button" onClick={() => setSearchExpanded(true)} className={styles.searchField}><span className={styles.searchLabel}>Type</span><span className={styles.searchValue}>{propertyType || "Any property"}</span></button>
            <button type="button" onClick={openSearch} aria-label="Search properties" className={styles.searchButton}><Search size={19} /><span className={styles.searchButtonText}>Search</span></button>
          </div>
          {searchExpanded && <div className={styles.searchPanel}>
            <label className="text-xs font-semibold uppercase tracking-wider text-[#6d7a79]" htmlFor="dashboard-search">Location or property</label>
            <input id="dashboard-search" autoFocus value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") openSearch(); }} placeholder="Try Jaro, Iloilo" className="mt-2 h-12 w-full rounded-xl border border-stone-200 px-4 text-sm outline-none focus:border-[#076267]" />
            <div className="mt-4 flex flex-wrap gap-2">{["", "House", "Condo", "Apartment", "Lot"].map((type) => <button key={type} type="button" onClick={() => setPropertyType(type)} className={`rounded-full border px-4 py-2 text-sm ${propertyType === type ? "border-[#076267] bg-[#e7f2ef] text-[#076267]" : "border-stone-200 text-stone-600"}`}>{type || "Any type"}</button>)}</div>
            <div className="mt-5 flex justify-between"><button type="button" onClick={() => setSearchExpanded(false)} className="flex items-center gap-1 text-sm text-stone-500"><X size={16} /> Close</button><button type="button" onClick={openSearch} className="rounded-xl bg-[#076267] px-5 py-2.5 text-sm font-semibold text-white">Show properties</button></div>
          </div>}
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 pb-16 pt-9 sm:px-8">
        <div className={`${styles.intro} mb-9`}><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#087d7d]">Your home search</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Find a place worth exploring, {buyerName}.</h1><p className="mt-2 text-sm text-[#637270]">Discover homes around Iloilo and step inside with a virtual tour.</p></div>
        <PropertyRail title="Homes you can tour" description="Take a closer look before you visit." properties={tourHomes} loading={listingsLoading} tourPropertyIds={tourPropertyIds} empty="Virtual tours are coming soon." />
        <div className={`${styles.quickLinks} my-10 grid gap-3 md:grid-cols-3`}>
          <Link href="/buyer/properties" className={styles.quickLink}><Search size={26} /><span><strong>Explore all homes</strong><small>Browse available properties</small></span><ArrowUpRight size={18} /></Link>
          <Link href="/buyer/favorites" className={styles.quickLink}><HeartIcon /><span><strong>Your favorites</strong><small>{favoriteIds.length} saved {favoriteIds.length === 1 ? "home" : "homes"}</small></span><ArrowUpRight size={18} /></Link>
          <Link href="/buyer/calendar" className={styles.quickLink}><CalendarDays size={26} /><span><strong>Upcoming viewings</strong><small>{upcomingViewings.length} scheduled</small></span><ArrowUpRight size={18} /></Link>
        </div>
        <PropertyRail title="Explore Iloilo" description="Local homes, ready for your next chapter." properties={iloiloHomes.length ? iloiloHomes : featuredProperties} loading={listingsLoading} tourPropertyIds={tourPropertyIds} empty="No homes available right now." />
        {(recentLoading || recentProperties.length > 0) && <PropertyRail title="Recently viewed" description="Pick up where you left off." properties={recentProperties} loading={recentLoading} tourPropertyIds={tourPropertyIds} empty="" />}
        {upcomingViewings.length > 0 && <section className="mt-12"><div className="mb-5 flex items-center justify-between"><h2 className="text-2xl font-semibold">Upcoming viewings</h2><Link href="/buyer/calendar" className="text-sm font-semibold text-[#076267]">View calendar →</Link></div><div className="grid gap-3 md:grid-cols-3">{upcomingViewings.map((item) => <Link key={item.id} href="/buyer/calendar" className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"><p className="font-semibold">{item.propertyTitle || "Property viewing"}</p><p className="mt-2 text-sm text-stone-500">{item.scheduledAt!.toDate().toLocaleDateString("en-PH", { month: "short", day: "numeric" })} · {item.scheduledAt!.toDate().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</p></Link>)}</div></section>}
      </main>
    </div>
  );
}

function HeartIcon() { return <span aria-hidden="true" className="text-2xl leading-none">♡</span>; }

function PropertyRail({ title, description, properties, loading, tourPropertyIds, empty }: { title: string; description: string; properties: FeaturedProperty[]; loading: boolean; tourPropertyIds: Set<string>; empty: string }) {
  const railRef = useRef<HTMLDivElement>(null);
  const scroll = (direction: number) => railRef.current?.scrollBy({ left: direction * 640, behavior: "smooth" });
  return <section className={styles.railSection}>
    <div className="mb-4 flex items-end justify-between gap-4"><div><h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2><p className="mt-1 text-sm text-[#75817e]">{description}</p></div><div className="hidden gap-2 sm:flex"><button type="button" onClick={() => scroll(-1)} aria-label={`Scroll ${title} left`} className={styles.railArrow}><ArrowLeft size={17} /></button><button type="button" onClick={() => scroll(1)} aria-label={`Scroll ${title} right`} className={styles.railArrow}><ArrowRight size={17} /></button></div></div>
    {loading ? <div className={styles.rail}>{[1, 2, 3, 4, 5].map((item) => <div key={item} className={`${styles.propertyCard} h-64 animate-pulse rounded-2xl bg-stone-200`} />)}</div> : properties.length ? <div ref={railRef} className={styles.rail}>{properties.map((property) => <Link key={property.id} href={`/buyer/properties/${property.id}`} className={styles.propertyCard}><div className={styles.propertyImage}>{property.image ? <SafeImage src={property.image} alt={property.title || "Property"} fill sizes="(max-width: 640px) 70vw, 260px" className="object-cover" /> : <div className="flex h-full items-center justify-center bg-[#e8efed] text-[#92aba7]"><Home size={40} /></div>}{tourPropertyIds.has(property.id) && <span className={styles.tourBadge}>360° Tour</span>}</div><p className="mt-2 truncate text-sm font-semibold">{property.title || "Home in Iloilo"}</p><p className="mt-0.5 truncate text-xs text-[#75817e]">{property.location || "Iloilo, Philippines"}</p><p className="mt-1 text-xs"><strong>₱{property.price ? Number(property.price).toLocaleString("en-PH") : "Contact broker"}</strong>{property.beds ? ` · ${property.beds} beds` : ""}</p></Link>)}</div> : <div className="rounded-2xl border border-dashed border-stone-200 bg-white px-6 py-10 text-sm text-stone-500">{empty}</div>}
  </section>;
}
