"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collection, documentId, getDocs, query, where } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { ChevronRight, Heart, Home, LogOut, MapPin, Menu, MessageSquare, Search, Settings, UserRound, X } from "lucide-react";
import NotificationCenter from "@/components/NotificationCenter";
import SafeImage from "@/components/SafeImage";
import AppLogo from "@/components/AppLogo";
import { useBuyerFavorites } from "@/hooks/useBuyerFavorites";
import { auth, db } from "@/lib/firebase";
import { isRemoteImageUrl } from "@/lib/cloudinary";

type Property = {
  id: string;
  title?: string;
  price?: string | number;
  location?: string;
  image?: string;
  status?: string;
};

export default function BuyerFavoritesPage() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertiesLoading, setPropertiesLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const { favoriteIds, loading: favoritesLoading, error, toggleFavorite, isUpdating } = useBuyerFavorites();

  useEffect(() => {
    let cancelled = false;
    async function loadFavoriteProperties() {
      if (favoritesLoading) return;
      if (!favoriteIds.length) {
        setProperties([]);
        setPropertiesLoading(false);
        return;
      }
      setPropertiesLoading(true);
      try {
        const chunks = Array.from({ length: Math.ceil(favoriteIds.length / 30) }, (_, index) => favoriteIds.slice(index * 30, index * 30 + 30));
        const snapshots = await Promise.all(chunks.map((ids) => getDocs(query(collection(db, "properties"), where(documentId(), "in", ids)))));
        const propertyList = snapshots.flatMap((snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Property)));
        const imageLookup = new Map<string, string>();
        const roomChunks = Array.from({ length: Math.ceil(propertyList.length / 30) }, (_, index) => propertyList.slice(index * 30, index * 30 + 30).map((property) => property.id));
        const roomSnapshots = await Promise.all(roomChunks.map((ids) => getDocs(query(collection(db, "roomImages"), where("propertyId", "in", ids)))))
          .catch((roomImageError) => {
            console.error("Unable to load favorite gallery covers:", roomImageError);
            return [];
          });
        roomSnapshots.forEach((snapshot) => {
          snapshot.docs.forEach((item) => {
            const room = item.data();
            const cover = Array.isArray(room.imageUrls) ? room.imageUrls.find(isRemoteImageUrl) : undefined;
            const propertyId = typeof room.propertyId === "string" ? room.propertyId : "";
            if (propertyId && cover && !imageLookup.has(propertyId)) imageLookup.set(propertyId, cover);
          });
        });
        if (!cancelled) setProperties(propertyList.map((property) => ({
          ...property,
          image: isRemoteImageUrl(property.image) ? property.image : imageLookup.get(property.id),
        })));
      } catch (snapshotError) {
        console.error("Unable to load favorite properties:", snapshotError);
      } finally {
        if (!cancelled) setPropertiesLoading(false);
      }
    }
    void loadFavoriteProperties();
    return () => { cancelled = true; };
  }, [favoriteIds, favoritesLoading]);

  const favoriteProperties = useMemo(() => {
    const query = search.trim().toLowerCase();
    return properties.filter((property) => favoriteIds.includes(property.id) && (
      !query || `${property.title ?? ""} ${property.location ?? ""}`.toLowerCase().includes(query)
    ));
  }, [favoriteIds, properties, search]);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut(auth);
      router.replace("/login");
    } catch (signOutError) {
      console.error("Unable to sign out:", signOutError);
      setSigningOut(false);
    }
  };

  const loading = propertiesLoading || favoritesLoading;

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    {sidebarOpen && <button aria-label="Close navigation" onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" />}
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex items-center gap-3 border-b border-slate-200 p-8"><div className="relative h-10 w-10"><AppLogo className="h-10 w-10 object-contain" /></div><div><p className="text-sm font-semibold">LiBot</p><p className="text-xs text-slate-500">Real Estate</p></div><button aria-label="Close menu" onClick={() => setSidebarOpen(false)} className="ml-auto lg:hidden"><X size={20} /></button></div>
      <nav className="flex-1 space-y-2 p-6">
        <NavLink href="/buyer" icon={Home} label="Dashboard" />
        <NavLink href="/buyer/properties" icon={Search} label="Browse Properties" />
        <div className="flex items-center gap-3 rounded-xl bg-slate-100 px-4 py-3 font-medium"><Heart size={20} className="fill-red-500 text-red-500" /><span>Favorites</span><span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs text-slate-600">{favoriteIds.length}</span></div>
        <NavLink href="/buyer/profile" icon={UserRound} label="Profile" />
        <NavLink href="/buyer/negotiations" icon={MessageSquare} label="Negotiations" />
      </nav>
      <div className="space-y-2 border-t border-slate-200 p-6"><NavLink href="/buyer/settings" icon={Settings} label="Settings" /><button onClick={handleSignOut} disabled={signingOut} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"><LogOut size={20} />{signingOut ? "Signing Out..." : "Sign Out"}</button></div>
    </aside>

    <main className="lg:ml-64">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white"><div className="flex min-h-20 items-center gap-4 px-4 py-4 sm:px-6"><button aria-label="Open navigation" onClick={() => setSidebarOpen(true)} className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 hover:text-blue-600 lg:hidden"><Menu size={23} /></button><div><h1 className="text-2xl font-light">Favorite Properties</h1><p className="hidden text-sm text-slate-500 sm:block">Keep your shortlist in one place.</p></div><div className="ml-auto"><NotificationCenter audience="buyer" /></div></div></header>
      <div className="p-6 lg:p-10">
        {error && <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-red-500">Your shortlist</p><h2 className="mt-2 text-3xl font-light">Properties worth another look.</h2><p className="mt-2 text-sm text-slate-500">{favoriteIds.length} saved {favoriteIds.length === 1 ? "property" : "properties"}</p></div>{favoriteIds.length > 0 && <label className="relative block"><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search favorites..." className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm outline-none focus:border-slate-400 sm:w-72" /></label>}</div>

        {loading ? <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="h-80 animate-pulse rounded-2xl border border-slate-200 bg-white"><div className="h-44 bg-slate-200" /></div>)}</div>
          : favoriteProperties.length > 0 ? <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">{favoriteProperties.map((property) => <article key={property.id} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
            <div className="relative flex h-48 items-center justify-center bg-slate-100">{property.image ? <SafeImage src={property.image} alt={property.title || "Property"} fill sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw" className="object-cover" /> : <Home size={42} className="text-slate-300" />}<button aria-label="Remove from favorites" disabled={isUpdating(property.id)} onClick={() => void toggleFavorite(property.id)} className="absolute right-3 top-3 rounded-full bg-white p-2.5 shadow-md transition hover:scale-105 disabled:opacity-60"><Heart size={19} className="fill-red-500 text-red-500" /></button></div>
            <div className="p-5"><h3 className="line-clamp-2 text-lg font-semibold">{property.title || "Unnamed property"}</h3><p className="mt-2 flex items-start gap-2 text-sm text-slate-500"><MapPin size={15} className="mt-0.5 shrink-0" />{property.location || "Location not specified"}</p><div className="mt-6 flex items-center justify-between"><div><p className="text-xs text-slate-400">Starting price</p><p className="mt-1 text-xl font-semibold">₱{property.price || "Contact"}</p></div><Link href={`/buyer/properties/${property.id}`} aria-label={`View ${property.title || "property"}`} className="rounded-xl bg-blue-600 p-3 text-white hover:bg-blue-700"><ChevronRight size={19} /></Link></div></div>
          </article>)}</div>
          : <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50"><Heart size={30} className="text-red-400" /></div><h3 className="mt-5 text-xl font-semibold">{search ? "No matching favorites" : "Your favorites list is empty"}</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{search ? "Try a different property name or location." : "Tap the heart on a property to save it here for easy comparison later."}</p><Link href="/buyer/properties" className="mt-6 inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white"><Search size={16} />Browse properties</Link></div>}
      </div>
    </main>
  </div>;
}

function NavLink({ href, icon: Icon, label }: { href: string; icon: typeof Home; label: string }) {
  return <Link href={href} className="flex items-center gap-3 rounded-xl px-4 py-3 font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"><Icon size={20} /><span>{label}</span></Link>;
}
