"use client";

/* eslint-disable @next/next/no-img-element -- Newly selected files use local blob preview URLs. */

import { FormEvent, use, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { AlertCircle, ArrowLeft, Camera, CheckCircle2, ImagePlus, LoaderCircle, MapPin, PhilippinePeso, Save, Star, Trash2, Upload, X } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { AmenitySelector, NumberStepper, PropertyTypeSelector } from "@/components/AmenitySelector";
import SafeImage from "@/components/SafeImage";
import { uploadImageToCloudinary } from "@/lib/cloudinary";
import { MapCoordinates, reverseGeocode } from "@/lib/reverseGeocode";

const PropertyLocationMap = dynamic(() => import("@/components/PropertyLocationMap"), { ssr: false });

type FormState = { title: string; description: string; price: string; location: string; latitude: number | null; longitude: number | null; propertyType: string; beds: number; baths: number; amenities: string[] };
type GalleryDocument = { id: string; roomType: string; imageUrls: string[] };
type PreviewPhoto = { file: File; url: string };
type NewPhoto = PreviewPhoto & { roomType: string };

const emptyForm: FormState = { title: "", description: "", price: "", location: "", latitude: null, longitude: null, propertyType: "", beds: 1, baths: 1, amenities: [] };
const MAX_GALLERY_IMAGES = 12;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_CATEGORIES = ["Bedroom", "Bathroom", "Kitchen", "Living Room", "Dining Room", "Exterior", "Balcony", "Other"] as const;

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
  const [coverUrl, setCoverUrl] = useState("");
  const [removeCover, setRemoveCover] = useState(false);
  const [newCover, setNewCover] = useState<PreviewPhoto | null>(null);
  const [galleryDocuments, setGalleryDocuments] = useState<GalleryDocument[]>([]);
  const [removedGalleryUrls, setRemovedGalleryUrls] = useState<Set<string>>(new Set());
  const [newGallery, setNewGallery] = useState<NewPhoto[]>([]);
  const [addPhotosOpen, setAddPhotosOpen] = useState(false);
  const [photoCategory, setPhotoCategory] = useState<string>("Bedroom");
  const [customPhotoCategory, setCustomPhotoCategory] = useState("");
  const lookupRequest = useRef(0);
  const previewUrls = useRef<string[]>([]);

  useEffect(() => () => previewUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  useEffect(() => onAuthStateChanged(auth, async (user) => {
    if (!user) {
      router.replace("/login");
      return;
    }
    try {
      const [snapshot, gallerySnapshot] = await Promise.all([
        getDoc(doc(db, "properties", id)),
        getDocs(query(collection(db, "roomImages"), where("propertyId", "==", id))),
      ]);
      if (!snapshot.exists()) {
        setError("Property not found.");
        return;
      }
      const data = snapshot.data();
      if (data.brokerId !== user.uid) {
        setError("You can only edit your own property listings.");
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
      setCoverUrl(typeof data.image === "string" ? data.image : "");
      setGalleryDocuments(gallerySnapshot.docs.map((item) => {
        const gallery = item.data();
        return {
          id: item.id,
          roomType: typeof gallery.roomType === "string" ? gallery.roomType : "Gallery",
          imageUrls: Array.isArray(gallery.imageUrls) ? gallery.imageUrls.filter((url): url is string => typeof url === "string") : [],
        };
      }));
      setAuthorized(true);
    } catch (loadError) {
      console.error("Unable to load property:", loadError);
      setError("Unable to load this property and its photos.");
    } finally {
      setLoading(false);
    }
  }), [id, router]);

  const change = (field: keyof FormState, value: string | number | null) => setForm((current) => ({ ...current, [field]: value }));
  const visibleGalleryCount = galleryDocuments.flatMap((item) => item.imageUrls).filter((url) => !removedGalleryUrls.has(url)).length + newGallery.length;

  const validatePhoto = (file: File) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return "Use a JPG, PNG, or WEBP image.";
    if (file.size > MAX_IMAGE_BYTES) return `${file.name} exceeds the 10 MB limit.`;
    return "";
  };

  const chooseCover = (file?: File) => {
    if (!file) return;
    const issue = validatePhoto(file);
    if (issue) { setError(issue); return; }
    if (newCover) URL.revokeObjectURL(newCover.url);
    const url = URL.createObjectURL(file);
    previewUrls.current.push(url);
    setNewCover({ file, url });
    setRemoveCover(false);
    setError("");
  };

  const chooseGallery = (files: File[]) => {
    setError("");
    const roomType = photoCategory === "Other" ? customPhotoCategory.trim() : photoCategory;
    if (!roomType) { setError("Enter a category name before choosing photos."); return; }
    const remaining = MAX_GALLERY_IMAGES - visibleGalleryCount;
    if (remaining <= 0) { setError(`A property gallery can contain up to ${MAX_GALLERY_IMAGES} images.`); return; }
    const accepted: NewPhoto[] = [];
    for (const file of files.slice(0, remaining)) {
      const issue = validatePhoto(file);
      if (issue) { setError(issue); continue; }
      const url = URL.createObjectURL(file);
      previewUrls.current.push(url);
      accepted.push({ file, url, roomType });
    }
    setNewGallery((current) => [...current, ...accepted]);
    if (accepted.length) {
      setAddPhotosOpen(false);
      setCustomPhotoCategory("");
    }
    if (files.length > remaining) setError(`Only ${remaining} more image${remaining === 1 ? "" : "s"} could be added. The gallery limit is ${MAX_GALLERY_IMAGES}.`);
  };

  const removeNewGallery = (index: number) => {
    setNewGallery((current) => {
      URL.revokeObjectURL(current[index].url);
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  };

  const toggleExistingGallery = (url: string) => {
    setRemovedGalleryUrls((current) => {
      const next = new Set(current);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

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
      const [uploadedCover, uploadedGallery] = await Promise.all([
        newCover ? uploadImageToCloudinary(newCover.file) : Promise.resolve(""),
        Promise.all(newGallery.map((photo) => uploadImageToCloudinary(photo.file))),
      ]);

      await Promise.all(galleryDocuments.map(async (gallery) => {
        const remainingUrls = gallery.imageUrls.filter((url) => !removedGalleryUrls.has(url));
        if (remainingUrls.length) {
          if (remainingUrls.length !== gallery.imageUrls.length) await updateDoc(doc(db, "roomImages", gallery.id), { imageUrls: remainingUrls, updatedAt: serverTimestamp() });
        } else {
          await deleteDoc(doc(db, "roomImages", gallery.id));
        }
      }));

      if (uploadedGallery.length) {
        const groupedUploads = new Map<string, string[]>();
        uploadedGallery.forEach((url, index) => {
          const roomType = newGallery[index].roomType;
          groupedUploads.set(roomType, [...(groupedUploads.get(roomType) ?? []), url]);
        });
        await Promise.all(Array.from(groupedUploads.entries()).map(([roomType, imageUrls]) => addDoc(collection(db, "roomImages"), {
          propertyId: id,
          roomType,
          imageUrls,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })));
      }

      const remainingExistingGallery = galleryDocuments.flatMap((gallery) => gallery.imageUrls).filter((url) => !removedGalleryUrls.has(url));
      const galleryFallback = remainingExistingGallery[0] || uploadedGallery[0] || "";
      const currentCoverWasRemovedFromGallery = removedGalleryUrls.has(coverUrl);
      const nextCover = uploadedCover || (removeCover || currentCoverWasRemovedFromGallery ? galleryFallback || null : coverUrl || galleryFallback || null);

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
        image: nextCover,
        updatedAt: serverTimestamp(),
      });
      setSaved(true);
      window.setTimeout(() => router.push("/broker/properties"), 1000);
    } catch (saveError) {
      console.error("Unable to update property:", saveError);
      setError("The property or its photos could not be updated. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-50"><LoaderCircle className="animate-spin text-blue-600" size={36} /></div>;
  if (!authorized) return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6"><div className="max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center"><AlertCircle className="mx-auto text-red-500" size={38} /><h1 className="mt-4 text-xl font-semibold">Unable to edit listing</h1><p className="mt-2 text-sm text-slate-500">{error}</p><Link href="/broker/properties" className="mt-6 inline-flex rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white">Back to properties</Link></div></main>;

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-5xl">
        <Link href="/broker/properties" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"><ArrowLeft size={17} />Back to properties</Link>
        <div className="mt-6"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">Listing management</p><h1 className="mt-2 text-3xl font-light">Edit property</h1><p className="mt-2 text-sm text-slate-500">Update listing details, cover photo, gallery, and map location.</p></div>
        {error && <div role="alert" className="mt-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle className="mt-0.5 shrink-0" size={18} /><span>{error}</span></div>}
        {saved && <div role="status" className="mt-6 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><CheckCircle2 size={18} />Listing and photos updated. Returning to your properties…</div>}

        <form onSubmit={saveProperty} className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="space-y-8 p-5 sm:p-8">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Property title" value={form.title} onChange={(value) => change("title", value)} />
              <Field label="Price (PHP)" type="number" value={form.price} onChange={(value) => change("price", value)} icon />
              <div className="sm:col-span-2"><Field label="Address or area" value={form.location} onChange={(value) => change("location", value)} /></div>
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Description<textarea required rows={5} value={form.description} onChange={(event) => change("description", event.target.value)} className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 font-normal text-slate-900 outline-none focus:border-slate-400" /></label>
            </div>

            <section className="border-t border-slate-200 pt-7">
              <div className="mb-5"><div className="flex items-center gap-2"><Camera className="text-blue-600" size={20} /><h2 className="text-lg font-semibold">Cover photo</h2></div><p className="mt-1 text-sm text-slate-500">This image appears on property cards and at the top of the buyer listing.</p></div>
              <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
                <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                  {newCover ? <img src={newCover.url} alt="New property cover preview" className="h-full w-full object-cover" /> : coverUrl && !removeCover ? <SafeImage src={coverUrl} alt="Current property cover" fill sizes="224px" className="object-cover" /> : <div className="flex h-full flex-col items-center justify-center text-slate-400"><ImagePlus size={30} /><span className="mt-2 text-xs font-semibold">No cover photo</span></div>}
                  {(newCover || (coverUrl && !removeCover)) && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-blue-600 px-2.5 py-1 text-[10px] font-semibold text-white"><Star size={11} fill="currentColor" />COVER</span>}
                </div>
                <div className="flex flex-col justify-center gap-3">
                  <label className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 sm:w-fit"><Upload size={17} />{coverUrl || newCover ? "Replace cover photo" : "Add cover photo"}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => { chooseCover(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
                  {(newCover || (coverUrl && !removeCover)) && <button type="button" onClick={() => { if (newCover) URL.revokeObjectURL(newCover.url); setNewCover(null); setRemoveCover(true); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 sm:w-fit"><Trash2 size={16} />Remove cover</button>}
                  {removeCover && coverUrl && <button type="button" onClick={() => setRemoveCover(false)} className="text-left text-xs font-semibold text-blue-600">Undo cover removal</button>}
                  <p className="text-xs text-slate-400">JPG, PNG, or WEBP · maximum 10 MB</p>
                </div>
              </div>
            </section>

            <section className="border-t border-slate-200 pt-7">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div><div className="flex items-center gap-2"><ImagePlus className="text-blue-600" size={20} /><h2 className="text-lg font-semibold">Property gallery</h2></div><p className="mt-1 text-sm text-slate-500">Add or remove room and property images. Changes apply when you save.</p></div>
                <button type="button" onClick={() => setAddPhotosOpen(true)} disabled={visibleGalleryCount >= MAX_GALLERY_IMAGES} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"><ImagePlus size={17} />Add images</button>
              </div>
              <p className="mt-3 text-xs font-medium text-slate-500">{visibleGalleryCount} of {MAX_GALLERY_IMAGES} gallery images</p>
              {(galleryDocuments.some((item) => item.imageUrls.length) || newGallery.length) ? (
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {galleryDocuments.flatMap((gallery) => gallery.imageUrls.map((url) => ({ ...gallery, url }))).map((image) => {
                    const removed = removedGalleryUrls.has(image.url);
                    return <article key={`${image.id}-${image.url}`} className={`group overflow-hidden rounded-2xl border bg-white ${removed ? "border-red-200 opacity-50" : "border-slate-200"}`}><div className="relative aspect-[4/3] bg-slate-100"><SafeImage src={image.url} alt={`${image.roomType} property image`} fill sizes="(min-width: 1024px) 25vw, 50vw" className="object-cover" /><button type="button" onClick={() => toggleExistingGallery(image.url)} aria-label={removed ? "Restore image" : "Remove image"} className={`absolute right-2 top-2 rounded-full p-2 shadow ${removed ? "bg-blue-600 text-white" : "bg-white/95 text-red-600"}`}>{removed ? <RotateUndoIcon /> : <Trash2 size={15} />}</button>{removed && <span className="absolute inset-x-2 bottom-2 rounded-lg bg-red-600/90 px-2 py-1 text-center text-[10px] font-semibold text-white">REMOVED ON SAVE</span>}</div><p className="truncate px-3 py-2 text-xs font-semibold text-slate-600">{image.roomType}</p></article>;
                  })}
                  {newGallery.map((photo, index) => <article key={photo.url} className="group overflow-hidden rounded-2xl border border-blue-200 bg-white"><div className="relative aspect-[4/3] bg-slate-100"><img src={photo.url} alt={`New ${photo.roomType} image ${index + 1}`} className="h-full w-full object-cover" /><span className="absolute left-2 top-2 rounded-full bg-blue-600 px-2 py-1 text-[9px] font-semibold text-white">NEW</span><button type="button" onClick={() => removeNewGallery(index)} aria-label={`Remove new gallery image ${index + 1}`} className="absolute right-2 top-2 rounded-full bg-white/95 p-2 text-red-600 shadow"><X size={15} /></button></div><div className="px-3 py-2"><p className="truncate text-xs font-semibold text-slate-700">{photo.roomType}</p><p className="mt-0.5 truncate text-[10px] text-slate-400">{photo.file.name}</p></div></article>)}
                </div>
              ) : <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center"><ImagePlus className="mx-auto text-slate-300" size={32} /><p className="mt-3 text-sm font-semibold text-slate-600">No gallery images yet</p><p className="mt-1 text-xs text-slate-400">Add wide room photos to help buyers understand the property.</p></div>}
            </section>

            <section className="border-t border-slate-200 pt-7"><h2 className="mb-4 text-lg font-semibold">Property type</h2><PropertyTypeSelector value={form.propertyType} onChange={(value) => change("propertyType", value)} /></section>
            <section className="rounded-2xl border border-slate-200 px-5 py-2"><NumberStepper label="Bedrooms" detail="Dedicated sleeping rooms" value={form.beds} onChange={(value) => change("beds", value)} /><NumberStepper label="Bathrooms" detail="Full or shared bathrooms" value={form.baths} onChange={(value) => change("baths", value)} /></section>
            <section className="border-t border-slate-200 pt-7"><div className="mb-4"><h2 className="text-lg font-semibold">Amenities</h2><p className="mt-1 text-sm text-slate-500">Keep the listing features accurate for buyers.</p></div><AmenitySelector value={form.amenities} onChange={(amenities) => setForm((current) => ({ ...current, amenities }))} /></section>
            <div><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700"><MapPin size={17} className="text-blue-600" />Property pin</div><PropertyLocationMap latitude={form.latitude} longitude={form.longitude} editable onChange={(coordinates) => void handlePinChange(coordinates)} /><p className="mt-2 text-xs text-slate-500">{resolvingLocation ? "Finding the nearest mapped address…" : "Click or drag the pin to correct the exact location."}</p>{locationLookupError && <p className="mt-2 text-xs text-amber-700">{locationLookupError}</p>}</div>
          </div>
          <div className="sticky bottom-0 flex flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50/95 p-5 backdrop-blur sm:flex-row sm:justify-end sm:px-8"><Link href="/broker/properties" className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-center text-sm font-semibold text-slate-600">Cancel</Link><button disabled={saving || saved} className="inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}{saving ? "Uploading and saving…" : "Save changes"}</button></div>
        </form>
      </div>
      {addPhotosOpen && <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:items-center sm:p-4"><div role="dialog" aria-modal="true" aria-labelledby="add-photo-title" className="w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Organize gallery</p><h2 id="add-photo-title" className="mt-2 text-2xl font-semibold">Choose a photo category</h2><p className="mt-1 text-sm leading-6 text-slate-500">All photos selected next will be grouped under this room or area.</p></div><button type="button" onClick={() => setAddPhotosOpen(false)} aria-label="Close add photos" className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button></div><div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">{PHOTO_CATEGORIES.map((category) => <button key={category} type="button" onClick={() => setPhotoCategory(category)} aria-pressed={photoCategory === category} className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold ${photoCategory === category ? "border-blue-600 bg-blue-50 text-blue-700 ring-1 ring-blue-600" : "border-slate-200 text-slate-600 hover:border-blue-200 hover:bg-blue-50/50"}`}>{category}</button>)}</div>{photoCategory === "Other" && <label className="mt-4 block text-sm font-semibold text-slate-700">Custom category<input autoFocus value={customPhotoCategory} onChange={(event) => setCustomPhotoCategory(event.target.value)} placeholder="e.g., Home office" className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4 font-normal outline-none focus:border-blue-400" /></label>}<label className={`mt-6 flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 ${photoCategory === "Other" && !customPhotoCategory.trim() ? "pointer-events-none opacity-40" : ""}`}><Upload size={17} />Choose {photoCategory === "Other" ? customPhotoCategory.trim() || "category" : photoCategory} photos<input type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => { chooseGallery(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} /></label><p className="mt-3 text-center text-xs text-slate-400">You can repeat this process for another room category.</p></div></div>}
    </main>
  );
}

function RotateUndoIcon() {
  return <ArrowLeft size={15} />;
}

function Field({ label, value, onChange, type = "text", icon = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; icon?: boolean }) {
  return <label className="text-sm font-semibold text-slate-700">{label}<span className="relative mt-2 block">{icon && <PhilippinePeso size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />}<input required type={type} min={type === "number" ? "1" : undefined} value={value} onChange={(event) => onChange(event.target.value)} className={`h-11 w-full rounded-xl border border-slate-200 bg-white pr-4 font-normal text-slate-900 outline-none focus:border-slate-400 ${icon ? "pl-9" : "pl-4"}`} /></span></label>;
}
