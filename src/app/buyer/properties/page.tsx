"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
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
  ChevronRight,
  Zap,
  Filter,
  ArrowUpDown,
  Scale,
} from "lucide-react";
import NotificationCenter from "@/components/NotificationCenter";
import BuyerAccountMenu from "@/components/BuyerAccountMenu";
import SafeImage from "@/components/SafeImage";
import AppLogo from "@/components/AppLogo";
import searchStyles from "./search.module.css";

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
  [key: string]: unknown;
}

export default function BuyerPropertiesPage() {
  const router = useRouter();
  const initialParam = (key: string) => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get(key) ?? "";
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState(() => initialParam("q"));
  const { favorites, toggleFavorite, isUpdating, error: favoriteError } = useBuyerFavorites();
  const [sortBy, setSortBy] = useState<"newest" | "price-low" | "price-high">("newest");
  const [showFilters, setShowFilters] = useState(() => Boolean(initialParam("location") || initialParam("type") || initialParam("minPrice") || initialParam("maxPrice")));
  const [locationFilter, setLocationFilter] = useState(() => initialParam("location"));
  const [typeFilter, setTypeFilter] = useState(() => initialParam("type"));
  const [minPrice, setMinPrice] = useState(() => initialParam("minPrice"));
  const [maxPrice, setMaxPrice] = useState(() => initialParam("maxPrice"));
  const [minBeds, setMinBeds] = useState(() => initialParam("beds"));
  const [signingOut, setSigningOut] = useState(false);
  const [tourPropertyIds, setTourPropertyIds] = useState<Set<string>>(new Set());
  const [virtualToursOnly, setVirtualToursOnly] = useState(() => initialParam("tour") === "1");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareError, setCompareError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries({ q: searchTerm, location: locationFilter, type: typeFilter, minPrice, maxPrice, beds: minBeds })) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    if (virtualToursOnly) params.set("tour", "1");
    else params.delete("tour");
    const next = `${window.location.pathname}${params.size ? `?${params}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
  }, [searchTerm, locationFilter, typeFilter, minPrice, maxPrice, minBeds, virtualToursOnly]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        const [activePropertySnapshot, legacyPropertySnapshot, profileSnapshot, tourSnapshot] = await Promise.all([
          getDocs(query(collection(db, "properties"), where("status", "==", "active"))),
          getDocs(query(collection(db, "properties"), where("status", "==", null))),
          user ? getDoc(doc(db, "users", user.uid)) : Promise.resolve(null),
          getDocs(query(collection(db, "roomTours"), where("status", "==", "published"))),
        ]);

        const propertyList: Property[] = [];

        const propertyDocs = new Map([...activePropertySnapshot.docs, ...legacyPropertySnapshot.docs].map((item) => [item.id, item]));

        propertyDocs.forEach((doc) => {
          const data = doc.data();
          propertyList.push({
            id: doc.id,
            ...data,
            image: data.image,
          } as Property);
        });

        const imageLookup = new Map<string, string>();
        const propertyIds = propertyList.map((property) => property.id);
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

        setProperties(propertyList.map((property) => ({
          ...property,
          image: isRemoteImageUrl(property.image) ? property.image : imageLookup.get(property.id),
        })));
        setTourPropertyIds(new Set(tourSnapshot.docs.filter((item) => item.data().panoramaUrl).map((item) => String(item.data().propertyId))));
        const discovery = profileSnapshot?.data()?.settings?.discovery;
        if (discovery && !window.location.search) {
          setLocationFilter(String(discovery.location ?? ""));
          setMinPrice(String(discovery.minPrice ?? ""));
          setMaxPrice(String(discovery.maxPrice ?? ""));
          setMinBeds(String(discovery.minBeds ?? ""));
          setShowFilters(Boolean(discovery.location || discovery.minPrice || discovery.maxPrice || discovery.minBeds));
        }
      } catch (error) {
        console.log(error);
      } finally {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const propertyPrice = (property: Property) => Number(String(property.price ?? "").replace(/[^0-9.]/g, "")) || 0;
  const activeFilterCount = [locationFilter, typeFilter, minPrice, maxPrice, minBeds].filter(Boolean).length + (virtualToursOnly ? 1 : 0);
  const filteredProperties = properties
    .filter((property) => {
      const search = searchTerm.trim().toLowerCase();
      const location = property.location?.toLowerCase() ?? "";
      const priceValue = propertyPrice(property);
      return (!search || property.title?.toLowerCase().includes(search) || location.includes(search))
        && (!locationFilter.trim() || location.includes(locationFilter.trim().toLowerCase()))
        && (!typeFilter || property.propertyType?.toLowerCase() === typeFilter.toLowerCase())
        && (!minPrice || priceValue >= Number(minPrice))
        && (!maxPrice || priceValue <= Number(maxPrice))
        && (!minBeds || Number(property.beds ?? 0) >= Number(minBeds))
        && (!virtualToursOnly || tourPropertyIds.has(property.id));
    })
    .sort((a, b) => {
      if (sortBy === "price-low") {
        return propertyPrice(a) - propertyPrice(b);
      } else if (sortBy === "price-high") {
        return propertyPrice(b) - propertyPrice(a);
      }
      return 0;
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
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3"><Link href="/buyer" aria-label="LiBot dashboard" className="shrink-0"><AppLogo className="h-9 w-9" /></Link><h1 className="truncate text-lg font-semibold text-slate-900 sm:text-xl">Browse Properties</h1></div>
            <div className="flex items-center gap-2"><NotificationCenter audience="buyer" /><BuyerAccountMenu onSignOut={handleSignOut} signingOut={signingOut} /></div>
          </div>
        </header>

        {/* Page Content */}
        <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-10">
          {favoriteError && <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{favoriteError}</div>}
          {compareError && <div role="alert" className="mb-6 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><span>{compareError}</span><button onClick={() => setCompareError("")} aria-label="Dismiss"><X size={17} /></button></div>}
          {/* Search Bar */}
          <div className="mb-8">
            <div className="relative">
              <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by property name or location..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-12 pr-4 h-12 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all"
              />
            </div>
          </div>

          <label className="mb-5 inline-flex cursor-pointer items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm"><input type="checkbox" checked={virtualToursOnly} onChange={(event) => setVirtualToursOnly(event.target.checked)} className="h-4 w-4 accent-blue-600" />Has virtual tour</label>

          {/* Filters and Sort Bar */}
          <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg hover:border-slate-300 transition-colors text-slate-600 hover:text-slate-900 font-medium"
              >
                <Filter size={18} />
                <span>Filter</span>
                {activeFilterCount > 0 && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs text-white">{activeFilterCount}</span>}
              </button>
              
              <div className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg">
                <ArrowUpDown size={18} className="text-slate-400" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as "newest" | "price-low" | "price-high")}
                  className="bg-transparent text-slate-900 font-medium focus:outline-none cursor-pointer"
                >
                  <option value="newest">Newest First</option>
                  <option value="price-low">Price: Low to High</option>
                  <option value="price-high">Price: High to Low</option>
                </select>
              </div>
            </div>

            <div className="text-sm text-slate-600">
              Showing <span className="font-semibold text-slate-900">{filteredProperties.length}</span> of <span className="font-semibold text-slate-900">{properties.length}</span> properties
            </div>
          </div>

          {activeFilterCount > 0 && <div className="mb-5 flex flex-wrap items-center gap-2" aria-label="Active filters">{[
            locationFilter && `Location: ${locationFilter}`,
            typeFilter && `Type: ${typeFilter}`,
            minPrice && `From ₱${Number(minPrice).toLocaleString("en-PH")}`,
            maxPrice && `Up to ₱${Number(maxPrice).toLocaleString("en-PH")}`,
            minBeds && `${minBeds}+ beds`,
            virtualToursOnly && "Has virtual tour",
          ].filter(Boolean).map((label) => <span key={label as string} className="rounded-full bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800">{label}</span>)}<button onClick={() => { setLocationFilter(""); setTypeFilter(""); setMinPrice(""); setMaxPrice(""); setMinBeds(""); setVirtualToursOnly(false); }} className="px-2 text-xs font-semibold text-slate-500 hover:text-slate-900">Clear all</button></div>}
          {showFilters && <><div className="fixed inset-0 z-40 bg-slate-950/50 md:hidden" onClick={() => setShowFilters(false)} aria-hidden="true" /><section aria-label="Filter properties" className={`${searchStyles.sheet} fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-3xl border border-slate-200 bg-white p-5 shadow-xl md:static md:z-auto md:mb-8 md:max-h-none md:rounded-2xl md:shadow-sm`}><div className="flex items-center justify-between gap-4"><h2 className="text-lg font-semibold text-slate-900">Filter properties</h2><button onClick={() => setShowFilters(false)} aria-label="Close filters" className="rounded-lg p-2 text-slate-500 md:hidden"><X size={20} /></button></div><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5"><label className="text-xs font-semibold text-slate-600">Location<input value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} placeholder="City or province" className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900" /></label><label className="text-xs font-semibold text-slate-600">Property type<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"><option value="">Any type</option><option value="Condominium">Condominium</option><option value="House and Lot">House and Lot</option><option value="Lot">Lot</option></select></label><label className="text-xs font-semibold text-slate-600">Minimum price<input type="number" min="0" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} placeholder="Any" className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900" /></label><label className="text-xs font-semibold text-slate-600">Maximum price<input type="number" min="0" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="Any" className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900" /></label><label className="text-xs font-semibold text-slate-600">Minimum bedrooms<select value={minBeds} onChange={(event) => setMinBeds(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"><option value="">Any</option><option value="1">1+</option><option value="2">2+</option><option value="3">3+</option><option value="4">4+</option></select></label></div><label className="mt-5 flex cursor-pointer items-center gap-3 text-sm font-semibold text-slate-700"><input type="checkbox" checked={virtualToursOnly} onChange={(event) => setVirtualToursOnly(event.target.checked)} className="h-4 w-4 accent-teal-700" />Has virtual tour</label><button onClick={() => setShowFilters(false)} className="mt-6 min-h-12 w-full rounded-xl bg-[#07585b] px-5 text-sm font-semibold text-white md:hidden">Show {filteredProperties.length} {filteredProperties.length === 1 ? "property" : "properties"}</button></section></>}

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
          ) : (
            <>
              {/* Properties Grid */}
              {filteredProperties.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredProperties.map((property) => (
                    <Link
                      key={property.id}
                      href={`/buyer/properties/${property.id}`}
                      className="group"
                    >
                      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-lg hover:border-slate-300 transition-shadow duration-150 h-full flex flex-col">
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
                            disabled={isUpdating(property.id)}
                            onClick={(e) => {
                              e.preventDefault();
                              void toggleFavorite(property.id);
                            }}
                            className="absolute top-3 right-3 p-2 bg-white rounded-full shadow-md hover:shadow-lg transition-all hover:scale-110 disabled:opacity-60"
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

                          <button aria-label={compareIds.includes(property.id) ? "Remove from comparison" : "Add to comparison"} onClick={(event) => { event.preventDefault(); toggleCompare(property.id); }} className={`absolute right-3 top-14 flex h-9 w-9 items-center justify-center rounded-full shadow-md transition ${compareIds.includes(property.id) ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:text-blue-600"}`}><Scale size={17} /></button>

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
                          <div className="flex items-center justify-between mt-auto">
                            <div>
                              <p className="text-xs text-slate-600 mb-1">Starting Price</p>
                              <p className="text-xl font-semibold text-slate-900">
                                ₱{property.price || "Contact"}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2.5 text-xs font-semibold text-white group-hover:bg-blue-700">
                              <span>{tourPropertyIds.has(property.id) ? "Start 360° tour" : "View details"}</span>
                              <ChevronRight size={16} className="group-hover:translate-x-1" />
                            </div>
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                    <Search size={32} className="text-slate-400" />
                  </div>
                  <p className="text-slate-900 text-lg font-medium mb-2">No properties found</p>
                  <p className="text-slate-500 text-sm max-w-md text-center">
                    {searchTerm
                      ? `No properties match "${searchTerm}". Try adjusting your search terms.`
                      : "No properties available at the moment."}
                  </p>
                  {(searchTerm || activeFilterCount > 0) && <button onClick={() => { setSearchTerm(""); setLocationFilter(""); setTypeFilter(""); setMinPrice(""); setMaxPrice(""); setMinBeds(""); setVirtualToursOnly(false); }} className="mt-5 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">Clear search and filters</button>}
                </div>
              )}
            </>
          )}
        </div>
      </main>
      {compareIds.length > 0 && <div className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-xl items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl sm:bottom-5"><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-900">{compareIds.length} selected</p><p className="truncate text-xs text-slate-500">Choose up to 3 properties</p></div><button onClick={() => setCompareIds([])} className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100">Clear</button><button onClick={() => setCompareOpen(true)} disabled={compareIds.length < 2} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"><Scale size={16} />Compare</button></div>}
      {compareOpen && <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:items-center sm:p-4"><div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl overflow-y-auto rounded-3xl bg-white p-5 text-slate-900 shadow-2xl sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Side-by-side</p><h2 className="mt-2 text-2xl font-semibold">Compare properties</h2></div><button onClick={() => setCompareOpen(false)} aria-label="Close comparison" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={21} /></button></div><div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{comparedProperties.map((property) => <article key={property.id} className="overflow-hidden rounded-2xl border border-slate-200"><div className="bg-slate-900 p-5 text-white"><p className="text-xs font-semibold uppercase tracking-wider text-white/50">{property.propertyType || "Property"}</p><h3 className="mt-2 text-lg font-semibold">{property.title || "Unnamed property"}</h3><p className="mt-2 text-2xl font-semibold">₱{property.price || "Contact"}</p></div><dl className="divide-y divide-slate-100 p-5 text-sm"><CompareRow label="Availability" value={property.availabilityStatus ?? "Available"} /><CompareRow label="Location" value={property.location || "Not specified"} /><CompareRow label="Bedrooms" value={String(property.beds ?? "Not specified")} /><CompareRow label="Bathrooms" value={String(property.baths ?? "Not specified")} /><CompareRow label="Floor area" value={property.sqft ? `${property.sqft} sqft` : "Not specified"} /><CompareRow label="Virtual tour" value={tourPropertyIds.has(property.id) ? "Available" : "Not available"} /><CompareRow label="Amenities" value={property.amenities?.length ? `${property.amenities.length} listed` : "None listed"} /></dl><Link href={`/buyer/properties/${property.id}`} className="m-5 mt-0 flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white">View property</Link></article>)}</div></div></div>}
    </div>
  );
}

function CompareRow({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-3"><dt className="text-slate-400">{label}</dt><dd className="break-words text-right font-semibold capitalize text-slate-700">{value}</dd></div>;
}
