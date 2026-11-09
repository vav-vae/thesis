"use client";

import { use } from "react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

import {
  doc,
  addDoc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  setDoc,
  arrayUnion,
  Timestamp,
  runTransaction,
  increment,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import { useBuyerFavorites } from "@/hooks/useBuyerFavorites";
import { AMENITY_LABELS } from "@/lib/propertyAmenities";
import PanoramaViewer from "@/components/PanoramaViewer";
import ReportButton from "@/components/ReportButton";
import SafeImage from "@/components/SafeImage";

const PropertyLocationMap = dynamic(() => import("@/components/PropertyLocationMap"), { ssr: false });
import {
  ChevronLeft,
  MapPin,
  PhilippinePeso,
  Heart,
  Share2,
  Camera,
  Home,
  Handshake,
  X,
  BedDouble,
  Bath,
  Check,
  CalendarDays,
  Maximize2,
} from "lucide-react";

interface Property {
  id: string;
  title?: string;
  description?: string;
  price?: string;
  location?: string;
  brokerId?: string;
  latitude?: number;
  longitude?: number;
  propertyType?: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  amenities?: string[];
  availabilityStatus?: "available" | "reserved" | "sold";
  [key: string]: unknown;
}

interface RoomImage {
  id: string;
  propertyId?: string;
  roomType?: string;
  imageUrls?: string[];
  [key: string]: unknown;
}

interface RoomTour {
  id: string;
  propertyId?: string;
  roomType?: string;
  panoramaUrl?: string;
  status?: string;
  algorithm?: string;
  metrics?: { coverage_report?: { around_coverage_ratio?: number } };
}

function tourLabel(tour: RoomTour) {
  return (tour.metrics?.coverage_report?.around_coverage_ratio ?? 0) >= 0.95 ? "360° Tour" : "Panorama";
}

export default function PropertyDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {

  const { id } = use(params);
  const router = useRouter();
  const { favorites, toggleFavorite, isUpdating, error: favoriteError } = useBuyerFavorites();
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerAmount, setOfferAmount] = useState("");
  const [offerMessage, setOfferMessage] = useState("");
  const [offerError, setOfferError] = useState("");
  const [roomTours, setRoomTours] = useState<RoomTour[]>([]);
  const [selectedTourId, setSelectedTourId] = useState("");
  const [tourOpen, setTourOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const trackedTourOpen = useRef(false);
  const tourCloseButton = useRef<HTMLButtonElement>(null);
  const photosCloseButton = useRef<HTMLButtonElement>(null);
  const [submittingOffer, setSubmittingOffer] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduleDuration, setScheduleDuration] = useState("60");
  const [scheduleNotes, setScheduleNotes] = useState("");
  const [scheduleError, setScheduleError] = useState("");
  const [submittingSchedule, setSubmittingSchedule] = useState(false);
  const [minimumScheduleAt] = useState(() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });

  // PROPERTY DATA
  const [property, setProperty] =
    useState<Property | null>(null);

  // ROOM IMAGES
  const [roomImages, setRoomImages] =
    useState<RoomImage[]>([]);

  useEffect(() => {

    const fetchProperty = async () => {

      try {

        console.log("PROPERTY ID:", id);

        const docRef = doc(db, "properties", id);
        const roomQuery = query(collection(db, "roomImages"), where("propertyId", "==", id));
        const tourQuery = query(collection(db, "roomTours"), where("propertyId", "==", id));

        const [docSnap, roomSnapshot, tourSnapshot] = await Promise.all([
          getDoc(docRef),
          getDocs(roomQuery),
          getDocs(tourQuery),
        ]);

        if (docSnap.exists()) {
          const propertyData = {
            id: docSnap.id,
            ...docSnap.data(),
          } as Property;
          setProperty(propertyData);

          await auth.authStateReady();
          const buyer = auth.currentUser;
          if (buyer) {
            try {
              const userRef = doc(db, "users", buyer.uid);
              await runTransaction(db, async (transaction) => {
                const userSnapshot = await transaction.get(userRef);
                const stored = userSnapshot.data()?.recentViews;
                const history = Array.isArray(stored) ? stored.filter((item) => item && typeof item.propertyId === "string") : [];
                transaction.update(userRef, {
                  recentViews: [
                    { propertyId: docSnap.id, viewedAt: Timestamp.now() },
                    ...history.filter((item) => item.propertyId !== docSnap.id),
                  ].slice(0, 20),
                });
              });
            } catch (historyError) {
              console.error("Unable to record recent property view:", historyError);
            }
          }

        }

        const roomList: RoomImage[] = [];

        roomSnapshot.forEach((doc) => {

          roomList.push({
            id: doc.id,
            ...doc.data(),
          });

        });

        setRoomImages(roomList);

        const publishedTours = tourSnapshot.docs
          .map((item) => ({ id: item.id, ...item.data() } as RoomTour))
          .filter((tour) => (tour.status ?? "published") === "published" && Boolean(tour.panoramaUrl));
        setRoomTours(publishedTours);
        setSelectedTourId(publishedTours[0]?.id ?? "");

        console.log(roomList);

      } catch (error) {

        console.log(error);

      }
    };

    fetchProperty();

  }, [id]);

  const launchTour = async () => {
    setTourOpen(true);
    if (trackedTourOpen.current) return;
    await auth.authStateReady();
    const buyer = auth.currentUser;
    if (!buyer || !property?.brokerId) return;
    trackedTourOpen.current = true;
    try {
      await setDoc(doc(db, "tourOpens", `${buyer.uid}_${id}`), {
        buyerId: buyer.uid,
        brokerId: property.brokerId,
        propertyId: id,
        propertyTitle: property.title || "Property",
        lastOpenedAt: serverTimestamp(),
        openCount: increment(1),
      }, { merge: true });
    } catch (trackingError) {
      console.error("Unable to record virtual-tour open:", trackingError);
    }
  };

  const shareListing = async () => {
    try {
      if (navigator.share) await navigator.share({ title: property?.title || "LiBot property", url: window.location.href });
      else { await navigator.clipboard.writeText(window.location.href); setShareStatus("Link copied"); }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareStatus("Could not share this listing");
    }
  };

  useEffect(() => {
    if (!tourOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    tourCloseButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setTourOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [tourOpen]);

  useEffect(() => {
    if (!photosOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    photosCloseButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setPhotosOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [photosOpen]);

  // LOADING
  if (!property) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-slate-200 border-t-slate-900" />
      </div>
    );
  }

  const startNegotiation = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (property.availabilityStatus && property.availabilityStatus !== "available") {
      setOfferError(`This property is currently ${property.availabilityStatus} and is not accepting new offers.`);
      return;
    }
    const buyer = auth.currentUser;
    const amount = Number(offerAmount);
    if (!buyer) {
      router.push("/login");
      return;
    }
    if (!property.brokerId) {
      setOfferError("This property does not have an assigned broker.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setOfferError("Enter a valid offer amount.");
      return;
    }
    setSubmittingOffer(true);
    setOfferError("");
    try {
      const negotiationId = `${buyer.uid}_${property.id}`;
      const negotiationRef = doc(db, "negotiations", negotiationId);
      const buyerSnapshot = await getDoc(doc(db, "users", buyer.uid));
      const buyerData = buyerSnapshot.data();
      await setDoc(negotiationRef, {
        propertyId: property.id,
        propertyTitle: property.title || "Property",
        listingPrice: property.price || null,
        buyerId: buyer.uid,
        buyerName: buyerData?.name || [buyerData?.firstName, buyerData?.lastName].filter(Boolean).join(" ") || buyer.displayName || "Buyer",
        brokerId: property.brokerId,
        brokerName: "Property broker",
        status: "active",
        messages: arrayUnion({
          id: crypto.randomUUID(),
          senderId: buyer.uid,
          senderRole: "buyer",
          text: offerMessage.trim() || "I am interested in this property and would like to make an offer.",
          offerAmount: amount,
          createdAt: Timestamp.now(),
        }),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }, { merge: true });
      router.push("/buyer/negotiations");
    } catch (error) {
      console.error("Unable to start negotiation:", error);
      setOfferError("Your offer could not be submitted. Please try again.");
    } finally {
      setSubmittingOffer(false);
    }
  };

  const requestViewing = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const buyer = auth.currentUser;
    const requestedDate = new Date(scheduleAt);
    const durationMinutes = Number(scheduleDuration);
    if (!buyer) { router.push("/login"); return; }
    if (!property.brokerId) { setScheduleError("This property does not have an assigned broker."); return; }
    if (property.availabilityStatus && property.availabilityStatus !== "available") { setScheduleError(`This property is currently ${property.availabilityStatus}.`); return; }
    if (!scheduleAt || Number.isNaN(requestedDate.getTime()) || requestedDate.getTime() <= Date.now()) { setScheduleError("Choose a future date and time."); return; }
    if (![30, 60, 90, 120].includes(durationMinutes)) { setScheduleError("Choose a valid viewing duration."); return; }
    setSubmittingSchedule(true); setScheduleError("");
    try {
      const existing = await getDocs(query(collection(db, "viewingSchedules"), where("buyerId", "==", buyer.uid), where("propertyId", "==", property.id)));
      const duplicate = existing.docs.some((item) => {
        const data = item.data();
        return ["pending", "confirmed"].includes(data.status) && data.scheduledAt?.toMillis?.() === requestedDate.getTime();
      });
      if (duplicate) throw new Error("You already requested this viewing time.");
      const [buyerSnapshot, brokerSnapshot] = await Promise.all([getDoc(doc(db, "users", buyer.uid)), getDoc(doc(db, "users", property.brokerId))]);
      const buyerData = buyerSnapshot.data(); const brokerData = brokerSnapshot.data();
      await addDoc(collection(db, "viewingSchedules"), {
        propertyId: property.id,
        propertyTitle: property.title || "Property",
        propertyLocation: property.location || "",
        buyerId: buyer.uid,
        buyerName: buyerData?.name || [buyerData?.firstName, buyerData?.lastName].filter(Boolean).join(" ") || buyer.displayName || "Buyer",
        brokerId: property.brokerId,
        brokerName: brokerData?.name || [brokerData?.firstName, brokerData?.lastName].filter(Boolean).join(" ") || "Property broker",
        scheduledAt: Timestamp.fromDate(requestedDate),
        durationMinutes,
        status: "pending",
        notes: scheduleNotes.trim(),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      setScheduleOpen(false); setScheduleAt(""); setScheduleNotes("");
      router.push("/buyer/calendar");
    } catch (requestError) {
      setScheduleError(requestError instanceof Error ? requestError.message : "The viewing request could not be submitted.");
    } finally { setSubmittingSchedule(false); }
  };

  const photoUrls = roomImages.flatMap((room) => room.imageUrls ?? []);

  return (
    <div className="min-h-screen bg-[#faf8f3]">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:p-6">
          <Link
            href="/buyer/properties"
            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ChevronLeft size={20} />
            <span className="font-medium">Back</span>
          </Link>

          <div className="flex items-center gap-3">
            <button onClick={() => void shareListing()} aria-label="Share property" className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
              <Share2 size={20} className="text-slate-600" />
            </button>
            <button aria-label={favorites.has(id) ? "Remove from favorites" : "Add to favorites"} disabled={isUpdating(id)} onClick={() => void toggleFavorite(id)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-60">
              <Heart size={20} className={favorites.has(id) ? "fill-red-500 text-red-500" : "text-slate-600"} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl p-4 pb-24 sm:p-6 lg:p-10">
        {favoriteError && <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{favoriteError}</div>}
        {shareStatus && <div role="status" className="mb-4 text-sm text-teal-800">{shareStatus}</div>}
        <div className="mb-6"><h1 className="break-words text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{property.title || "Property details"}</h1><p className="mt-2 flex items-center gap-2 text-sm text-slate-600"><MapPin size={16} />{property.location || "Location not specified"}</p></div>
        <section className="relative mb-10 overflow-hidden rounded-2xl bg-slate-200" aria-label="Property photos">
          {photoUrls.length > 0 ? <div className={`grid h-80 grid-cols-1 gap-1 sm:h-[32rem] ${photoUrls.length >= 5 ? "sm:grid-cols-4 sm:grid-rows-2" : photoUrls.length >= 2 ? "sm:grid-cols-2" : ""}`}>{photoUrls.slice(0, photoUrls.length >= 5 ? 5 : 2).map((url, index) => <button key={`${url}:${index}`} type="button" onClick={() => setPhotosOpen(true)} aria-label={`Open photo ${index + 1}`} className={`group relative overflow-hidden bg-slate-200 ${index === 0 && photoUrls.length >= 5 ? "sm:col-span-2 sm:row-span-2" : index === 0 ? "" : "hidden sm:block"}`}><SafeImage src={url} alt={`${property.title || "Property"} photo ${index + 1}`} fill priority={index === 0} sizes={index === 0 ? "(min-width: 640px) 50vw, 100vw" : "25vw"} className="object-cover transition-transform duration-150 group-hover:scale-[1.02] motion-reduce:transform-none" /></button>)}</div> : <div className="flex h-80 items-center justify-center text-slate-400"><Home size={52} /></div>}
          <div className="absolute inset-x-0 bottom-0 flex flex-wrap gap-2 bg-gradient-to-t from-slate-950/75 to-transparent p-4 pt-16 sm:p-6 sm:pt-20">{roomTours.length > 0 && <button onClick={() => void launchTour()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#07585b] px-5 py-3 text-sm font-semibold text-white transition duration-150 hover:bg-[#06494b]"><Maximize2 size={18} />Explore Virtual Tour</button>}<button onClick={() => setPhotosOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition duration-150 hover:bg-slate-100"><Camera size={18} />View All Photos</button></div>
        </section>
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]"><div className="min-w-0">
        <div className="mb-8 border-b border-slate-200 pb-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold text-slate-600">{property.propertyType || "Property"} in {property.location || "Iloilo"}</p><p className="mt-2 text-sm text-slate-500">{property.beds ?? "—"} beds · {property.baths ?? "—"} baths · {property.sqft != null ? `${property.sqft} sqft` : "Floor area not specified"}</p></div><div><p className="text-xs text-slate-500">Starting price</p><p className="mt-1 flex items-center text-3xl font-semibold text-slate-900"><PhilippinePeso size={26} />{property.price || "Contact for price"}</p></div></div><div className="mt-4 flex items-center justify-between"><span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-semibold capitalize ${property.availabilityStatus === "sold" ? "bg-slate-900 text-white" : property.availabilityStatus === "reserved" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{property.availabilityStatus ?? "available"}</span><details className="group relative"><summary className="cursor-pointer list-none text-xs font-semibold text-slate-500 hover:text-red-600">Report listing</summary><div className="absolute right-0 top-[calc(100%+0.5rem)] z-20 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-xl"><ReportButton reporterRole="buyer" targetType="property" targetId={property.id} reportedUserId={property.brokerId} propertyId={property.id} targetLabel={property.title || "this property"} buttonLabel="Report property" className="w-full justify-start rounded-xl px-3 py-2.5 hover:bg-red-50" /></div></details></div></div>

        <section className="mb-10 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
          <div className="grid gap-4 sm:grid-cols-2"><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Property type</p><p className="mt-2 font-semibold text-slate-800">{property.propertyType || "Property"}</p></div><div className="flex items-center gap-3 rounded-xl bg-slate-50 p-4"><BedDouble className="text-blue-600" size={21} /><div><p className="text-xs text-slate-500">Bedrooms</p><p className="font-semibold text-slate-800">{property.beds ?? "Not specified"}</p></div></div><div className="flex items-center gap-3 rounded-xl bg-slate-50 p-4"><Bath className="text-blue-600" size={21} /><div><p className="text-xs text-slate-500">Bathrooms</p><p className="font-semibold text-slate-800">{property.baths ?? "Not specified"}</p></div></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Floor area</p><p className="mt-2 font-semibold text-slate-800">{property.sqft != null ? `${property.sqft} sqft` : "Not specified"}</p></div></div>
          {Array.isArray(property.amenities) && property.amenities.length > 0 && <div className="mt-7 border-t border-slate-200 pt-6"><h2 className="text-xl font-semibold text-slate-900">What this property offers</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{property.amenities.map((amenity) => <div key={amenity} className="grid min-h-14 grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600" aria-hidden="true"><Check size={15} strokeWidth={2.25} /></span><span className="min-w-0 leading-5">{AMENITY_LABELS.get(amenity) || amenity}</span></div>)}</div></div>}
        </section>

        {/* Description Section */}
        {property.description && (
          <div className="mb-12 rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
            <h2 className="text-2xl font-light text-slate-900 mb-4">About this Property</h2>
            <p className="text-slate-600 leading-relaxed text-lg">
              {property.description}
            </p>
          </div>
        )}

        {typeof property.latitude === "number" && typeof property.longitude === "number" && <section className="mb-12 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8"><div className="mb-5"><div className="flex items-center gap-2"><MapPin size={19} className="text-blue-600" /><h2 className="text-2xl font-light text-slate-900">Property Location</h2></div><p className="mt-2 text-sm text-slate-500">{property.location || "Location provided by the broker"}</p></div><PropertyLocationMap latitude={property.latitude} longitude={property.longitude} /><a href={`https://www.openstreetmap.org/?mlat=${property.latitude}&mlon=${property.longitude}#map=17/${property.latitude}/${property.longitude}`} target="_blank" rel="noreferrer" className="mt-4 inline-flex text-sm font-semibold text-blue-600 hover:text-blue-700">Open larger map →</a></section>}

        {roomTours.length > 0 && <section className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="text-xl font-semibold text-slate-900">Virtual tour</h2><p className="mt-1 text-sm text-slate-500">Explore {roomTours.length} room{roomTours.length === 1 ? "" : "s"} in Panorama view.</p><button onClick={() => void launchTour()} className="mt-4 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700">Explore Virtual Tour</button></section>}
        </div>
        <aside className="sticky top-24 hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:block"><p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Property broker</p><h2 className="mt-2 text-lg font-semibold text-slate-900">Interested in this property?</h2><p className="mt-2 text-sm text-slate-500">Ask a question or arrange a viewing.</p><button onClick={() => { setOfferAmount(property.price ?? ""); setOfferMessage(""); setOfferError(""); setOfferOpen(true); }} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white"><Handshake size={17} />Contact Broker</button><button onClick={() => { setScheduleError(""); setScheduleOpen(true); }} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700"><CalendarDays size={17} />Schedule viewing</button></aside>
        </div>
      </main>
      {photosOpen && <div role="dialog" aria-modal="true" aria-label="All property photos" className="fixed inset-0 z-[80] overflow-y-auto bg-[#faf8f3] text-slate-900"><div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:px-8"><button ref={photosCloseButton} onClick={() => setPhotosOpen(false)} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-slate-100"><ChevronLeft size={18} />Back to listing</button><span className="text-sm font-semibold">{roomImages.reduce((total, room) => total + (room.imageUrls?.length ?? 0), 0)} photos</span></div><div className="mx-auto max-w-5xl space-y-10 px-4 py-8 sm:px-8"><h2 className="text-2xl font-semibold">{property.title || "Property"} photos</h2>{roomImages.map((room) => <section key={room.id}><h3 className="mb-4 text-lg font-semibold">{room.roomType || "Room"}</h3><div className="grid gap-3 sm:grid-cols-2">{room.imageUrls?.map((url, index) => <div key={`${url}:${index}`} className="relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-200"><SafeImage src={url} alt={`${room.roomType || "Room"} photo ${index + 1}`} fill sizes="(min-width: 640px) 50vw, 100vw" className="object-cover" /></div>)}</div></section>)}</div></div>}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white p-3 shadow-lg lg:hidden"><button onClick={() => { setOfferAmount(property.price ?? ""); setOfferMessage(""); setOfferError(""); setOfferOpen(true); }} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white"><Handshake size={18} />Contact Broker</button></div>
      {tourOpen && <div role="dialog" aria-modal="true" aria-label="Virtual tour" className="fixed inset-0 z-[80] flex flex-col bg-slate-950 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/15 px-4 py-3 sm:px-6"><div><p className="text-xs font-semibold uppercase tracking-wider text-teal-200">{tourLabel(roomTours.find((tour) => tour.id === selectedTourId) ?? roomTours[0])}</p><h2 className="text-lg font-semibold">{property.title || "Virtual tour"}</h2></div><button ref={tourCloseButton} onClick={() => setTourOpen(false)} className="flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold hover:bg-white/10"><X size={18} />Back to listing</button></div>
        <div className="flex gap-3 overflow-x-auto border-b border-white/15 px-4 py-3 sm:px-6" role="tablist" aria-label="Tour rooms">{roomTours.map((tour) => <button key={tour.id} role="tab" aria-selected={selectedTourId === tour.id} onClick={() => setSelectedTourId(tour.id)} className={`flex shrink-0 items-center gap-3 rounded-xl border p-2 text-left transition duration-150 ${selectedTourId === tour.id ? "border-teal-300 bg-white/15" : "border-white/15 hover:bg-white/10"}`}><span className="relative h-12 w-16 overflow-hidden rounded-lg bg-white/10"><SafeImage src={tour.panoramaUrl || ""} alt="" fill sizes="64px" className="object-cover" /></span><span><span className="block text-sm font-semibold">{tour.roomType || "Room"}</span><span className="block text-xs text-white/60">{tourLabel(tour)}</span></span></button>)}</div>
        <div className="min-h-0 flex-1 p-3 sm:p-5">{roomTours.map((tour) => tour.id === selectedTourId && tour.panoramaUrl ? <PanoramaViewer key={tour.id} panorama={tour.panoramaUrl} caption={`${tour.roomType || "Room"} ${tourLabel(tour)}`} fullScreen /> : null)}</div><p className="pb-4 text-center text-sm text-white/70">Drag to look around</p>
      </div>}
      {offerOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"><form onSubmit={startNegotiation} className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Start negotiation</p><h2 className="mt-2 text-2xl font-semibold">Make an offer</h2><p className="mt-1 text-sm text-slate-500">Your proposal will open a private conversation with the property broker.</p></div><button type="button" aria-label="Close" onClick={() => setOfferOpen(false)} disabled={submittingOffer}><X size={21} /></button></div><div className="mt-6 space-y-4"><label className="block text-sm font-semibold text-slate-700">Offer amount (₱)<input required type="number" min="1" value={offerAmount} onChange={(event) => setOfferAmount(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4 font-normal outline-none focus:border-slate-400" /></label><label className="block text-sm font-semibold text-slate-700">Message to broker<textarea value={offerMessage} onChange={(event) => setOfferMessage(event.target.value)} rows={4} placeholder="Introduce yourself or explain your offer..." className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-4 py-3 font-normal outline-none focus:border-slate-400" /></label>{offerError && <p role="alert" className="text-sm text-red-600">{offerError}</p>}</div><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setOfferOpen(false)} disabled={submittingOffer} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600">Cancel</button><button disabled={submittingOffer} className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{submittingOffer ? "Submitting..." : "Submit offer"}</button></div></form></div>}
      {scheduleOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"><form onSubmit={requestViewing} className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Property viewing</p><h2 className="mt-2 text-2xl font-semibold">Request a schedule</h2><p className="mt-1 text-sm text-slate-500">The broker will confirm or reject your proposed appointment.</p></div><button type="button" aria-label="Close" onClick={() => setScheduleOpen(false)} disabled={submittingSchedule}><X size={21} /></button></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-slate-700">Date and time<input required type="datetime-local" min={minimumScheduleAt} value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-3 font-normal outline-none focus:border-blue-400" /></label><label className="text-sm font-semibold text-slate-700">Duration<select value={scheduleDuration} onChange={(event) => setScheduleDuration(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal outline-none focus:border-blue-400"><option value="30">30 minutes</option><option value="60">1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option></select></label><label className="sm:col-span-2 text-sm font-semibold text-slate-700">Notes for the broker<textarea rows={3} value={scheduleNotes} onChange={(event) => setScheduleNotes(event.target.value)} placeholder="Preferred meeting point or questions..." className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-4 py-3 font-normal outline-none focus:border-blue-400" /></label>{scheduleError && <p role="alert" className="sm:col-span-2 text-sm text-red-600">{scheduleError}</p>}</div><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setScheduleOpen(false)} disabled={submittingSchedule} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600">Cancel</button><button disabled={submittingSchedule} className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{submittingSchedule ? "Submitting..." : "Request viewing"}</button></div></form></div>}
    </div>
  );
}
