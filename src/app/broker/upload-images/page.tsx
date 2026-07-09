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
import {
  ChevronLeft,
  Upload,
  AlertCircle,
  CheckCircle,
  Loader,
  ImageIcon,
  Home,
  X,
  Camera,
  Check,
  Sparkles,
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

export default function UploadImagesPage() {
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<{ file: File; url: string }[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [roomType, setRoomType] = useState("");
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
    if (images.length === 0) {
      setError("Please select at least one image");
      return false;
    }
    if (!selectedProperty) {
      setError("Please select a property");
      return false;
    }
    if (!roomType.trim()) {
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
    const accepted = selected.slice(0, 12);
    const nextPreviews = accepted.map((file) => ({ file, url: URL.createObjectURL(file) }));
    previewUrls.current = nextPreviews.map((preview) => preview.url);
    setImages(accepted);
    setPreviews(nextPreviews);
    if (selected.length > 12) setError("A maximum of 12 gallery photos can be uploaded at once.");
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

      const uploadedUrls: string[] = [];

      for (let i = 0; i < images.length; i++) {
        const file = images[i];

        const formData = new FormData();
        formData.append("file", file);
        formData.append("upload_preset", "libot_uploads");

        const response = await fetch(
          "https://api.cloudinary.com/v1_1/dpnsayn8m/image/upload",
          {
            method: "POST",
            body: formData,
          }
        );

        const data = await response.json();
        if (!response.ok || !data.secure_url) throw new Error(data.error?.message || `Unable to upload ${file.name}.`);
        uploadedUrls.push(data.secure_url);
      }

      await addDoc(
        collection(db, "roomImages"),
        {
          propertyId: selectedProperty,
          roomType: roomType,
          imageUrls: uploadedUrls,
          createdAt: new Date(),
        }
      );

      // Keep the first gallery upload as the listing card cover. Later room
      // uploads do not unexpectedly replace the broker's established cover.
      const propertyRef = doc(db, "properties", selectedProperty);
      const propertySnapshot = await getDoc(propertyRef);
      if (propertySnapshot.exists() && !propertySnapshot.data().image && uploadedUrls[0]) {
        await updateDoc(propertyRef, { image: uploadedUrls[0] });
      }

      setSuccess(true);

      setTimeout(() => {
        clearImages();
        setSelectedProperty("");
        setRoomType("");
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
        <div className="mb-7 flex flex-col gap-4 rounded-3xl bg-slate-900 p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-8"><div className="max-w-2xl"><div className="flex items-center gap-2 text-blue-300"><Camera size={18} /><span className="text-xs font-semibold uppercase tracking-[0.18em]">Visual documentation</span></div><h2 className="mt-3 text-2xl font-semibold sm:text-3xl">Show buyers what every room looks like.</h2><p className="mt-2 text-sm leading-6 text-white/65">Upload front, back, left, right, ceiling, and detail photos here. These images appear in the property gallery and are not used for panorama stitching.</p></div><Link href="/broker/create-tour" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-900"><Sparkles size={17} />Create panorama instead</Link></div>
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
              <p className="mt-2 text-sm text-slate-500">The first photo from the property&apos;s first upload becomes its card cover.</p>
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
                <input
                  type="text"
                  placeholder="e.g., Living Room, Bedroom, Kitchen, Bathroom"
                  value={roomType}
                  onChange={(e) => setRoomType(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all"
                />
                <p className="text-xs text-slate-500 mt-2">
                  Specify which room or area these images belong to
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
                    multiple
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
                      <p className="font-semibold text-slate-900">Choose gallery photos</p>
                      <p className="mt-1 text-sm text-slate-500">JPG, PNG, or WEBP · up to 10 MB each · maximum 12</p>
                    </div>
                  </label>
                </div>

                {previews.length > 0 && (
                  <div className="mt-5"><div className="mb-3 flex items-center justify-between"><p className="text-sm font-semibold text-slate-800">{previews.length} photo{previews.length === 1 ? "" : "s"} selected</p><button type="button" onClick={clearImages} className="text-xs font-semibold text-red-600">Clear all</button></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{previews.map((preview, index) => <article key={`${preview.file.name}-${preview.file.lastModified}`} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="relative aspect-[4/3] bg-slate-100">{/* Blob previews are local browser URLs. */}<img src={preview.url} alt={`Selected gallery photo ${index + 1}`} className="h-full w-full object-cover" />{index === 0 && <span className="absolute left-2 top-2 rounded-full bg-slate-900/85 px-2.5 py-1 text-[9px] font-semibold text-white">COVER</span>}<button type="button" onClick={() => removeImage(index)} aria-label={`Remove ${preview.file.name}`} className="absolute right-2 top-2 rounded-full bg-white/95 p-1.5 text-slate-600 opacity-100 shadow sm:opacity-0 sm:group-hover:opacity-100"><X size={14} /></button></div><div className="p-2.5"><p className="truncate text-xs font-semibold text-slate-700">{preview.file.name}</p><p className="mt-0.5 text-[10px] text-slate-400">{(preview.file.size / 1024 / 1024).toFixed(2)} MB</p></div></article>)}</div></div>
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
              disabled={loading || !selectedProperty || !roomType.trim() || images.length === 0}
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
                  <span>Publish gallery photos</span>
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
