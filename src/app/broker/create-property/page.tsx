"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  addDoc,
  collection,
  doc,
  getDoc,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import { uploadImageToCloudinary } from "@/lib/cloudinary";
import { AmenitySelector, NumberStepper, PropertyTypeSelector } from "@/components/AmenitySelector";
import { MapCoordinates, reverseGeocode } from "@/lib/reverseGeocode";
import {
  ChevronLeft,
  Home,
  MapPin,
  PhilippinePeso,
  FileText,
  AlertCircle,
  CheckCircle,
  Loader,
  ImagePlus,
  X,
} from "lucide-react";

const PropertyLocationMap = dynamic(() => import("@/components/PropertyLocationMap"), { ssr: false });
const COVER_PHOTO_CATEGORY = "Cover Photo";
const PHOTO_CATEGORIES = [COVER_PHOTO_CATEGORY, "Bedroom", "Bathroom", "Kitchen", "Living Room", "Exterior"] as const;
type PhotoCategory = typeof PHOTO_CATEGORIES[number];
type PhotoPreview = { file: File; url: string; roomType: PhotoCategory };

const RequiredMark = () => (
  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-600">
    Required
  </span>
);

export default function CreatePropertyPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [location, setLocation] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [propertyType, setPropertyType] = useState("");
  const [beds, setBeds] = useState(1);
  const [baths, setBaths] = useState(1);
  const [amenities, setAmenities] = useState<string[]>([]);
  const [activePhotoCategory, setActivePhotoCategory] = useState<PhotoCategory>(COVER_PHOTO_CATEGORY);
  const [photoPreviews, setPhotoPreviews] = useState<PhotoPreview[]>([]);
  const [resolvingLocation, setResolvingLocation] = useState(false);
  const [locationLookupError, setLocationLookupError] = useState("");
  const lookupRequest = useRef(0);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const photoPreviewUrls = useRef<string[]>([]);
  const priceIsValid = price.trim() !== "" && !Number.isNaN(Number(price));
  const formIsComplete = Boolean(
    title.trim()
    && description.trim()
    && priceIsValid
    && location.trim()
    && propertyType
    && latitude !== null
    && longitude !== null
  );

  useEffect(() => {
    return () => photoPreviewUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const selectPhotos = (files: FileList | null) => {
    if (!files) return;

    const selected = Array.from(files);
    if (!selected.length) return;
    const invalid = selected.find((file) => !file.type.startsWith("image/") || file.size > 10 * 1024 * 1024);
    if (invalid) {
      setError(`${invalid.name} is not a supported image or exceeds 10 MB.`);
      return;
    }

    if (activePhotoCategory === COVER_PHOTO_CATEGORY) {
      const existingCover = photoPreviews.find((preview) => preview.roomType === COVER_PHOTO_CATEGORY);
      if (existingCover) URL.revokeObjectURL(existingCover.url);

      const preview: PhotoPreview = { file: selected[0], roomType: COVER_PHOTO_CATEGORY, url: URL.createObjectURL(selected[0]) };
      const nextPreviews = [preview, ...photoPreviews.filter((item) => item.roomType !== COVER_PHOTO_CATEGORY)];
      photoPreviewUrls.current = nextPreviews.map((item) => item.url);
      setPhotoPreviews(nextPreviews);
      setError(selected.length > 1 ? "Only one cover photo can be selected. The first image was used." : "");
      if (photoInputRef.current) photoInputRef.current.value = "";
      return;
    }

    const remainingSlots = 12 - photoPreviews.length;
    if (remainingSlots <= 0) {
      setError("A maximum of 12 property photos can be added at once.");
      if (photoInputRef.current) photoInputRef.current.value = "";
      return;
    }

    const accepted = selected.slice(0, remainingSlots);
    const previews: PhotoPreview[] = accepted.map((file) => ({ file, roomType: activePhotoCategory, url: URL.createObjectURL(file) }));
    photoPreviewUrls.current = [...photoPreviewUrls.current, ...previews.map((preview) => preview.url)];
    setPhotoPreviews((current) => [...current, ...previews]);
    setError(selected.length > remainingSlots ? "A maximum of 12 property photos can be added at once." : "");
    if (photoInputRef.current) photoInputRef.current.value = "";
  };

  const removePhoto = (index: number) => {
    URL.revokeObjectURL(photoPreviews[index].url);
    const nextPreviews = photoPreviews.filter((_, previewIndex) => previewIndex !== index);
    photoPreviewUrls.current = nextPreviews.map((preview) => preview.url);
    setPhotoPreviews(nextPreviews);
    if (photoInputRef.current) photoInputRef.current.value = "";
  };

  const handlePinChange = async (coordinates: MapCoordinates) => {
    setLatitude(coordinates.latitude);
    setLongitude(coordinates.longitude);
    setError("");
    setLocationLookupError("");
    setResolvingLocation(true);
    const request = ++lookupRequest.current;
    try {
      const address = await reverseGeocode(coordinates);
      if (request === lookupRequest.current) setLocation(address);
    } catch (lookupError) {
      if (request === lookupRequest.current) {
        console.error("Unable to reverse geocode property pin:", lookupError);
        setLocationLookupError("The pin was saved, but its address could not be found automatically. Enter it manually.");
      }
    } finally {
      if (request === lookupRequest.current) setResolvingLocation(false);
    }
  };

  const validateForm = () => {
    if (!title.trim()) {
      setError("Property title is required");
      return false;
    }
    if (!description.trim()) {
      setError("Description is required");
      return false;
    }
    if (!price.trim()) {
      setError("Price is required");
      return false;
    }
    if (isNaN(Number(price))) {
      setError("Price must be a valid number");
      return false;
    }
    if (!location.trim()) {
      setError("Location is required");
      return false;
    }
    if (!propertyType) {
      setError("Choose a property type");
      return false;
    }
    if (latitude === null || longitude === null) {
      setError("Pin the property location on the map");
      return false;
    }
    return true;
  };

  const createProperty = async () => {
    setError("");
    
    if (!validateForm()) return;

    try {
      setLoading(true);
      const user = auth.currentUser;

      if (!user) {
        setError("User not logged in");
        return;
      }

      const brokerSnapshot = await getDoc(doc(db, "users", user.uid));
      if (brokerSnapshot.data()?.verificationStatus !== "verified") {
        setError("Your broker account must be verified before you can publish properties.");
        return;
      }

      const uploadedPhotos = photoPreviews.length
        ? await Promise.all(photoPreviews.map(async (preview) => ({
            roomType: preview.roomType,
            url: await uploadImageToCloudinary(preview.file),
          })))
        : [];

      const coverPhoto = uploadedPhotos.find((photo) => photo.roomType === COVER_PHOTO_CATEGORY);
      const galleryPhotos = uploadedPhotos.filter((photo) => photo.roomType !== COVER_PHOTO_CATEGORY);

      const propertyRef = await addDoc(
        collection(db, "properties"),
        {
          title,
          description,
          price,
          currency: "PHP",
          location,
          latitude,
          longitude,
          brokerId: user.uid,
          propertyType,
          beds,
          baths,
          amenities,
          image: coverPhoto?.url ?? galleryPhotos[0]?.url ?? null,
          availabilityStatus: "available",
          status: "active",
          createdAt: new Date(),
        }
      );

      if (galleryPhotos.length) {
        const groupedPhotos = new Map<PhotoCategory, string[]>();
        galleryPhotos.forEach((photo) => {
          groupedPhotos.set(photo.roomType, [...(groupedPhotos.get(photo.roomType) ?? []), photo.url]);
        });

        await Promise.all(Array.from(groupedPhotos.entries()).map(([roomType, imageUrls]) => addDoc(collection(db, "roomImages"), {
          propertyId: propertyRef.id,
          roomType,
          imageUrls,
          createdAt: new Date(),
        })));
      }

      setSuccess(true);
      
      setTimeout(() => {
        router.push("/broker");
      }, 2000);

    } catch (err: Error | unknown) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto flex items-center justify-between p-6">
          <Link
            href="/broker"
            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ChevronLeft size={20} />
            <span className="font-medium">Back</span>
          </Link>
          <h1 className="text-2xl font-light text-slate-900">Create New Property</h1>
          <div className="w-24" /> {/* Spacer for centering */}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto p-6 lg:p-10">
        {/* Success State */}
        {success && (
          <div className="mb-8 p-4 bg-green-50 border border-green-200 rounded-xl flex items-start gap-3 animate-slide-down">
            <CheckCircle size={20} className="text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-green-900">Property Created Successfully!</p>
              <p className="text-sm text-green-700">Redirecting to dashboard...</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 animate-slide-down">
            <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-900">Error</p>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        )}

        {/* Form Card */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="p-8 lg:p-10">
            <div className="mb-8">
              <h2 className="text-2xl font-light text-slate-900 mb-2">Property Details</h2>
              <p className="text-slate-600">Fill in the information about your property.</p>
            </div>

            <div className="space-y-6">
              {/* Title Field */}
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <Home size={18} className="text-blue-600" />
                    <span>Property Title</span>
                    <RequiredMark />
                  </div>
                </label>
                <input
                  type="text"
                  placeholder="e.g., Modern Downtown Loft"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all"
                />
                <p className="text-xs text-slate-500 mt-2">
                  Give your property a clear, descriptive title
                </p>
              </div>

              {/* Location Field */}
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <MapPin size={18} className="text-blue-600" />
                    <span>Location</span>
                    <RequiredMark />
                  </div>
                </label>
                <input
                  type="text"
                  placeholder="e.g., Downtown District, New York"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all"
                />
                <p className="text-xs text-slate-500 mt-2">
                  Include city, neighborhood, or area details
                </p>
                <div className="mt-4">
                  <PropertyLocationMap latitude={latitude} longitude={longitude} editable onChange={(coordinates) => void handlePinChange(coordinates)} />
                  <div className="mt-3 flex flex-col gap-1 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between"><span>{resolvingLocation ? "Finding the nearest mapped address..." : "Click the map to place the required pin, then drag it for precision."}</span>{latitude !== null && longitude !== null ? <span className="font-mono text-slate-400">{latitude.toFixed(6)}, {longitude.toFixed(6)}</span> : <span className="font-semibold text-blue-600">Map pin required</span>}</div>
                  {locationLookupError && <p className="mt-2 text-xs text-amber-700">{locationLookupError}</p>}
                </div>
              </div>

              {/* Price Field */}
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <PhilippinePeso size={18} className="text-blue-600" />
                    <span>Price</span>
                    <RequiredMark />
                  </div>
                </label>
                <input
                  type="number"
                  placeholder="e.g., 450000"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all"
                />
                <p className="text-xs text-slate-500 mt-2">
                  Enter the listing price in Philippine pesos (PHP)
                </p>
              </div>

              <section className="border-t border-slate-200 pt-7">
                <div className="mb-5"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Listing setup</p><div className="mt-2 flex flex-wrap items-center gap-2"><h3 className="text-xl font-semibold text-slate-900">What kind of place is this?</h3><RequiredMark /></div><p className="mt-1 text-sm text-slate-500">Choose the category buyers will recognize.</p></div>
                <PropertyTypeSelector value={propertyType} onChange={setPropertyType} />
              </section>

              <section className="rounded-2xl border border-slate-200 px-5 py-2">
                <NumberStepper label="Bedrooms" detail="Dedicated sleeping rooms" value={beds} onChange={setBeds} min={0} />
                <NumberStepper label="Bathrooms" detail="Full or shared bathrooms" value={baths} onChange={setBaths} min={0} />
              </section>

              <section className="border-t border-slate-200 pt-7">
                <div className="mb-5"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Amenities</p><h3 className="mt-2 text-xl font-semibold text-slate-900">What does your property offer?</h3><p className="mt-1 text-sm text-slate-500">Select every amenity available to buyers. You can change these later.</p></div>
                <AmenitySelector value={amenities} onChange={setAmenities} />
                <p className="mt-4 text-xs font-medium text-slate-500">{amenities.length} amenit{amenities.length === 1 ? "y" : "ies"} selected</p>
              </section>

              <section className="border-t border-slate-200 pt-7">
                <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Photos</p>
                    <h3 className="mt-2 text-xl font-semibold text-slate-900">Add property photos</h3>
                    <p className="mt-1 text-sm text-slate-500">Optional. Choose Cover Photo for the listing card, or add separate bedroom, bathroom, and room galleries.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-100 px-4 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-200"
                  >
                    <ImagePlus size={17} />
                    Add photos
                  </button>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    multiple={activePhotoCategory !== COVER_PHOTO_CATEGORY}
                    onChange={(event) => selectPhotos(event.target.files)}
                    className="hidden"
                  />
                </div>

                <div className="mb-5 flex flex-wrap gap-2">
                  {PHOTO_CATEGORIES.map((category) => {
                    const count = photoPreviews.filter((preview) => preview.roomType === category).length;
                    const active = activePhotoCategory === category;
                    return (
                      <button
                        key={category}
                        type="button"
                        onClick={() => setActivePhotoCategory(category)}
                        className={`rounded-full px-3 py-2 text-xs font-semibold transition ${active ? "bg-blue-600 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"}`}
                      >
                        {category}{count ? ` (${count})` : ""}
                      </button>
                    );
                  })}
                </div>

                {photoPreviews.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {photoPreviews.map((preview, index) => (
                      <div key={preview.url} className="group relative h-36 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={preview.url} alt={`Property photo ${index + 1}`} className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removePhoto(index)}
                          aria-label={`Remove property photo ${index + 1}`}
                          className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-600 shadow-md transition hover:bg-red-50 hover:text-red-600"
                        >
                          <X size={16} />
                        </button>
                        <div className="absolute bottom-2 left-2 flex flex-wrap gap-1">
                          {preview.roomType === COVER_PHOTO_CATEGORY && <span className="rounded-full bg-blue-600 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white shadow">Used as cover</span>}
                          <span className="rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-semibold text-slate-700 shadow">{preview.roomType}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="flex min-h-36 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-blue-200 bg-blue-50/60 px-5 text-center text-blue-700 transition hover:border-blue-300 hover:bg-blue-50"
                  >
                    <ImagePlus size={28} />
                    <span className="mt-3 text-sm font-semibold">Add {activePhotoCategory.toLowerCase()}</span>
                    <span className="mt-1 text-xs text-blue-600/80">{activePhotoCategory === COVER_PHOTO_CATEGORY ? "Select one image for the listing card cover" : "Upload up to 12 images total, 10 MB each"}</span>
                  </button>
                )}
              </section>

              {/* Description Field */}
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-2">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <FileText size={18} className="text-blue-600" />
                    <span>Description</span>
                    <RequiredMark />
                  </div>
                </label>
                <textarea
                  placeholder="Describe your property in detail. Include amenities, features, condition, and any special characteristics..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-300 focus:ring-1 focus:ring-slate-200 transition-all resize-none"
                />
                <p className="text-xs text-slate-500 mt-2">
                  Provide a comprehensive description to attract buyers
                </p>
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
              onClick={createProperty}
              disabled={loading || !formIsComplete}
              title={!formIsComplete ? "Complete all required fields before creating the property." : undefined}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-8 py-3 font-semibold text-white shadow-lg transition-colors hover:bg-blue-700 hover:shadow-xl disabled:cursor-not-allowed disabled:bg-blue-200 disabled:text-blue-700 disabled:shadow-none sm:w-auto"
            >
              {loading ? (
                <>
                  <Loader size={20} className="animate-spin" />
                  <span>{photoPreviews.length ? "Creating and uploading..." : "Creating..."}</span>
                </>
              ) : (
                <>
                  <Home size={20} />
                  <span>Create Property</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Help Section */}
        <div className="mt-10 rounded-2xl border border-blue-200 bg-blue-50 p-5 sm:p-8">
          <h3 className="text-lg font-semibold text-blue-900 mb-3">
            💡 Tips for Success
          </h3>
          <ul className="space-y-2 text-sm text-blue-800">
            <li className="flex gap-2">
              <span className="text-blue-600 font-semibold">•</span>
              <span>Use clear, descriptive titles that highlight key features</span>
            </li>
            <li className="flex gap-2">
              <span className="text-blue-600 font-semibold">•</span>
              <span>Include important amenities and recent upgrades in the description</span>
            </li>
            <li className="flex gap-2">
              <span className="text-blue-600 font-semibold">•</span>
              <span>Accurate pricing helps attract qualified buyers</span>
            </li>
            <li className="flex gap-2">
              <span className="text-blue-600 font-semibold">•</span>
              <span>You can upload images and create a virtual tour after creating the property</span>
            </li>
          </ul>
        </div>
      </main>
    </div>
  );
}
