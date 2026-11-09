"use client";

/* eslint-disable @next/next/no-img-element -- Local blob previews are not served through Next image optimization. */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
} from "firebase/firestore";

import {
  onAuthStateChanged,
} from "firebase/auth";

import {
  auth,
  db,
} from "@/lib/firebase";
import NotificationCenter from "@/components/NotificationCenter";
import { uploadImageToCloudinary } from "@/lib/cloudinary";
import {
  ChevronLeft,
  Upload,
  AlertCircle,
  CheckCircle,
  Loader,
  ImageIcon,
  Home,
  X,
  Check,
} from "lucide-react";

interface Property {
  id: string;
  title?: string;
  description?: string;
  price?: string;
  location?: string;
  brokerId?: string;
  [key: string]: unknown;
}

const COVER_PHOTO_TYPE = "Cover Photo";
const ROOM_TYPES = [COVER_PHOTO_TYPE, "Bedroom", "Bathroom", "Kitchen", "Living Room", "Exterior"] as const;
type RoomTypeChoice = typeof ROOM_TYPES[number] | "Custom";

export default function UploadImagesPage() {
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<{ file: File; url: string }[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [roomTypeChoice, setRoomTypeChoice] = useState<RoomTypeChoice>("Bedroom");
  const [customRoomType, setCustomRoomType] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [propertiesLoading, setPropertiesLoading] = useState(true);
  const previewUrls = useRef<string[]>([]);

  useEffect(() => {
    return () => previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setPropertiesLoading(false);
        return;
      }

      const q = query(
        collection(db, "properties"),
        where("brokerId", "==", user.uid)
      );

      const querySnapshot = await getDocs(q);

      const propertyList: Property[] = [];

      querySnapshot.forEach((doc) => {
        propertyList.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      setProperties(propertyList);
      setPropertiesLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const validateForm = () => {
    const roomType = roomTypeChoice === "Custom" ? customRoomType.trim() : roomTypeChoice;
    if (images.length === 0) {
      setError("Please select at least one image");
      return false;
    }
    if (!selectedProperty) {
      setError("Please select a property");
      return false;
    }
    if (!roomType) {
      setError("Please enter a room type");
      return false;
    }
    return true;
  };

  const selectImages = (selected: File[]) => {
    setError("");
    const invalid = selected.find((file) => !file.type.startsWith("image/") || file.size > 10 * 1024 * 1024);
    if (invalid) {
      setError(`${invalid.name} is not a supported image or exceeds 10 MB.`);
      return;
    }
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    const accepted = roomTypeChoice === COVER_PHOTO_TYPE ? selected.slice(0, 1) : selected.slice(0, 12);
    const nextPreviews = accepted.map((file) => ({ file, url: URL.createObjectURL(file) }));
    previewUrls.current = nextPreviews.map((preview) => preview.url);
    setImages(accepted);
    setPreviews(nextPreviews);
    if (roomTypeChoice === COVER_PHOTO_TYPE && selected.length > 1) setError("Only one cover photo can be selected. The first image was used.");
    else if (selected.length > 12) setError("A maximum of 12 gallery photos can be uploaded at once.");
  };

  const removeImage = (index: number) => {
    URL.revokeObjectURL(previews[index].url);
    const nextImages = images.filter((_, fileIndex) => fileIndex !== index);
    const nextPreviews = previews.filter((_, fileIndex) => fileIndex !== index);
    previewUrls.current = nextPreviews.map((preview) => preview.url);
    setImages(nextImages);
    setPreviews(nextPreviews);
  };

  const clearImages = () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current = [];
    setImages([]);
    setPreviews([]);
  };

  const uploadImages = async () => {
    setError("");
    
    if (!validateForm()) return;

    try {
      setLoading(true);
      const roomType = roomTypeChoice === "Custom" ? customRoomType.trim() : roomTypeChoice;

      const uploadedUrls: string[] = [];

      for (let i = 0; i < images.length; i++) {
        const file = images[i];

        uploadedUrls.push(await uploadImageToCloudinary(file));
      }

      const propertyRef = doc(db, "properties", selectedProperty);
      if (roomType === COVER_PHOTO_TYPE) {
        await updateDoc(propertyRef, { image: uploadedUrls[0] });
      } else {
        await addDoc(
          collection(db, "roomImages"),
          {
            propertyId: selectedProperty,
            roomType: roomType,
            imageUrls: uploadedUrls,
            createdAt: new Date(),
          }
        );

        // Keep the first gallery upload as the listing card cover only when no
        // explicit cover photo has been set.
        const propertySnapshot = await getDoc(propertyRef);
        if (propertySnapshot.exists() && !propertySnapshot.data().image && uploadedUrls[0]) {
          await updateDoc(propertyRef, { image: uploadedUrls[0] });
        }
      }

      setSuccess(true);

      setTimeout(() => {
        clearImages();
        setSelectedProperty("");
        setRoomTypeChoice("Bedroom");
        setCustomRoomType("");
        setSuccess(false);
      }, 3000);

    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Link href="/broker" aria-label="Back to broker dashboard" className="rounded-xl border border-slate-200 p-2.5 text-slate-600 transition hover:bg-slate-50"><ChevronLeft size={19} /></Link>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-600 sm:text-xs">Property media</p>
              <h1 className="mt-1 text-xl font-semibold text-slate-900 sm:text-2xl">Gallery photo upload</h1>
            </div>
          </div>
          <NotificationCenter audience="broker" />
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:py-10">
        <div className="mb-7 flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-medium text-slate-900">Property photos</h2><p className="mt-2 text-sm text-slate-500">Photos added here appear in the property gallery.</p></div><Link href="/broker/create-tour" className="shrink-0 text-sm font-medium text-blue-600 hover:underline">Create a virtual tour</Link></div>
        {/* Success State */}
        {success && (
          <div className="mb-8 p-4 bg-green-50 border border-green-200 rounded-xl flex items-start gap-3 animate-slide-down">
            <CheckCircle size={20} className="text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-green-900">Images Uploaded Successfully!</p>
              <p className="text-sm text-green-700">Your room photos have been added to the property.</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 animate-slide-down">
            <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-900">Upload Error</p>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="p-5 sm:p-8 lg:p-10">
            <div className="mb-8">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Gallery details</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">Choose where these photos belong</h2>
              <p className="mt-2 text-sm text-slate-500">Choose Cover Photo to update the listing card image, or choose a room label for gallery photos.</p>
            </div>

            <div className="space-y-6">
              {/* Property Dropdown */}
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Home size={18} className="text-blue-600" />
                    <span>Select Property</span>
                  </div>
                </label>
                <select
                  value={selectedProperty}
                  onChange={(e) => setSelectedProperty(e.target.value)}
                  disabled={propertiesLoading}
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">
                    {propertiesLoading ? "Loading properties..." : "Choose a property"}
                  </option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.title || "Unnamed Property"}
                    </option>
                  ))}
                </select>
                {properties.length === 0 && !propertiesLoading && (
                  <p className="text-xs text-slate-500 mt-2">
                    No properties found. <Link href="/broker/create-property" className="text-blue-600 hover:underline">Create one first</Link>
                  </p>
                )}
              </div>

              {/* Room Type */}
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">
                  <div className="flex items-center gap-2 mb-2">
                    <ImageIcon size={18} className="text-blue-600" />
                    <span>Room Type</span>
                  </div>
                </label>
                <div className="flex flex-wrap gap-2">
                  {[...ROOM_TYPES, "Custom" as const].map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setRoomTypeChoice(type)}
                      className={`rounded-full px-3 py-2 text-xs font-semibold transition ${roomTypeChoice === type ? "bg-blue-600 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"}`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
                {roomTypeChoice === "Custom" && (
                  <input
                    type="text"
                    placeholder="e.g., Master Bedroom, Balcony, Laundry Area"
                    value={customRoomType}
                    onChange={(e) => setCustomRoomType(e.target.value)}
                    className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 transition-all focus:border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-200"
                  />
                )}
                <p className="text-xs text-slate-500 mt-2">
                  Choose a standard room label so buyer galleries stay organized.
                </p>
              </div>

              {/* File Upload */}
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Upload size={18} className="text-blue-600" />
                    <span>Select Images</span>
                  </div>
                </label>
                <div className="relative">
                  <input
                    type="file"
                    multiple={roomTypeChoice !== COVER_PHOTO_TYPE}
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => { selectImages(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }}
                    className="hidden"
                    id="file-input"
                  />
                  <label
                    htmlFor="file-input"
                    className="flex cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/60 p-8 transition hover:border-blue-400 hover:bg-blue-50/40"
                  >
                    <div className="text-center">
                      <div className="w-12 h-12 mx-auto mb-3 bg-blue-100 rounded-full flex items-center justify-center">
                        <ImageIcon size={24} className="text-blue-600" />
                      </div>
                      <p className="font-semibold text-slate-900">{roomTypeChoice === COVER_PHOTO_TYPE ? "Choose one cover photo" : "Choose gallery photos"}</p>
                      <p className="mt-1 text-sm text-slate-500">JPG, PNG, or WEBP · up to 10 MB each · {roomTypeChoice === COVER_PHOTO_TYPE ? "single cover image" : "maximum 12"}</p>
                    </div>
                  </label>
                </div>

                {previews.length > 0 && (
                  <div className="mt-5"><div className="mb-3 flex items-center justify-between"><p className="text-sm font-semibold text-slate-800">{previews.length} photo{previews.length === 1 ? "" : "s"} selected</p><button type="button" onClick={clearImages} className="text-xs font-semibold text-red-600">Clear all</button></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{previews.map((preview, index) => <article key={`${preview.file.name}-${preview.file.lastModified}`} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="relative aspect-[4/3] bg-slate-100">{/* Blob previews are local browser URLs. */}<img src={preview.url} alt={`Selected gallery photo ${index + 1}`} className="h-full w-full object-cover" />{roomTypeChoice === COVER_PHOTO_TYPE && <span className="absolute left-2 top-2 rounded-full bg-blue-600 px-2.5 py-1 text-[9px] font-semibold text-white">COVER PHOTO</span>}<button type="button" onClick={() => removeImage(index)} aria-label={`Remove ${preview.file.name}`} className="absolute right-2 top-2 rounded-full bg-white/95 p-1.5 text-slate-600 opacity-100 shadow sm:opacity-0 sm:group-hover:opacity-100"><X size={14} /></button></div><div className="p-2.5"><p className="truncate text-xs font-semibold text-slate-700">{preview.file.name}</p><p className="mt-0.5 text-[10px] text-slate-400">{(preview.file.size / 1024 / 1024).toFixed(2)} MB</p></div></article>)}</div></div>
                )}
              </div>
            </div>
          </div>

          {/* Form Footer */}
          <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-8 lg:p-10">
            <Link
              href="/broker"
              className="w-full rounded-xl px-6 py-3 text-center font-medium text-slate-900 transition-colors hover:bg-slate-100 sm:w-auto"
            >
              Cancel
            </Link>
            <button
              onClick={uploadImages}
              disabled={loading || !selectedProperty || !(roomTypeChoice === "Custom" ? customRoomType.trim() : roomTypeChoice) || images.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-8 py-3 font-semibold text-white shadow-lg transition-colors hover:bg-blue-700 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {loading ? (
                <>
                  <Loader size={20} className="animate-spin" />
                  <span>Uploading...</span>
                </>
              ) : (
                <>
                  <Upload size={20} />
                  <span>{roomTypeChoice === COVER_PHOTO_TYPE ? "Update cover photo" : "Publish gallery photos"}</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{["Use bright, even room lighting.", "Capture wide views and useful details.", "Use at least 1920×1080 when possible.", "Keep people and private documents out of frame."].map((tip) => <div key={tip} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><Check size={14} /></span><span className="leading-6">{tip}</span></div>)}</div>
      </main>
    </div>
  );
}
