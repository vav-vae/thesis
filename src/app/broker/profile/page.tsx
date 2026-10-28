"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  FileBadge,
  FileCheck2,
  Camera,
  LoaderCircle,
  Mail,
  MapPin,
  Phone,
  Pencil,
  Save,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, Timestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { isRemoteImageUrl, uploadImageToCloudinary } from "@/lib/cloudinary";

type BrokerProfile = {
  uid: string;
  name: string;
  email: string;
  phone?: string;
  profilePhoto?: string | null;
  agencyName?: string;
  position?: string;
  prcLicense?: string | null;
  experience?: string;
  serviceArea?: string;
  governmentId?: string | null;
  prcLicenseFile?: string | null;
  role?: string;
  createdAt?: Timestamp | Date | { toDate?: () => Date };
};

type EditForm = {
  name: string;
  phone: string;
  agencyName: string;
  position: string;
  experience: string;
  serviceArea: string;
};

const emptyEditForm: EditForm = { name: "", phone: "", agencyName: "", position: "", experience: "", serviceArea: "" };

export default function BrokerProfilePage() {
  const [broker, setBroker] = useState<BrokerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");
  const [editForm, setEditForm] = useState<EditForm>(emptyEditForm);
  const [profileFile, setProfileFile] = useState<File | null>(null);
  const [profilePreview, setProfilePreview] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser: User | null) => {
      if (!currentUser) {
        setBroker(null);
        setLoading(false);
        return;
      }

      try {
        const userSnapshot = await getDoc(doc(db, "users", currentUser.uid));
        const data = userSnapshot.data();

        setBroker({
          uid: currentUser.uid,
          name: data?.name ?? currentUser.displayName ?? "Broker",
          email: data?.email ?? currentUser.email ?? "Not available",
          phone: data?.phone,
          profilePhoto: isRemoteImageUrl(data?.profilePhoto) ? data.profilePhoto : null,
          agencyName: data?.agencyName,
          position: data?.position,
          prcLicense: data?.prcLicense ?? null,
          experience: data?.experience,
          serviceArea: data?.serviceArea,
          governmentId: data?.governmentId ?? null,
          prcLicenseFile: data?.prcLicenseFile ?? null,
          role: data?.role,
          createdAt: data?.createdAt,
        });
      } catch (error) {
        console.error("Unable to load broker profile:", error);
        setBroker(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => () => {
    if (profilePreview.startsWith("blob:")) URL.revokeObjectURL(profilePreview);
  }, [profilePreview]);

  const openEditProfile = () => {
    if (!broker) return;
    setEditForm({
      name: broker.name,
      phone: broker.phone ?? "",
      agencyName: broker.agencyName ?? "",
      position: broker.position ?? "",
      experience: broker.experience ?? "",
      serviceArea: broker.serviceArea ?? "",
    });
    setProfileFile(null);
    setProfilePreview(broker.profilePhoto ?? "");
    setSaveError("");
    setSaveSuccess("");
    setEditing(true);
  };

  const closeEditProfile = () => {
    if (saving) return;
    setEditing(false);
    setProfileFile(null);
    setProfilePreview("");
    setSaveError("");
  };

  const changeEdit = (field: keyof EditForm, value: string) => setEditForm((current) => ({ ...current, [field]: value }));

  const chooseProfilePhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setSaveError("Choose a JPG, PNG, or WEBP profile image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setSaveError("The profile image must be 5 MB or smaller.");
      return;
    }
    if (profilePreview.startsWith("blob:")) URL.revokeObjectURL(profilePreview);
    setProfileFile(file);
    setProfilePreview(URL.createObjectURL(file));
    setSaveError("");
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!broker || saving) return;
    const next = {
      name: editForm.name.trim(),
      phone: editForm.phone.trim(),
      agencyName: editForm.agencyName.trim(),
      position: editForm.position.trim(),
      experience: editForm.experience.trim(),
      serviceArea: editForm.serviceArea.trim(),
    };
    if (!next.name || !next.phone || !next.agencyName || !next.position || !next.experience || !next.serviceArea) {
      setSaveError("Complete all broker profile fields.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const uploadedPhoto = profileFile ? await uploadImageToCloudinary(profileFile) : broker.profilePhoto ?? null;
      await updateDoc(doc(db, "users", broker.uid), {
        ...next,
        profilePhoto: uploadedPhoto,
        profilePicture: uploadedPhoto,
        updatedAt: serverTimestamp(),
      });
      setBroker((current) => current ? { ...current, ...next, profilePhoto: uploadedPhoto } : current);
      setEditing(false);
      setProfileFile(null);
      setProfilePreview("");
      setSaveSuccess("Profile updated successfully.");
      window.setTimeout(() => setSaveSuccess(""), 3500);
    } catch (error) {
      console.error("Unable to update broker profile:", error);
      setSaveError("Your profile could not be updated. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" />
      </div>
    );
  }

  if (!broker) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <UserRound className="mx-auto text-slate-400" size={42} />
          <h1 className="mt-4 text-2xl font-semibold text-slate-900">Profile unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">Sign in again to load your broker profile.</p>
          <Link href="/login" className="mt-6 inline-flex rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white">
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  const memberSince = broker.createdAt
    ? "toDate" in broker.createdAt && typeof broker.createdAt.toDate === "function"
      ? broker.createdAt.toDate().toLocaleDateString("en-US", { month: "long", year: "numeric" })
      : broker.createdAt instanceof Date
        ? broker.createdAt.toLocaleDateString("en-US", { month: "long", year: "numeric" })
        : "Recently"
    : "Recently";
  const hasGovernmentId = Boolean(broker.governmentId);
  const hasLicense = Boolean(broker.prcLicense || broker.prcLicenseFile);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-slate-200" />

      <main className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <Link href="/broker" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm hover:text-slate-900">
            <ArrowLeft size={16} />
            Back to dashboard
          </Link>
          <button type="button" onClick={openEditProfile} className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"><Pencil size={16} />Edit profile</button>
        </div>
        {saveSuccess && <div role="status" className="mb-6 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700"><CheckCircleIcon />{saveSuccess}</div>}

        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
          <div className="h-24 border-b border-slate-700 bg-slate-900 sm:h-28" />
          <div className="px-6 pb-8 sm:px-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
                <div className="-mt-12 rounded-3xl bg-white p-1.5 shadow-lg">
                  <div
                    role={broker.profilePhoto ? "img" : undefined}
                    aria-label={broker.profilePhoto ? `${broker.name}'s profile picture` : undefined}
                    style={broker.profilePhoto ? { backgroundImage: `url(${broker.profilePhoto})` } : undefined}
                    className="flex h-28 w-28 items-center justify-center rounded-[1.25rem] bg-slate-100 bg-cover bg-center text-slate-500 sm:h-32 sm:w-32"
                  >
                    {!broker.profilePhoto && <UserRound size={48} />}
                  </div>
                </div>
                <div className="pb-1">
                  <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                    <BadgeCheck size={14} />
                    Registered broker
                  </div>
                  <h1 className="mt-3 text-3xl font-light tracking-tight text-slate-900 sm:text-4xl">{broker.name}</h1>
                  <p className="mt-1 text-slate-600">{broker.position || "Real estate professional"}</p>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3 text-sm text-slate-600">
                Member since <span className="font-semibold text-slate-900">{memberSince}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <h2 className="text-xl font-semibold text-slate-900">Contact information</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {[
                  { label: "Email address", value: broker.email, icon: Mail },
                  { label: "Phone number", value: broker.phone || "Not provided", icon: Phone },
                  { label: "Agency", value: broker.agencyName || "Independent broker", icon: Building2 },
                  { label: "Service area", value: broker.serviceArea || "Not provided", icon: MapPin },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Icon size={16} className="text-slate-500" />{label}</div>
                    <p className="mt-3 break-words text-sm text-slate-600">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="flex items-center gap-2"><BriefcaseBusiness size={19} className="text-slate-500" /><h2 className="text-xl font-semibold text-slate-900">Professional background</h2></div>
              <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-slate-600">{broker.experience || "No professional background has been added yet."}</p>
            </div>
          </div>

          <aside className="space-y-6">
            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2"><ShieldCheck size={19} className="text-slate-500" /><h2 className="text-lg font-semibold text-slate-900">Verification</h2></div>
              <div className="mt-5 space-y-3">
                <StatusRow icon={FileCheck2} label="Government ID" complete={hasGovernmentId} />
                <StatusRow icon={FileBadge} label="PRC license" complete={hasLicense} optional />
                <StatusRow icon={CalendarDays} label="Account details" complete={broker.role === "broker"} />
              </div>
            </div>

            <div className="rounded-[2rem] bg-slate-900 p-6 text-white shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/50">License number</p>
              <p className="mt-3 text-xl font-light">{broker.prcLicense || "Not provided"}</p>
              <p className="mt-4 text-sm leading-6 text-white/60">Add or update professional credentials from your broker settings.</p>
            </div>
          </aside>
        </section>
      </main>
      {editing && <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:items-center sm:p-4"><div role="dialog" aria-modal="true" aria-labelledby="edit-broker-title" className="max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white shadow-2xl sm:max-h-[92vh]"><div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-5 py-4 sm:px-7 sm:py-5"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Broker profile</p><h2 id="edit-broker-title" className="mt-1 text-2xl font-semibold">Edit profile</h2><p className="mt-1 text-sm text-slate-500">Keep your public contact and professional information current.</p></div><button type="button" onClick={closeEditProfile} disabled={saving} aria-label="Close edit profile" className="rounded-full p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X size={21} /></button></div><form onSubmit={saveProfile} className="space-y-7 p-5 sm:p-7"><section className="flex flex-col items-center gap-5 rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:flex-row"><div role={profilePreview ? "img" : undefined} aria-label={profilePreview ? "Profile photo preview" : undefined} style={profilePreview ? { backgroundImage: `url(${profilePreview})` } : undefined} className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-white bg-cover bg-center text-slate-400 shadow-sm ring-1 ring-slate-200">{!profilePreview && <UserRound size={38} />}</div><div className="text-center sm:text-left"><h3 className="font-semibold text-slate-900">Profile photo</h3><p className="mt-1 text-sm text-slate-500">JPG, PNG, or WEBP up to 5 MB.</p><label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"><Camera size={16} />{profilePreview ? "Change photo" : "Upload photo"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={saving} onChange={chooseProfilePhoto} className="sr-only" /></label></div></section><section><h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">Contact and identity</h3><div className="grid gap-4 sm:grid-cols-2"><EditField label="Full name" value={editForm.name} onChange={(value) => changeEdit("name", value)} disabled={saving} /><EditField label="Phone number" type="tel" value={editForm.phone} onChange={(value) => changeEdit("phone", value)} disabled={saving} /><label className="text-sm font-semibold text-slate-700 sm:col-span-2">Email address<input value={broker.email} disabled className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-100 px-4 font-normal text-slate-500" /><span className="mt-1 block text-xs font-normal text-slate-400">Email changes are managed through account security.</span></label></div></section><section><h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">Professional details</h3><div className="grid gap-4 sm:grid-cols-2"><EditField label="Agency name" value={editForm.agencyName} onChange={(value) => changeEdit("agencyName", value)} disabled={saving} /><EditField label="Position" value={editForm.position} onChange={(value) => changeEdit("position", value)} disabled={saving} /><EditField label="Service area" value={editForm.serviceArea} onChange={(value) => changeEdit("serviceArea", value)} disabled={saving} className="sm:col-span-2" /><label className="text-sm font-semibold text-slate-700 sm:col-span-2">Professional background<textarea required rows={5} maxLength={1000} value={editForm.experience} onChange={(event) => changeEdit("experience", event.target.value)} disabled={saving} placeholder="Describe your experience and specialties." className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-normal outline-none focus:border-blue-400 focus:bg-white disabled:opacity-60" /><span className="mt-1 block text-right text-xs font-normal text-slate-400">{editForm.experience.length}/1000</span></label></div><div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-800"><strong>Verified credentials are protected.</strong> Contact an administrator if your PRC license or verification documents need to change.</div></section>{saveError && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</p>}<div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end"><button type="button" onClick={closeEditProfile} disabled={saving} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancel</button><button disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? <LoaderCircle className="animate-spin" size={17} /> : <Save size={17} />}{saving ? "Saving…" : "Save changes"}</button></div></form></div></div>}
    </div>
  );
}

function CheckCircleIcon() {
  return <BadgeCheck size={18} />;
}

function EditField({ label, value, onChange, disabled, type = "text", className = "" }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean; type?: string; className?: string }) {
  return <label className={`text-sm font-semibold text-slate-700 ${className}`}>{label}<input required type={type} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 font-normal text-slate-900 outline-none focus:border-blue-400 focus:bg-white disabled:opacity-60" /></label>;
}

function StatusRow({
  icon: Icon,
  label,
  complete,
  optional = false,
}: {
  icon: typeof ShieldCheck;
  label: string;
  complete: boolean;
  optional?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center gap-3 text-sm font-medium text-slate-700"><Icon size={17} className="text-slate-500" />{label}</div>
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${complete ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
        {complete ? "Provided" : optional ? "Optional" : "Pending"}
      </span>
    </div>
  );
}
