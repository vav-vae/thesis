"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  Bell,
  CalendarDays,
  Camera,
  ChevronRight,
  Mail,
  MapPin,
  Phone,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, where } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { isRemoteImageUrl, uploadImageToCloudinary } from "@/lib/cloudinary";
import { useBuyerFavorites } from "@/hooks/useBuyerFavorites";

type BuyerProfile = {
  uid: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  preferredPropertyType?: string;
  budgetRange?: string;
  preferredProvince?: string;
  preferredCity?: string;
  profilePicture?: string | null;
  occupation?: string | null;
  shortBio?: string | null;
  termsAccepted?: boolean;
  privacyPolicyAccepted?: boolean;
  role?: string;
  createdAt?: Timestamp | Date | { toDate?: () => Date };
};

type EditProfileForm = {
  firstName: string;
  lastName: string;
  phone: string;
  occupation: string;
  shortBio: string;
  preferredPropertyType: string;
  budgetRange: string;
  preferredProvince: string;
  preferredCity: string;
};

const emptyEditForm: EditProfileForm = {
  firstName: "",
  lastName: "",
  phone: "",
  occupation: "",
  shortBio: "",
  preferredPropertyType: "",
  budgetRange: "",
  preferredProvince: "",
  preferredCity: "",
};

type ActivityItem = { id: string; title: string; detail: string; href: string; timestamp?: Timestamp; kind: "view" | "negotiation" };

