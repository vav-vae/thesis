"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collection, getDocs, query, where } from "firebase/firestore";
import { House, MapPin, PlayCircle, Search } from "lucide-react";
import { db } from "@/lib/firebase";
import { isRemoteImageUrl } from "@/lib/cloudinary";
import SafeImage from "@/components/SafeImage";
import AppLogo from "@/components/AppLogo";
import Skeleton from "@/components/Skeleton";
import { ThemeToggle } from "@/components/ThemeController";
import { isPublishedTour } from "@/lib/published-tour";
import { loadTourSummaries } from "@/lib/tour-summaries";
import { isBrowsableProperty } from "@/lib/property-visibility";
import { PROPERTY_TYPES } from "@/lib/propertyAmenities";
import styles from "./home.module.css";

type Featured = { id: string; title?: string; location?: string; price?: string; image?: string };

export default function HomePage() {
  const router = useRouter();
  const [location, setLocation] = useState("");
  const [type, setType] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [featured, setFeatured] = useState<Featured[]>([]);
  const [loading, setLoading] = useState(true);
  const [featuredError, setFeaturedError] = useState(false);

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
        if (!cancelled) setFeaturedError(true);
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

  return (
    <div className={styles.page}>
      <a href="#home-content" className="skip-link">Skip to content</a>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}><AppLogo alt="" />LiBot</Link>
        <nav aria-label="Explore" className={styles.navigation}>
          <Link href="/buyer/properties">Properties</Link>
          <Link href="/buyer/properties?tour=1">Virtual tours</Link>
        </nav>
        <div className={styles.actions}>
          <ThemeToggle />
          <Link href="/login" className={styles.signIn}>Sign in</Link>
          <Link href="/register/choose" className="ui-button ui-button-primary">Get started</Link>
        </div>
      </header>

      <main id="home-content" className={styles.content} tabIndex={-1}>
        <section aria-labelledby="home-title">
          <div className={styles.hero}>
            <div className={styles.heroCopy}>
              <p className={styles.location}><MapPin size={16} aria-hidden="true" /> Iloilo, Philippines</p>
              <h1 id="home-title">Find a place worth exploring.</h1>
              <p className={styles.heroDescription}>Browse properties in Iloilo, look around in 360°, and schedule a viewing when you’re ready.</p>
            </div>
            <div className={styles.heroImage}>
              <SafeImage src="/background.png" alt="" fill priority sizes="(min-width: 1024px) 60vw, 100vw" className="object-cover" />
              <Link href="/buyer/properties?tour=1" className={styles.tourLink}><PlayCircle size={20} aria-hidden="true" /> Explore 360° tours</Link>
            </div>
          </div>

          <form onSubmit={search} className={styles.search} aria-label="Find a property">
            <label>Location<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="City or neighborhood" /></label>
            <label>Property type<select value={type} onChange={(event) => setType(event.target.value)} className="ui-select"><option value="">Any type</option>{PROPERTY_TYPES.map((option) => <option key={option}>{option}</option>)}</select></label>
            <label>Maximum price<select value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} className="ui-select"><option value="">Any price</option><option value="3000000">Up to ₱3M</option><option value="5000000">Up to ₱5M</option><option value="10000000">Up to ₱10M</option></select></label>
            <button type="submit" className="ui-button ui-button-primary"><Search size={18} aria-hidden="true" /> Search properties</button>
          </form>
        </section>

        <section className={styles.featured} aria-labelledby="featured-title" aria-busy={loading}>
          <div className={styles.sectionHeading}>
            <div><h2 id="featured-title">Homes you can tour</h2><p>Take a look inside before booking a visit.</p></div>
            <Link href="/buyer/properties?tour=1" className="ui-button ui-button-secondary">View all tours</Link>
          </div>
          {loading ? <div className={styles.listings} role="status"><span className="sr-only">Loading virtual tours…</span>{[1, 2, 3].map((item) => <Skeleton key={item} className="h-72" />)}</div> : featured.length ? (
            <div className={styles.listings}>
              {featured.map((property) => (
                <Link key={property.id} href={`/buyer/properties/${property.id}`} className={`ui-card group ${styles.listing}`}>
                  <div className={styles.listingImage}>
                    {isRemoteImageUrl(property.image) ? <SafeImage src={property.image} alt="" fill sizes="(min-width: 900px) 33vw, (min-width: 600px) 50vw, 100vw" className="object-cover transition-transform group-hover:scale-[1.03] motion-reduce:transform-none" /> : <House size={36} aria-hidden="true" />}
                    <span className={styles.badge}><PlayCircle size={15} aria-hidden="true" />360° tour</span>
                  </div>
                  <div className="p-5"><h3 className="text-lg font-semibold">{property.title || "Property"}</h3><p className="mt-1 text-sm text-slate-500">{property.location || "Location not specified"}</p><p className="mt-3 font-semibold text-blue-700">{property.price ? `₱${property.price}` : "Contact for price"}</p></div>
                </Link>
              ))}
            </div>
          ) : (
            <div className={`ui-card ${styles.empty}`}>
              <PlayCircle size={28} aria-hidden="true" />
              <div><p className="font-semibold">{featuredError ? "Virtual tours are temporarily unavailable" : "No virtual tours are available yet"}</p><p className="mt-1 text-sm text-slate-500">You can still explore all property listings.</p></div>
              <Link href="/buyer/properties" className="ui-button ui-button-secondary">Browse properties</Link>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
