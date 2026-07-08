"use client";

import { FormEvent, use, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { AlertCircle, ArrowLeft, CheckCircle2, LoaderCircle, MapPin, PhilippinePeso, Save } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { AmenitySelector, NumberStepper, PropertyTypeSelector } from "@/components/AmenitySelector";
import { MapCoordinates, reverseGeocode } from "@/lib/reverseGeocode";

const PropertyLocationMap = dynamic(() => import("@/components/PropertyLocationMap"), { ssr: false });

type FormState = { title: string; description: string; price: string; location: string; latitude: number | null; longitude: number | null; propertyType: string; beds: number; baths: number; amenities: string[] };
const emptyForm: FormState = { title: "", description: "", price: "", location: "", latitude: null, longitude: null, propertyType: "", beds: 1, baths: 1, amenities: [] };

export default function EditPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [resolvingLocation, setResolvingLocation] = useState(false);
  const [locationLookupError, setLocationLookupError] = useState("");
  const lookupRequest = useRef(0);

  useEffect(() => onAuthStateChanged(auth, async (user) => {
    if (!user) {
      router.replace("/login");
      return;
    }
    try {
      const snapshot = await getDoc(doc(db, "properties", id));
      if (!snapshot.exists()) {
        setError("Property not found.");
        setLoading(false);
        return;
      }
      const data = snapshot.data();
      if (data.brokerId !== user.uid) {
        setError("You can only edit your own property listings.");
        setLoading(false);
        return;
      }
      setForm({
        title: data.title ?? "",
        description: data.description ?? "",
        price: String(data.price ?? ""),
        location: data.location ?? "",
        latitude: typeof data.latitude === "number" ? data.latitude : null,
        longitude: typeof data.longitude === "number" ? data.longitude : null,
        propertyType: data.propertyType ?? "",
        beds: Number(data.beds ?? 1),
        baths: Number(data.baths ?? 1),
        amenities: Array.isArray(data.amenities) ? data.amenities.filter((item): item is string => typeof item === "string") : [],
      });
      setAuthorized(true);
    } catch (loadError) {
      console.error("Unable to load property:", loadError);
      setError("Unable to load this property.");
    } finally {
      setLoading(false);
    }
  }), [id, router]);

  const change = (field: keyof FormState, value: string | number | null) => setForm((current) => ({ ...current, [field]: value }));

  const handlePinChange = async (coordinates: MapCoordinates) => {
    setForm((current) => ({ ...current, ...coordinates }));
    setLocationLookupError("");
    setResolvingLocation(true);
    const request = ++lookupRequest.current;
    try {
      const address = await reverseGeocode(coordinates);
      if (request === lookupRequest.current) setForm((current) => ({ ...current, location: address }));
    } catch (lookupError) {
      if (request === lookupRequest.current) {
        console.error("Unable to reverse geocode property pin:", lookupError);
        setLocationLookupError("The pin was updated, but its address could not be found. Enter it manually.");
      }
    } finally {
      if (request === lookupRequest.current) setResolvingLocation(false);
    }
  };

  const saveProperty = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !authorized) return;
    if (!form.title.trim() || !form.description.trim() || !form.location.trim() || !form.price || Number(form.price) <= 0) {
      setError("Complete the title, description, location, and valid price.");
      return;
    }
    if (form.latitude === null || form.longitude === null) {
      setError("Pin the property location on the map.");
      return;
    }
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      await updateDoc(doc(db, "properties", id), {
        title: form.title.trim(),
        description: form.description.trim(),
        price: form.price,
        currency: "PHP",
        location: form.location.trim(),
        latitude: form.latitude,
        longitude: form.longitude,
        propertyType: form.propertyType,
        beds: form.beds,
        baths: form.baths,
        amenities: form.amenities,
        updatedAt: serverTimestamp(),
      });
      setSaved(true);
      window.setTimeout(() => router.push("/broker/properties"), 900);
    } catch (saveError) {
      console.error("Unable to update property:", saveError);
      setError("The property could not be updated.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-50"><LoaderCircle className="animate-spin text-blue-600" size={36} /></div>;
  if (!authorized) return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6"><div className="max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center"><AlertCircle className="mx-auto text-red-500" size={38} /><h1 className="mt-4 text-xl font-semibold">Unable to edit listing</h1><p className="mt-2 text-sm text-slate-500">{error}</p><Link href="/broker/properties" className="mt-6 inline-flex rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white">Back to properties</Link></div></main>;

  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-6 lg:p-10"><div className="mx-auto max-w-4xl"><Link href="/broker/properties" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"><ArrowLeft size={17} />Back to properties</Link><div className="mt-6"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">Listing management</p><h1 className="mt-2 text-3xl font-light">Edit property</h1><p className="mt-2 text-sm text-slate-500">Keep the listing details and map location accurate for buyers.</p></div>
    {error && <div role="alert" className="mt-6 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle size={18} />{error}</div>}{saved && <div role="status" className="mt-6 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><CheckCircle2 size={18} />Listing updated. Returning to your properties…</div>}
    <form onSubmit={saveProperty} className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="space-y-7 p-6 sm:p-8"><div className="grid gap-5 sm:grid-cols-2"><Field label="Property title" value={form.title} onChange={(value) => change("title", value)} /><Field label="Price (PHP)" type="number" value={form.price} onChange={(value) => change("price", value)} icon /><div className="sm:col-span-2"><Field label="Address or area" value={form.location} onChange={(value) => change("location", value)} /></div><label className="sm:col-span-2 text-sm font-semibold text-slate-700">Description<textarea required rows={5} value={form.description} onChange={(event) => change("description", event.target.value)} className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 font-normal text-slate-900 outline-none focus:border-slate-400" /></label></div><section className="border-t border-slate-200 pt-6"><h2 className="mb-4 text-lg font-semibold">Property type</h2><PropertyTypeSelector value={form.propertyType} onChange={(value) => change("propertyType", value)} /></section><section className="rounded-2xl border border-slate-200 px-5 py-2"><NumberStepper label="Bedrooms" detail="Dedicated sleeping rooms" value={form.beds} onChange={(value) => change("beds", value)} /><NumberStepper label="Bathrooms" detail="Full or shared bathrooms" value={form.baths} onChange={(value) => change("baths", value)} /></section><section className="border-t border-slate-200 pt-6"><div className="mb-4"><h2 className="text-lg font-semibold">Amenities</h2><p className="mt-1 text-sm text-slate-500">Keep the listing features accurate for buyers.</p></div><AmenitySelector value={form.amenities} onChange={(amenities) => setForm((current) => ({ ...current, amenities }))} /></section><div><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700"><MapPin size={17} className="text-blue-600" />Property pin</div><PropertyLocationMap latitude={form.latitude} longitude={form.longitude} editable onChange={(coordinates) => void handlePinChange(coordinates)} /><p className="mt-2 text-xs text-slate-500">{resolvingLocation ? "Finding the nearest mapped address…" : "Click or drag the pin to correct the exact location."}</p>{locationLookupError && <p className="mt-2 text-xs text-amber-700">{locationLookupError}</p>}</div></div><div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 p-5 sm:px-8"><Link href="/broker/properties" className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600">Cancel</Link><button disabled={saving || saved} className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Save size={16} />{saving ? "Saving..." : "Save changes"}</button></div></form>
  </div></main>;
}

function Field({ label, value, onChange, type = "text", icon = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; icon?: boolean }) {
  return <label className="text-sm font-semibold text-slate-700">{label}<span className="relative mt-2 block">{icon && <PhilippinePeso size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />}<input required type={type} min={type === "number" ? "1" : undefined} value={value} onChange={(event) => onChange(event.target.value)} className={`h-11 w-full rounded-xl border border-slate-200 bg-white pr-4 font-normal text-slate-900 outline-none focus:border-slate-400 ${icon ? "pl-9" : "pl-4"}`} /></span></label>;
}