const activityTime = (value?: Timestamp) => {
  if (!value?.toDate) return "Recently";
  const minutes = Math.max(0, Math.floor((Date.now() - value.toDate().getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : value.toDate().toLocaleDateString("en-PH", { month: "short", day: "numeric" });
};

export default function BuyerProfilePage() {
  const [buyer, setBuyer] = useState<BuyerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditProfileForm>(emptyEditForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [profilePictureFile, setProfilePictureFile] = useState<File | null>(null);
  const [profilePicturePreview, setProfilePicturePreview] = useState("");
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [viewedCount, setViewedCount] = useState(0);
  const [inquiryCount, setInquiryCount] = useState(0);
  const { favoriteIds } = useBuyerFavorites();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser: User | null) => {
      if (!currentUser) {
        setBuyer(null);
        setRecentActivity([]);
        setViewedCount(0);
        setInquiryCount(0);
        setActivityLoading(false);
        setLoading(false);
        return;
      }

      try {
        const userDoc = await getDoc(doc(db, "users", currentUser.uid));
        const data = userDoc.data();
        const fallbackName = [data?.firstName, data?.lastName].filter(Boolean).join(" ");

        setBuyer({
          uid: currentUser.uid,
          firstName: data?.firstName,
          lastName: data?.lastName,
          name: data?.name ?? currentUser.displayName ?? (fallbackName || "Buyer"),
          email: data?.email ?? currentUser.email ?? "Not available",
          phone: data?.phone,
          preferredPropertyType: data?.preferredPropertyType ?? data?.propertyType,
          budgetRange: data?.budgetRange,
          preferredProvince: data?.preferredProvince,
          preferredCity: data?.preferredCity,
          profilePicture: isRemoteImageUrl(data?.profilePicture) ? data.profilePicture : null,
          occupation: data?.occupation ?? null,
          shortBio: data?.shortBio ?? null,
          termsAccepted: data?.termsAccepted,
          privacyPolicyAccepted: data?.privacyPolicyAccepted,
          role: data?.role ?? "buyer",
          createdAt: data?.createdAt,
        });

        const allStoredViews = Array.isArray(data?.recentViews)
          ? data.recentViews.filter((item: unknown): item is { propertyId: string; viewedAt?: Timestamp } => Boolean(item && typeof item === "object" && "propertyId" in item && typeof (item as { propertyId?: unknown }).propertyId === "string"))
          : [];
        setViewedCount(allStoredViews.length);
        const storedViews = allStoredViews.slice(0, 8);
        const [viewItems, negotiationSnapshot] = await Promise.all([
          Promise.all(storedViews.map(async (view: { propertyId: string; viewedAt?: Timestamp }): Promise<ActivityItem | null> => {
            const propertySnapshot = await getDoc(doc(db, "properties", view.propertyId));
            if (!propertySnapshot.exists()) return null;
            const property = propertySnapshot.data();
            return { id: `view:${view.propertyId}`, title: `Viewed ${property.title || "a property"}`, detail: property.location || "Location not specified", href: `/buyer/properties/${view.propertyId}`, timestamp: view.viewedAt, kind: "view" };
          })),
          getDocs(query(collection(db, "negotiations"), where("buyerId", "==", currentUser.uid))),
        ]);
        const negotiationItems: ActivityItem[] = negotiationSnapshot.docs.map((item) => {
          const negotiation = item.data();
          const status = negotiation.status ?? "active";
          const action = status === "accepted" ? "Offer accepted" : status === "rejected" ? "Offer declined" : "Negotiation updated";
          const latestOffer = Array.isArray(negotiation.messages) ? [...negotiation.messages].reverse().find((message: { offerAmount?: number }) => message.offerAmount)?.offerAmount : null;
          return {
            id: `negotiation:${item.id}`,
            title: `${action}: ${negotiation.propertyTitle || "Property"}`,
            detail: latestOffer ? `Latest proposal: ₱${Number(latestOffer).toLocaleString("en-PH")}` : "Open the conversation for details",
            href: "/buyer/negotiations",
            timestamp: negotiation.updatedAt ?? negotiation.createdAt,
            kind: "negotiation",
          };
        });
        setInquiryCount(negotiationSnapshot.size);
        setRecentActivity([...viewItems.filter((item): item is ActivityItem => item !== null), ...negotiationItems]
          .sort((a, b) => (b.timestamp?.toMillis?.() ?? 0) - (a.timestamp?.toMillis?.() ?? 0))
          .slice(0, 8));
      } catch (error) {
        console.log(error);
        setBuyer({
          uid: currentUser.uid,
          firstName: undefined,
          lastName: undefined,
          name: currentUser.displayName ?? "Buyer",
          email: currentUser.email ?? "Not available",
          role: "buyer",
        });
        setRecentActivity([]);
        setViewedCount(0);
        setInquiryCount(0);
      } finally {
        setActivityLoading(false);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    return () => {
      if (profilePicturePreview.startsWith("blob:")) {
        URL.revokeObjectURL(profilePicturePreview);
      }
    };
  }, [profilePicturePreview]);

  const openEditProfile = () => {
    if (!buyer) return;

    setEditForm({
      firstName: buyer.firstName ?? "",
      lastName: buyer.lastName ?? "",
      phone: buyer.phone ?? "",
      occupation: buyer.occupation ?? "",
      shortBio: buyer.shortBio ?? "",
      preferredPropertyType: buyer.preferredPropertyType ?? "",
      budgetRange: buyer.budgetRange ?? "",
      preferredProvince: buyer.preferredProvince ?? "",
      preferredCity: buyer.preferredCity ?? "",
    });
    setProfilePictureFile(null);
    setProfilePicturePreview(buyer.profilePicture ?? "");
    setSaveError("");
    setEditing(true);
  };

  const handleEditChange = (field: keyof EditProfileForm, value: string) => {
    setEditForm((current) => ({ ...current, [field]: value }));
  };

  const closeEditProfile = () => {
    setEditing(false);
    setProfilePictureFile(null);
    setProfilePicturePreview("");
  };

  const handleProfilePictureChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setSaveError("Please choose a valid image file.");
      event.target.value = "";
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setSaveError("Profile pictures must be 5 MB or smaller.");
      event.target.value = "";
      return;
    }

    setProfilePictureFile(file);
    setProfilePicturePreview(URL.createObjectURL(file));
    setSaveError("");
  };

  const handleSaveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!buyer || saving) return;

    const cleanedForm = Object.fromEntries(
      Object.entries(editForm).map(([key, value]) => [key, value.trim()]),
    ) as EditProfileForm;

    if (!cleanedForm.firstName || !cleanedForm.lastName) {
      setSaveError("First name and last name are required.");
      return;
    }

    setSaving(true);
    setSaveError("");

    try {
      const fullName = `${cleanedForm.firstName} ${cleanedForm.lastName}`;
      let profilePicture = buyer.profilePicture ?? null;

      if (profilePictureFile) {
        profilePicture = await uploadImageToCloudinary(profilePictureFile);
      }

      await setDoc(
        doc(db, "users", buyer.uid),
        { ...cleanedForm, name: fullName, profilePicture, updatedAt: serverTimestamp() },
        { merge: true },
      );
      setBuyer((current) => current ? { ...current, ...cleanedForm, name: fullName, profilePicture } : current);
      closeEditProfile();
    } catch (error) {
      console.error("Unable to update buyer profile:", error);
      setSaveError("Unable to save your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const storedFullName = [buyer?.firstName?.trim(), buyer?.lastName?.trim()].filter(Boolean).join(" ");
  const buyerName = storedFullName || buyer?.name?.trim() || "John Reyes";
  const buyerEmail = buyer?.email ?? "john.reyes@example.com";
  const buyerPhone = buyer?.phone ?? "+63 917 555 0192";
  const buyerLocation = [buyer?.preferredProvince, buyer?.preferredCity].filter(Boolean).join(", ") || "Metro Manila, Philippines";
  const buyerBudget = buyer?.budgetRange ?? "PHP 2M - PHP 8M";
  const buyerPropertyType = buyer?.preferredPropertyType ?? "Condo, House & Lot";
  const buyerOccupation = buyer?.occupation ?? "Not specified";
  const buyerBio = buyer?.shortBio ?? "Add a short bio to help brokers understand your goals.";
  const buyerProfilePicture = buyer?.profilePicture ? "Uploaded" : "No profile picture uploaded";
  const termsStatus = buyer?.termsAccepted && buyer?.privacyPolicyAccepted ? "Accepted" : "Pending";
  const memberSince = buyer?.createdAt
    ? "toDate" in buyer.createdAt && typeof buyer.createdAt.toDate === "function"
      ? buyer.createdAt.toDate().toLocaleDateString("en-US", { month: "long", year: "numeric" })
      : buyer.createdAt instanceof Date
        ? buyer.createdAt.toLocaleDateString("en-US", { month: "long", year: "numeric" })
        : "Recently"
    : "March 2026";

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.08),_transparent_45%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.10),_transparent_35%)] pointer-events-none" />

      <main className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <Link
            href="/buyer"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm hover:border-slate-300 hover:text-slate-900"
          >
            <ArrowLeft size={16} />
            Back to dashboard
          </Link>

          <button
            type="button"
            onClick={openEditProfile}
            disabled={!buyer}
            className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Settings size={16} />
            Edit profile
          </button>
        </div>

        {editing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
            <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-5 sm:px-8">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">Edit profile</h2>
                  <p className="mt-1 text-sm text-slate-500">Keep your buyer details and preferences up to date.</p>
                </div>
                <button
                  type="button"
                  onClick={closeEditProfile}
                  disabled={saving}
                  aria-label="Close edit profile"
                  className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveProfile} className="space-y-7 p-6 sm:p-8">
                <div className="flex flex-col items-center gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:flex-row">
                  <div
                    role={profilePicturePreview ? "img" : undefined}
                    aria-label={profilePicturePreview ? "Profile picture preview" : undefined}
                    style={profilePicturePreview ? { backgroundImage: `url(${profilePicturePreview})` } : undefined}
                    className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-white bg-cover bg-center text-slate-400 shadow-sm ring-1 ring-slate-200"
                  >
                    {!profilePicturePreview && <UserRound size={38} />}
                  </div>
                  <div className="flex-1 text-center sm:text-left">
                    <h3 className="font-semibold text-slate-900">Profile picture</h3>
                    <p className="mt-1 text-sm text-slate-500">Choose a JPG, PNG, or WebP image up to 5 MB.</p>
                    <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                      <Camera size={16} />
                      {profilePicturePreview ? "Change photo" : "Upload photo"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={handleProfilePictureChange}
                        disabled={saving}
                        className="sr-only"
                      />
                    </label>
                  </div>
                </div>

                <div>
                  <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">Personal details</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {([
                      ["firstName", "First name", "Your first name"],
                      ["lastName", "Last name", "Your last name"],
                      ["phone", "Mobile number", "+63 900 000 0000"],
                      ["occupation", "Occupation", "Your occupation"],
                    ] as const).map(([field, label, placeholder]) => (
                      <label key={field} className="block text-sm font-medium text-slate-700">
                        {label}
                        <input
                          value={editForm[field]}
                          onChange={(event) => handleEditChange(field, event.target.value)}
                          placeholder={placeholder}
                          required={field === "firstName" || field === "lastName"}
                          disabled={saving}
                          className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-100 disabled:opacity-60"
                        />
                      </label>
                    ))}
                  </div>
                  <label className="mt-4 block text-sm font-medium text-slate-700">
                    Short bio
                    <textarea
                      value={editForm.shortBio}
                      onChange={(event) => handleEditChange("shortBio", event.target.value)}
                      placeholder="Tell brokers a little about what you are looking for."
                      rows={4}
                      maxLength={300}
                      disabled={saving}
                      className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-100 disabled:opacity-60"
                    />
                    <span className="mt-1 block text-right text-xs text-slate-400">{editForm.shortBio.length}/300</span>
                  </label>
                </div>

                <div>
                  <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">Property preferences</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {([
                      ["preferredPropertyType", "Property type", "Condo, house and lot, etc."],
                      ["budgetRange", "Budget range", "PHP 2M - PHP 8M"],
                      ["preferredProvince", "Preferred province", "Province"],
                      ["preferredCity", "Preferred city", "City"],
                    ] as const).map(([field, label, placeholder]) => (
                      <label key={field} className="block text-sm font-medium text-slate-700">
                        {label}
                        <input
                          value={editForm[field]}
                          onChange={(event) => handleEditChange(field, event.target.value)}
                          placeholder={placeholder}
                          disabled={saving}
                          className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-100 disabled:opacity-60"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                {saveError && (
                  <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</p>
                )}

                <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeEditProfile}
                    disabled={saving}
                    className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? "Saving..." : "Save changes"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <section className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-5">
                <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 to-slate-600 p-1 shadow-lg">
                  <div
                    role={buyer?.profilePicture ? "img" : undefined}
                    aria-label={buyer?.profilePicture ? `${buyerName}'s profile picture` : undefined}
                    style={buyer?.profilePicture ? { backgroundImage: `url(${buyer.profilePicture})` } : undefined}
                    className="flex h-full w-full items-center justify-center overflow-hidden rounded-[1.35rem] bg-white bg-cover bg-center"
                  >
                    {!buyer?.profilePicture && <UserRound size={42} className="text-slate-900" />}
                  </div>
                </div>

                <div>
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    <BadgeCheck size={14} />
                    Verified buyer
                  </div>
                  <h1 className="text-3xl font-light tracking-tight text-slate-900 sm:text-4xl">
                    {buyerName}
                  </h1>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600 sm:text-base">
                    {buyerBio}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
                <div>
                  <p className="text-2xl font-light text-slate-900">{viewedCount}</p>
                  <p className="text-xs text-slate-500">Viewed</p>
                </div>
                <div>
                  <p className="text-2xl font-light text-slate-900">{favoriteIds.length}</p>
                  <p className="text-xs text-slate-500">Saved</p>
                </div>
                <div>
                  <p className="text-2xl font-light text-slate-900">{inquiryCount}</p>
                  <p className="text-xs text-slate-500">Inquiries</p>
                </div>
              </div>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Mail size={16} className="text-slate-500" />
                  Contact Email
                </div>
                <p className="text-sm text-slate-600">{buyerEmail}</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Phone size={16} className="text-slate-500" />
                  Mobile Number
                </div>
                <p className="text-sm text-slate-600">{buyerPhone}</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <MapPin size={16} className="text-slate-500" />
                  Preferred Location
                </div>
                <p className="text-sm text-slate-600">{buyerLocation}</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <CalendarDays size={16} className="text-slate-500" />
                  Buyer Since
                </div>
                <p className="text-sm text-slate-600">{memberSince}</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:col-span-2">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <UserRound size={16} className="text-slate-500" />
                  Profile Details
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Occupation</p>
                    <p className="mt-2 text-sm text-slate-600">{buyerOccupation}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Profile Picture</p>
                    <p className="mt-2 text-sm text-slate-600">{buyerProfilePicture}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Terms Status</p>
                    <p className="mt-2 text-sm text-slate-600">{termsStatus}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <aside className="space-y-6">
            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-5 flex items-center gap-2">
                <Sparkles size={18} className="text-slate-500" />
                <h2 className="text-lg font-semibold text-slate-900">Search Preferences</h2>
              </div>

              <div className="space-y-4">
                {[
                  { label: "Budget Range", value: buyerBudget },
                  { label: "Property Type", value: buyerPropertyType },
                  { label: "Preferred Location", value: buyerLocation },
                  { label: "Occupation", value: buyerOccupation },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl border border-slate-200 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {item.label}
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-900">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[2rem] border border-slate-200 bg-slate-900 p-6 text-white shadow-sm">
              <div className="mb-4 flex items-center gap-2 text-white/80">
                <ShieldCheck size={18} />
                <h2 className="text-lg font-semibold text-white">Account Status</h2>
              </div>

              <p className="text-sm leading-6 text-white/70">
                {buyer?.role === "buyer"
                  ? "Your account is active, secured, and ready for property discovery. Notifications and broker messages are enabled."
                  : "Your buyer account details are currently unavailable. Please sign in again to refresh your profile."}
              </p>

              <div className="mt-6 space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/60">Notifications</span>
                  <span className="font-medium text-white">Enabled</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/60">Profile visibility</span>
                  <span className="font-medium text-white">Private</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/60">Saved searches</span>
                  <span className="font-medium text-white">4 active</span>
                </div>
              </div>
            </div>
          </aside>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="mb-5 flex items-center gap-2">
              <Bell size={18} className="text-slate-500" />
              <h2 className="text-lg font-semibold text-slate-900">Recent Activity</h2>
            </div>

            {activityLoading ? <div className="space-y-3">{[1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-2xl border border-slate-200 bg-slate-50" />)}</div> : recentActivity.length > 0 ? <div className="space-y-4">
              {recentActivity.map((item) => (
                <Link href={item.href} key={item.id} className="flex items-start gap-4 rounded-2xl border border-slate-200 p-4 transition hover:border-slate-300 hover:bg-slate-50">
                  <div className={`mt-1 h-3 w-3 rounded-full ${item.kind === "view" ? "bg-blue-500" : "bg-emerald-500"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">{item.title}</p>
                        <p className="mt-1 text-sm text-slate-600">{item.detail}</p>
                      </div>
                      <span className="shrink-0 text-xs font-medium text-slate-400">{activityTime(item.timestamp)}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div> : <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-9 text-center"><Bell className="mx-auto text-slate-300" size={28} /><p className="mt-3 text-sm font-semibold text-slate-700">No recent activity yet</p><p className="mt-1 text-xs leading-5 text-slate-500">Viewed properties and negotiation updates will appear here.</p></div>}
          </div>

            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="mb-5 flex items-center gap-2">
                <ChevronRight size={18} className="text-slate-500" />
                <h2 className="text-lg font-semibold text-slate-900">Location Snapshot</h2>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Primary Area</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{buyerLocation}</p>
              </div>

            <div className="mt-8 rounded-3xl bg-gradient-to-br from-slate-900 to-slate-700 p-6 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/60">
                Next step
              </p>
              <h3 className="mt-3 text-2xl font-light">
                Continue exploring properties that match your budget and preferred locations.
              </h3>
              <Link
                href="/buyer/properties"
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
              >
                Browse properties
                <ChevronRight size={16} />
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
