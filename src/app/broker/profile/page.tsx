"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  FileBadge,
  FileCheck2,
  Mail,
  MapPin,
  Phone,
  Settings,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc, Timestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { isRemoteImageUrl } from "@/lib/cloudinary";

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

export default function BrokerProfilePage() {
  const [broker, setBroker] = useState<BrokerProfile | null>(null);
  const [loading, setLoading] = useState(true);

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
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.12),_transparent_42%),radial-gradient(circle_at_top_right,_rgba(15,23,42,0.10),_transparent_38%)]" />

      <main className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <Link href="/broker" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm hover:text-slate-900">
            <ArrowLeft size={16} />
            Back to dashboard
          </Link>
          <Link href="/broker/settings" className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            <Settings size={16} />
            Settings
          </Link>
        </div>

        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
          <div className="h-28 bg-gradient-to-r from-slate-900 via-blue-950 to-blue-700 sm:h-36" />
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
    </div>
  );
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
