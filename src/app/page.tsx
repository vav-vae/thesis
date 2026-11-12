"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collection, getDocs, query, where } from "firebase/firestore";
import { ArrowRight, PlayCircle, Search } from "lucide-react";
import { db } from "@/lib/firebase";
import { isRemoteImageUrl } from "@/lib/cloudinary";
import SafeImage from "@/components/SafeImage";
import AppLogo from "@/components/AppLogo";
import { isPublishedTour } from "@/lib/published-tour";
import { loadTourSummaries } from "@/lib/tour-summaries";
import { isBrowsableProperty } from "@/lib/property-visibility";

type Featured = { id: string; title?: string; location?: string; price?: string; image?: string };

export default function HomePage() {
  const router = useRouter();
  const [location, setLocation] = useState("");
  const [type, setType] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [featured, setFeatured] = useState<Featured[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [tours, properties] = await Promise.all([
          loadTourSummaries(String(db.app.options.projectId)),
          getDocs(collection(db, "properties")),
        ]);
        const ids = new Set(tours.filter(isPublishedTour).map((item) => String(item.propertyId)));
        const listings = properties.docs.filter((item) => isBrowsableProperty(item.data()) && ids.has(item.id)).slice(0, 3).map((item) => ({ id: item.id, ...item.data() } as Featured));
        const covers = await Promise.all(listings.map(async (item) => {
          if (isRemoteImageUrl(item.image)) return item;
          try {
            const rooms = await getDocs(query(collection(db, "roomImages"), where("propertyId", "==", item.id)));
            const image = rooms.docs.flatMap((room) => room.data().imageUrls ?? []).find(isRemoteImageUrl);
            return { ...item, image };
          } catch {
            return item;
          }
        }));
        if (!cancelled) setFeatured(covers);
      } catch (error) {
        console.error("Unable to load featured tours:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const search = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (location.trim()) params.set("location", location.trim());
    if (type) params.set("type", type);
    if (maxPrice) params.set("maxPrice", maxPrice);
    router.push(`/buyer/properties${params.size ? `?${params}` : ""}`);
  };

  return <main className="min-h-screen bg-[#faf8f3]">
    <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8"><AppLogo /><div className="flex items-center gap-3"><Link href="/login" className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-700">Sign in</Link><Link href="/register/choose" className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">Get started</Link></div></header>
    <section className="mx-auto max-w-7xl px-4 sm:px-8"><div className="grid overflow-hidden rounded-[2rem] bg-[#f2eee5] lg:min-h-[34rem] lg:grid-cols-2"><div className="flex flex-col justify-center p-6 sm:p-10 lg:p-12"><p className="mb-3 text-sm font-semibold uppercase tracking-[.16em] text-[#07585b]">Homes in Iloilo</p><h1 className="max-w-xl text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">Find a place worth exploring.</h1><p className="mt-4 max-w-lg text-slate-600">See the space before you visit.</p><form onSubmit={search} className="mt-8 grid gap-3 rounded-2xl bg-white p-4 shadow-sm sm:grid-cols-2"><label className="text-xs font-semibold text-slate-500">Location<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="City or neighborhood" className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900" /></label><label className="text-xs font-semibold text-slate-500">Property type<select value={type} onChange={(event) => setType(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900"><option value="">Any type</option><option value="Condominium">Condominium</option><option value="House and Lot">House and Lot</option><option value="Lot">Lot</option></select></label><label className="text-xs font-semibold text-slate-500">Price range<select value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900"><option value="">Any price</option><option value="3000000">Up to ₱3M</option><option value="5000000">Up to ₱5M</option><option value="10000000">Up to ₱10M</option></select></label><button className="flex min-h-11 items-center justify-center gap-2 self-end rounded-lg bg-[#07585b] px-6 text-sm font-semibold text-white transition duration-150 hover:bg-[#06494b]"><Search size={17} />Search homes</button></form></div><div className="relative min-h-[20rem] bg-slate-200 lg:min-h-full"><SafeImage src={isRemoteImageUrl(featured[0]?.image) ? featured[0].image : "/background.png"} alt={featured[0]?.title || "Property exterior"} fill priority sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" />{featured[0] && <div className="absolute inset-x-5 bottom-5 rounded-xl bg-white/95 p-4 text-sm shadow-lg"><p className="font-semibold text-slate-900">{featured[0].title || "Property"}</p><p className="mt-1 text-slate-600">{featured[0].location || "Iloilo"} · {featured[0].price ? `₱${featured[0].price}` : "Contact for price"}</p></div>}</div></div></section>
    <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8"><div className="mb-6 flex items-end justify-between gap-4"><h2 className="text-2xl font-semibold text-slate-900 sm:text-3xl">Homes You Can Tour</h2><Link href="/buyer/properties?tour=1" className="flex items-center gap-1 text-sm font-semibold text-blue-700">View all <ArrowRight size={16} /></Link></div>{loading ? <div className="grid gap-5 md:grid-cols-3">{[1, 2, 3].map((n) => <div key={n} className="h-72 animate-pulse rounded-2xl bg-slate-200" />)}</div> : featured.length ? <div className="grid gap-5 md:grid-cols-3">{featured.map((property) => <Link key={property.id} href={`/buyer/properties/${property.id}`} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white transition-shadow duration-150 hover:shadow-lg"><div className="relative h-52 bg-slate-200">{isRemoteImageUrl(property.image) && <SafeImage src={property.image} alt={property.title || "Property"} fill sizes="(min-width: 768px) 33vw, 100vw" className="object-cover transition-transform duration-150 group-hover:scale-[1.03] motion-reduce:transform-none" />}<span className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-900"><PlayCircle size={14} />360° Tour</span></div><div className="p-5"><p className="text-lg font-semibold text-slate-900">{property.title || "Property"}</p><p className="mt-1 text-sm text-slate-500">{property.location || "Location not specified"}</p><p className="mt-3 font-semibold text-blue-700">{property.price ? `₱${property.price}` : "Contact for price"}</p></div></Link>)}</div> : <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-600">No virtual tours are available yet. <Link href="/buyer/properties" className="font-semibold text-blue-700">Browse all properties</Link></div>}</section>
  </main>;
}
