"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isRemoteImageUrl } from "@/lib/cloudinary";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useBuyerFavorites } from "@/hooks/useBuyerFavorites";
import {
  Search,
  MapPin,
  Heart,
  X,
  Home,
  Zap,
  Filter,
  ArrowUpDown,
  Scale,
} from "lucide-react";
import NotificationCenter from "@/components/NotificationCenter";
import BuyerAccountMenu from "@/components/BuyerAccountMenu";
import SafeImage from "@/components/SafeImage";
import AppLogo from "@/components/AppLogo";
import { ThemeToggle } from "@/components/ThemeController";
import { PROPERTY_TYPES } from "@/lib/propertyAmenities";
import { canAccessRole } from "@/lib/role-access";
import { matchesLocation, matchesPropertySearch } from "@/lib/property-search";
import { isPublishedTour } from "@/lib/published-tour";
import { loadTourSummaries } from "@/lib/tour-summaries";
import { isBrowsableProperty } from "@/lib/property-visibility";

interface Property {
  id: string;
  title?: string;
  description?: string;
  price?: string;
  location?: string;
  brokerId?: string;
  image?: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  propertyType?: string;
  amenities?: string[];
  availabilityStatus?: "available" | "reserved" | "sold";
  status?: string;
  createdAt?: Timestamp;
  [key: string]: unknown;
}

export default function BuyerPropertiesPage() {
  return <Suspense fallback={<main className="p-8 text-slate-600">Loading property search…</main>}><BuyerPropertiesContent /></Suspense>;
}

function BuyerPropertiesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchTerm = searchParams.get("q") ?? "";
  const locationFilter = searchParams.get("location") ?? "";
  const typeFilter = searchParams.get("type") ?? "";
  const minPrice = searchParams.get("minPrice") ?? "";
  const maxPrice = searchParams.get("maxPrice") ?? "";
  const minBeds = searchParams.get("beds") ?? "";
  const virtualToursOnly = searchParams.get("tour") === "1";
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tourError, setTourError] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const [buyerAccount, setBuyerAccount] = useState(false);
  const { favorites, toggleFavorite, isUpdating, error: favoriteError } = useBuyerFavorites();
  const [sortBy, setSortBy] = useState<"newest" | "price-low" | "price-high">("newest");
  const [showFilters, setShowFilters] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [tourPropertyIds, setTourPropertyIds] = useState<Set<string>>(new Set());
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareError, setCompareError] = useState("");
  const comparison = useRef<HTMLDialogElement>(null);
  const searchEdited = useRef(false);

  function updateFilters(values: Record<string, string>) {
    searchEdited.current = true;
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(values)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    window.history.replaceState(null, "", window.location.pathname + (params.size ? "?" + params : ""));
  }

  const clearFilters = (clearSearch = false) => updateFilters({ location: "", type: "", minPrice: "", maxPrice: "", beds: "", tour: "", ...(clearSearch ? { q: "" } : {}) });

  const retry = () => {
    setLoading(true);
    setLoadError(false);
    setTourError(false);
    setLoadVersion((version) => version + 1);
  };

  useEffect(() => {
    let disposed = false;
    let request = 0;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      const current = ++request;
      if (!user) setBuyerAccount(false);
      try {
        const [propertySnapshot, profileSnapshot, tourSnapshot] = await Promise.all([
          getDocs(collection(db, "properties")),
          user ? getDoc(doc(db, "users", user.uid)).catch(() => null) : Promise.resolve(null),
          loadTourSummaries(String(db.app.options.projectId)).catch(() => null),
        ]);

        const propertyList: Property[] = [];

        const propertyDocs = propertySnapshot.docs.filter((item) => isBrowsableProperty(item.data()));

        propertyDocs.forEach((doc) => {
          const data = doc.data();
          propertyList.push({
            id: doc.id,
            ...data,
            image: data.image,
          } as Property);
        });

        const imageLookup = new Map<string, string>();
        const propertyIds = propertyList.filter((property) => !isRemoteImageUrl(property.image)).map((property) => property.id);
        const chunks = Array.from({ length: Math.ceil(propertyIds.length / 30) }, (_, index) => propertyIds.slice(index * 30, index * 30 + 30));
        const roomSnapshots = await Promise.all(chunks.map((ids) => getDocs(query(collection(db, "roomImages"), where("propertyId", "in", ids)))))
          .catch((roomImageError) => {
            console.error("Unable to load listing gallery covers:", roomImageError);
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

        if (disposed || request !== current) return;
        setProperties(propertyList.map((property) => ({
          ...property,
          image: isRemoteImageUrl(property.image) ? property.image : imageLookup.get(property.id),
        })));
        setLoadError(false);
        setTourError(tourSnapshot === null);
        setTourPropertyIds(new Set((tourSnapshot ?? []).filter(isPublishedTour).map((item) => String(item.propertyId))));
        const account = profileSnapshot?.data();
        setBuyerAccount(canAccessRole("buyer", account ?? {}));
        const discovery = account?.settings?.discovery;
        if (discovery && !searchEdited.current && !window.location.search) {
          updateFilters({
            location: String(discovery.location ?? ""),
            minPrice: String(discovery.minPrice ?? ""),
            maxPrice: String(discovery.maxPrice ?? ""),
            beds: String(discovery.minBeds ?? ""),
          });
        }
      } catch (error) {
        console.error("Unable to load properties:", error);
        if (!disposed && request === current) setLoadError(true);
      } finally {
        if (!disposed && request === current) setLoading(false);
      }
    });
    return () => { disposed = true; unsubscribe(); };
  }, [loadVersion]);

  const propertyPrice = (property: Property) => Number(String(property.price ?? "").replace(/[^0-9.]/g, "")) || 0;
  const filters = [
    { key: "location", label: locationFilter },
    { key: "type", label: typeFilter },
    { key: "minPrice", label: minPrice && "From \u20b1" + Number(minPrice).toLocaleString("en-PH") },
    { key: "maxPrice", label: maxPrice && "Up to \u20b1" + Number(maxPrice).toLocaleString("en-PH") },
    { key: "beds", label: minBeds && minBeds + "+ beds" },
    { key: "tour", label: virtualToursOnly && "Has virtual tour" },
  ].filter(({ label }) => Boolean(label));
  const filteredProperties = properties
    .filter((property) => {
      const priceValue = propertyPrice(property);
      return matchesPropertySearch(property, searchTerm)
        && matchesLocation(property.location, locationFilter)
        && (!typeFilter || property.propertyType?.toLowerCase() === typeFilter.toLowerCase())
        && (!minPrice || priceValue >= Number(minPrice))
        && (!maxPrice || priceValue <= Number(maxPrice))
        && (!minBeds || Number(property.beds ?? 0) >= Number(minBeds))
        && (!virtualToursOnly || tourPropertyIds.has(property.id));
    })
    .sort((a, b) => {
      if (sortBy === "newest") return (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0);
      const firstPrice = propertyPrice(a);
      const secondPrice = propertyPrice(b);
      if (!firstPrice || !secondPrice) return Number(!firstPrice) - Number(!secondPrice);
      return sortBy === "price-low" ? firstPrice - secondPrice : secondPrice - firstPrice;
    });
  const comparedProperties = compareIds.map((id) => properties.find((property) => property.id === id)).filter((property): property is Property => Boolean(property));

  const toggleCompare = (propertyId: string) => {
    setCompareError("");
    setCompareIds((current) => {
      if (current.includes(propertyId)) return current.filter((id) => id !== propertyId);
      if (current.length >= 3) {
        setCompareError("You can compare up to three properties at a time.");
        return current;
      }
      return [...current, propertyId];
    });
  };

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

  return (
    <div className="min-h-screen bg-slate-50">
      <main>
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
          <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
            <Link href={buyerAccount ? "/buyer" : "/"} className="flex shrink-0 items-center gap-2 text-lg font-bold"><AppLogo alt="" className="h-9 w-9" />LiBot</Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              {buyerAccount ? <><NotificationCenter audience="buyer" /><BuyerAccountMenu onSignOut={handleSignOut} signingOut={signingOut} /></> : <Link href="/login" className="ui-button ui-button-secondary">Sign in</Link>}
            </div>
          </div>
        </header>

        <div className={"mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:pt-10 " + (compareIds.length ? "pb-28" : "pb-10")}>
          {favoriteError && <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{favoriteError}</div>}
          {compareError && <div role="alert" className="mb-6 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><span>{compareError}</span><button type="button" onClick={() => setCompareError("")} aria-label="Dismiss comparison message" className="ui-icon-button"><X size={17} /></button></div>}
          <section className="workspace-intro mb-6" aria-labelledby="property-search-title">
            <h1 id="property-search-title" className="text-3xl font-semibold sm:text-4xl">Browse properties</h1>
            <p className="mt-2 text-slate-600">Find a place in Iloilo and compare your shortlist.</p>
            <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
              <label className="relative block">
                <span className="sr-only">Search by property name or location</span>
                <Search size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                <input type="search" placeholder="Property name or location" value={searchTerm} onChange={(event) => updateFilters({ q: event.target.value })} className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-12 pr-4 text-base" />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setShowFilters((open) => !open)} aria-expanded={showFilters} aria-controls="property-filters" className="ui-button ui-button-secondary"><Filter size={17} aria-hidden="true" /> Filters {filters.length > 0 && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs text-white">{filters.length}</span>}</button>
                <label className="ui-button ui-button-secondary cursor-pointer"><input type="checkbox" checked={virtualToursOnly} onChange={(event) => updateFilters({ tour: event.target.checked ? "1" : "" })} className="h-4 w-4 accent-blue-600" /> Has virtual tour</label>
              </div>
            </div>
          </section>

          <section id="property-filters" aria-label="Property filters" hidden={!showFilters} className="ui-card mb-6 p-4 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <label className="grid gap-2 text-sm font-medium">Location<input value={locationFilter} onChange={(event) => updateFilters({ location: event.target.value })} placeholder="City or province" className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base" /></label>
              <label className="grid gap-2 text-sm font-medium">Property type<select value={typeFilter} onChange={(event) => updateFilters({ type: event.target.value })} className="ui-select h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-3 text-base"><option value="">Any type</option>{typeFilter && !PROPERTY_TYPES.some((type) => type === typeFilter) && <option>{typeFilter}</option>}{PROPERTY_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
              <label className="grid gap-2 text-sm font-medium">Minimum price<input type="number" min="0" value={minPrice} onChange={(event) => updateFilters({ minPrice: event.target.value })} placeholder="Any" className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base" /></label>
              <label className="grid gap-2 text-sm font-medium">Maximum price<input type="number" min="0" value={maxPrice} onChange={(event) => updateFilters({ maxPrice: event.target.value })} placeholder="Any" className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base" /></label>
              <label className="grid gap-2 text-sm font-medium">Minimum bedrooms<select value={minBeds} onChange={(event) => updateFilters({ beds: event.target.value })} className="ui-select h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-3 text-base"><option value="">Any</option><option value="1">1+</option><option value="2">2+</option><option value="3">3+</option><option value="4">4+</option></select></label>
            </div>
          </section>
          {filters.length > 0 && <div className="mb-5 flex flex-wrap items-center gap-2" aria-label="Active filters">
            {filters.map(({ key, label }) => <button key={key} type="button" aria-label={"Remove filter " + label} onClick={() => updateFilters({ [key]: "" })} className="ui-button ui-button-secondary max-w-full text-left [overflow-wrap:anywhere]">{label}<X size={15} className="shrink-0" aria-hidden="true" /></button>)}
            <button type="button" onClick={() => clearFilters()} className="ui-button text-blue-700 hover:underline">Clear filters</button>
          </div>}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600" role="status">{loading ? "Loading properties..." : !loadError && (!virtualToursOnly || !tourError) ? filteredProperties.length + (filteredProperties.length === 1 ? " property" : " properties") : ""}</p>
            <label className="flex items-center gap-2 text-sm font-semibold"><ArrowUpDown size={17} aria-hidden="true" /><span className="sr-only">Sort properties</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)} className="ui-select min-h-11 rounded-xl border border-slate-200 bg-white pl-3"><option value="newest">Newest first</option><option value="price-low">Price, low to high</option><option value="price-high">Price, high to low</option></select></label>
          </div>
          {tourError && !virtualToursOnly && !loadError && <p role="status" className="mb-4 text-sm text-slate-600">Virtual tour availability could not be loaded. <button type="button" onClick={retry} className="font-semibold text-blue-700 underline">Retry</button></p>}

          {/* Loading State */}
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className="bg-white rounded-2xl border border-slate-200 overflow-hidden animate-pulse"
                >
                  <div className="h-48 bg-slate-200" />
                  <div className="p-6 space-y-4">
                    <div className="h-4 bg-slate-200 rounded w-2/3" />
                    <div className="h-4 bg-slate-200 rounded w-1/2" />
                    <div className="grid grid-cols-3 gap-3 py-4">
                      {[...Array(3)].map((_, j) => (
                        <div key={j} className="h-8 bg-slate-200 rounded" />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : loadError || (tourError && virtualToursOnly) ? (
            <div className="ui-card p-8 text-center" role="alert">
              <h2 className="text-lg font-semibold">{loadError ? "Properties could not be loaded" : "Virtual tour availability could not be loaded"}</h2>
              <p className="mt-2 text-slate-600">Try again to refresh the results.</p>
              <button type="button" onClick={retry} className="ui-button ui-button-primary mt-5">Try again</button>
            </div>
          ) : (
            <>
              {/* Properties Grid */}
              {filteredProperties.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredProperties.map((property) => (
                    <article key={property.id} className="ui-card group relative flex h-full flex-col overflow-hidden transition-shadow hover:shadow-md">
                      {/* Image Container */}
                      <div className="relative h-48 bg-gradient-to-br from-slate-200 to-slate-300 overflow-hidden">
                        {property.image ? (
                          <SafeImage
                            src={property.image as string}
                            alt={property.title || "Property cover"}
                            fill
                            sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                            className="object-cover transition-transform duration-150 group-hover:scale-[1.03] motion-reduce:transform-none"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-slate-100">
                            <Home size={48} className="text-slate-300" />
                          </div>
                        )}

                        {/* Favorite Button */}
                        <button
                          aria-label={favorites.has(property.id) ? "Remove from favorites" : "Add to favorites"}
                          type="button"
                          aria-pressed={favorites.has(property.id)}
                          disabled={isUpdating(property.id)}
                          onClick={() => void toggleFavorite(property.id)}
                          className="ui-icon-button absolute right-3 top-3 z-10 shadow-sm"
                        >
                          <Heart
                            size={20}
                            className={`transition-colors ${
                              favorites.has(property.id)
                                ? "fill-red-500 text-red-500"
                                : "text-slate-400"
                            }`}
                          />
                        </button>

                        <button aria-label={compareIds.includes(property.id) ? "Remove from comparison" : "Add to comparison"} type="button" aria-pressed={compareIds.includes(property.id)} onClick={() => toggleCompare(property.id)} className={`absolute right-3 top-16 z-10 flex h-11 w-11 items-center justify-center rounded-xl shadow-sm transition ${compareIds.includes(property.id) ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:text-blue-600"}`}><Scale size={17} /></button>

                        {/* Badge */}
                        {tourPropertyIds.has(property.id) && <div className="absolute top-3 left-3 flex items-center gap-1 rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white shadow-md"><Zap size={14} />360° Tour Available</div>}
                        <div className={`absolute bottom-3 left-3 rounded-full px-3 py-1 text-xs font-semibold capitalize shadow-sm ${property.availabilityStatus === "sold" ? "bg-slate-900 text-white" : property.availabilityStatus === "reserved" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{property.availabilityStatus ?? "available"}</div>
                      </div>

                      {/* Content */}
                      <div className="p-6 flex flex-col flex-1">
                        <h3 className="font-semibold text-slate-900 text-lg mb-2 group-hover:text-blue-600 transition-colors line-clamp-2">
                          {property.title || "Unnamed Property"}
                        </h3>

                        {/* Location */}
                        <div className="flex items-start gap-2 mb-4">
                          <MapPin size={16} className="text-slate-400 flex-shrink-0 mt-0.5" />
                          <p className="text-sm text-slate-600 line-clamp-2">
                            {property.location || "Location not specified"}
                          </p>
                        </div>

                        {/* Details Grid */}
                        {(
                          <div className="grid grid-cols-3 gap-3 mb-6 py-4 border-y border-slate-200">
                            {property.beds != null && (
                              <div className="text-center">
                                <p className="text-2xl font-light text-slate-900">{property.beds}</p>
                                <p className="text-xs text-slate-600">Beds</p>
                              </div>
                            )}
                            {property.baths != null && (
                              <div className="text-center">
                                <p className="text-2xl font-light text-slate-900">{property.baths}</p>
                                <p className="text-xs text-slate-600">Baths</p>
                              </div>
                            )}
                            {property.sqft != null && (
                              <div className="text-center">
                                <p className="text-2xl font-light text-slate-900">{property.sqft}</p>
                                <p className="text-xs text-slate-600">Sqft</p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Price & CTA */}
                        <div className="mt-auto flex flex-wrap items-end justify-between gap-2">
                          <div>
                            <p className="text-xs text-slate-600 mb-1">Starting Price</p>
                            <p className="text-xl font-semibold text-slate-900">
                              {property.price ? "\u20b1" + property.price : "Contact for price"}
                            </p>
                          </div>
                          <Link href={"/buyer/properties/" + property.id} aria-label={"View " + (property.title || "property details")} className="text-right text-sm font-semibold text-blue-700 after:absolute after:inset-0 hover:underline">
                            View details
                          </Link>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="ui-card flex flex-col items-center justify-center px-5 py-12">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                    <Search size={32} className="text-slate-400" />
                  </div>
                  <p className="text-slate-900 text-lg font-medium mb-2">No properties found</p>
                  <p className="max-w-full text-center text-sm text-slate-500 [overflow-wrap:anywhere]">
                    {searchTerm
                      ? `No properties match "${searchTerm}". Try adjusting your search terms.`
                      : filters.length ? "Try changing or clearing your filters." : "No properties are available right now."}
                  </p>
                  {(searchTerm || filters.length > 0) && <button type="button" onClick={() => clearFilters(true)} className="ui-button ui-button-primary mt-5">Clear search and filters</button>}
                </div>
              )}
            </>
          )}
        </div>
      </main>
      {compareIds.length > 0 && (
        <div className="ui-card fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-xl items-center gap-2 p-3 shadow-lg sm:bottom-5">
          <p role="status" className="min-w-0 flex-1 text-sm font-semibold">{compareIds.length} selected</p>
          <button type="button" onClick={() => setCompareIds([])} className="ui-button ui-button-secondary">Clear</button>
          <button type="button" onClick={() => comparison.current?.showModal()} disabled={compareIds.length < 2} className="ui-button ui-button-primary">
            <Scale size={17} aria-hidden="true" /> Compare
          </button>
        </div>
      )}
      <dialog
        ref={comparison}
        aria-labelledby="compare-properties-title"
        onClick={(event) => { if (event.target === event.currentTarget) comparison.current?.close(); }}
        className="property-comparison m-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100%_-_1.5rem)] max-w-5xl rounded-3xl bg-white text-slate-900 shadow-2xl backdrop:bg-slate-950/60"
      >
        <div className="p-5 sm:p-7">
          <div className="flex items-center justify-between gap-4">
            <h2 id="compare-properties-title" className="text-2xl font-semibold">Compare properties</h2>
            <button type="button" onClick={() => comparison.current?.close()} aria-label="Close comparison" className="ui-icon-button"><X size={21} aria-hidden="true" /></button>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {comparedProperties.map((property) => (
              <article key={property.id} className="flex flex-col overflow-hidden rounded-2xl border border-slate-200">
                <div className="bg-slate-900 p-5 text-white">
                  <p className="text-sm text-white/75">{property.propertyType || "Property"}</p>
                  <h3 className="mt-2 text-lg font-semibold">{property.title || "Unnamed property"}</h3>
                  <p className="mt-2 text-2xl font-semibold">{property.price ? "\u20b1" + property.price : "Contact for price"}</p>
                </div>
                <dl className="divide-y divide-slate-100 p-5 text-sm">
                  <CompareRow label="Availability" value={property.availabilityStatus ?? "Available"} />
                  <CompareRow label="Location" value={property.location || "Not specified"} />
                  <CompareRow label="Bedrooms" value={String(property.beds ?? "Not specified")} />
                  <CompareRow label="Bathrooms" value={String(property.baths ?? "Not specified")} />
                  <CompareRow label="Floor area" value={property.sqft ? property.sqft + " sqft" : "Not specified"} />
                  <CompareRow label="Virtual tour" value={tourError ? "Unknown" : tourPropertyIds.has(property.id) ? "Available" : "Not available"} />
                  <CompareRow label="Amenities" value={property.amenities?.length ? property.amenities.length + " listed" : "None listed"} />
                </dl>
                <Link href={"/buyer/properties/" + property.id} className="ui-button ui-button-primary mx-5 mb-5 mt-auto">View property</Link>
              </article>
            ))}
          </div>
        </div>
      </dialog>
    </div>
  );
}

function CompareRow({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-3"><dt className="text-slate-400">{label}</dt><dd className="break-words text-right font-semibold capitalize text-slate-700">{value}</dd></div>;
}
