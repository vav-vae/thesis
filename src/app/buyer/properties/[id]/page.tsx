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
  Flag,
  CalendarDays,
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
  const trackedTourOpen = useRef(false);
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

  return (
    <div className="min-h-screen bg-slate-50">
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
            <button className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
              <Share2 size={20} className="text-slate-600" />
            </button>
            <button aria-label={favorites.has(id) ? "Remove from favorites" : "Add to favorites"} disabled={isUpdating(id)} onClick={() => void toggleFavorite(id)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-60">
              <Heart size={20} className={favorites.has(id) ? "fill-red-500 text-red-500" : "text-slate-600"} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-10">
        {favoriteError && <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{favoriteError}</div>}
        {/* Property Header */}
        <div className="mb-10">
          <div className="mb-4 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="mb-3 break-words text-3xl font-light text-slate-900 sm:text-4xl">
                {property.title || "Property Details"}
              </h1>
              <div className="flex items-center gap-2 text-slate-600">
                <MapPin size={18} />
                <p className="text-lg">{property.location || "Location not specified"}</p>
              </div>
              <span className={`mt-4 inline-flex rounded-full px-3 py-1.5 text-xs font-semibold capitalize ${property.availabilityStatus === "sold" ? "bg-slate-900 text-white" : property.availabilityStatus === "reserved" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{property.availabilityStatus ?? "available"}</span>
            </div>
            <div className="shrink-0 text-left sm:text-right">
              <p className="text-sm text-slate-600 mb-1">Starting Price</p>
              <p className="flex items-center gap-1 break-all text-3xl font-semibold text-slate-900 sm:justify-end sm:text-4xl">
                <PhilippinePeso size={28} />
                {property.price || "Contact for price"}
              </p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3"><button onClick={() => { setOfferAmount(property.price ?? ""); setOfferMessage(""); setOfferError(""); setOfferOpen(true); }} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700"><Handshake size={18} />Negotiate price</button><button onClick={() => { setScheduleError(""); setScheduleOpen(true); }} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-5 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-100"><CalendarDays size={18} />Schedule viewing</button><details className="group relative"><summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-xl border border-red-100 px-4 py-3 text-sm font-semibold text-red-600 hover:bg-red-50"><Flag size={16} />Report</summary><div className="absolute left-0 top-[calc(100%+0.5rem)] z-20 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-xl"><ReportButton reporterRole="buyer" targetType="property" targetId={property.id} reportedUserId={property.brokerId} propertyId={property.id} targetLabel={property.title || "this property"} buttonLabel="Report property" className="w-full justify-start rounded-xl px-3 py-2.5 hover:bg-red-50" />{property.brokerId && <ReportButton reporterRole="buyer" targetType="user" targetId={property.brokerId} reportedUserId={property.brokerId} propertyId={property.id} targetLabel="this broker" buttonLabel="Report broker" className="w-full justify-start rounded-xl px-3 py-2.5 hover:bg-red-50" />}</div></details></div>
        </div>

        <section className="mb-10 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
          <div className="grid gap-4 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Property type</p><p className="mt-2 font-semibold text-slate-800">{property.propertyType || "Property"}</p></div><div className="flex items-center gap-3 rounded-xl bg-slate-50 p-4"><BedDouble className="text-blue-600" size={21} /><div><p className="text-xs text-slate-500">Bedrooms</p><p className="font-semibold text-slate-800">{property.beds ?? "Not specified"}</p></div></div><div className="flex items-center gap-3 rounded-xl bg-slate-50 p-4"><Bath className="text-blue-600" size={21} /><div><p className="text-xs text-slate-500">Bathrooms</p><p className="font-semibold text-slate-800">{property.baths ?? "Not specified"}</p></div></div></div>
          {Array.isArray(property.amenities) && property.amenities.length > 0 && <div className="mt-7 border-t border-slate-200 pt-6"><h2 className="text-xl font-semibold text-slate-900">What this property offers</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{property.amenities.map((amenity) => <div key={amenity} className="grid min-h-14 grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600" aria-hidden="true"><Check size={15} strokeWidth={2.25} /></span><span className="min-w-0 leading-5">{AMENITY_LABELS.get(amenity) || amenity}</span></div>)}</div></div>}
        </section>

        {/* Room Images Gallery */}
        {roomImages.length > 0 && (
          <div className="mb-12">
            <h2 className="text-2xl font-light text-slate-900 mb-6">Photo Gallery</h2>
            
            {roomImages.map((room) => (
              <div key={room.id} className="mb-10">
                <div className="flex items-center gap-2 mb-4">
                  <Camera size={20} className="text-slate-600" />
                  <h3 className="text-xl font-semibold text-slate-900">
                    {room.roomType as string}
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(room.imageUrls as string[] | undefined)?.map((url: string, index: number) => (
                    <div
                      key={index}
                      className="group relative rounded-2xl overflow-hidden bg-gradient-to-br from-slate-200 to-slate-300 h-64 border border-slate-200 hover:border-slate-300 transition-all"
                    >
                      <SafeImage
                        src={url}
                        alt={`${room.roomType} - Image ${index + 1}`}
                        fill
                        sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                        className="object-cover transition-transform duration-300 group-hover:scale-110"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

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

        {/* Virtual Tour Section */}
        {roomTours.length > 0 ? (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-col gap-4 border-b border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
              <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">Computer vision reconstruction</p><h2 className="mt-2 text-2xl font-semibold text-slate-900">Explore the 360° virtual tour</h2><p className="mt-2 text-sm text-slate-500">Move around each reconstructed room and switch spaces below.</p></div>
              {!tourOpen && <button onClick={() => void launchTour()} className="shrink-0 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700">Launch virtual tour</button>}
            </div>
            {tourOpen ? <div className="p-4 sm:p-6"><div className="mb-4 flex gap-2 overflow-x-auto pb-1">{roomTours.map((tour) => <button key={tour.id} onClick={() => setSelectedTourId(tour.id)} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition ${selectedTourId === tour.id ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{tour.roomType || "Room"}</button>)}</div>{roomTours.map((tour) => tour.id === selectedTourId && tour.panoramaUrl ? <PanoramaViewer key={tour.id} panorama={tour.panoramaUrl} caption={`${property.title || "Property"} · ${tour.roomType || "Room"}`} /> : null)}<p className="mt-3 text-center text-xs text-slate-400">Drag to look around · Scroll to zoom · Use fullscreen for the most immersive view</p></div> : <div className="flex min-h-80 flex-col items-center justify-center bg-gradient-to-br from-slate-100 to-blue-50 p-10 text-center"><span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm"><Home size={31} /></span><p className="mt-5 font-semibold text-slate-800">{roomTours.length} immersive room{roomTours.length === 1 ? "" : "s"} available</p><p className="mt-2 text-sm text-slate-500">{roomTours.map((tour) => tour.roomType || "Room").join(" · ")}</p></div>}
          </section>
        ) : <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center"><Home className="mx-auto text-slate-300" size={34} /><h2 className="mt-4 text-lg font-semibold text-slate-700">Virtual tour not available yet</h2><p className="mt-2 text-sm text-slate-500">Photo galleries and property details are still available above.</p></section>}
      </main>
      {offerOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"><form onSubmit={startNegotiation} className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Start negotiation</p><h2 className="mt-2 text-2xl font-semibold">Make an offer</h2><p className="mt-1 text-sm text-slate-500">Your proposal will open a private conversation with the property broker.</p></div><button type="button" aria-label="Close" onClick={() => setOfferOpen(false)} disabled={submittingOffer}><X size={21} /></button></div><div className="mt-6 space-y-4"><label className="block text-sm font-semibold text-slate-700">Offer amount (₱)<input required type="number" min="1" value={offerAmount} onChange={(event) => setOfferAmount(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4 font-normal outline-none focus:border-slate-400" /></label><label className="block text-sm font-semibold text-slate-700">Message to broker<textarea value={offerMessage} onChange={(event) => setOfferMessage(event.target.value)} rows={4} placeholder="Introduce yourself or explain your offer..." className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-4 py-3 font-normal outline-none focus:border-slate-400" /></label>{offerError && <p role="alert" className="text-sm text-red-600">{offerError}</p>}</div><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setOfferOpen(false)} disabled={submittingOffer} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600">Cancel</button><button disabled={submittingOffer} className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{submittingOffer ? "Submitting..." : "Submit offer"}</button></div></form></div>}
      {scheduleOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"><form onSubmit={requestViewing} className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Property viewing</p><h2 className="mt-2 text-2xl font-semibold">Request a schedule</h2><p className="mt-1 text-sm text-slate-500">The broker will confirm or reject your proposed appointment.</p></div><button type="button" aria-label="Close" onClick={() => setScheduleOpen(false)} disabled={submittingSchedule}><X size={21} /></button></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-slate-700">Date and time<input required type="datetime-local" min={minimumScheduleAt} value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-3 font-normal outline-none focus:border-blue-400" /></label><label className="text-sm font-semibold text-slate-700">Duration<select value={scheduleDuration} onChange={(event) => setScheduleDuration(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal outline-none focus:border-blue-400"><option value="30">30 minutes</option><option value="60">1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option></select></label><label className="sm:col-span-2 text-sm font-semibold text-slate-700">Notes for the broker<textarea rows={3} value={scheduleNotes} onChange={(event) => setScheduleNotes(event.target.value)} placeholder="Preferred meeting point or questions..." className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-4 py-3 font-normal outline-none focus:border-blue-400" /></label>{scheduleError && <p role="alert" className="sm:col-span-2 text-sm text-red-600">{scheduleError}</p>}</div><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setScheduleOpen(false)} disabled={submittingSchedule} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600">Cancel</button><button disabled={submittingSchedule} className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{submittingSchedule ? "Submitting..." : "Request viewing"}</button></div></form></div>}
    </div>
  );
}
