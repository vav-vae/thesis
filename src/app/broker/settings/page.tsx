"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, sendPasswordResetEmail, signOut, User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  LogOut,
  Save,
  ShieldCheck,
  Camera,
} from "lucide-react";

import { auth, db } from "@/lib/firebase";
import PushNotificationSettings from "@/components/PushNotificationSettings";

type BrokerSettings = {
  notifications: { listings: boolean; verification: boolean };
  virtualTours: { defaultAlgorithm: "sift"; ransacThreshold: number };
};

const defaults: BrokerSettings = {
  notifications: { listings: true, verification: true },
  virtualTours: { defaultAlgorithm: "sift", ransacThreshold: 4 },
};

export default function BrokerSettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<BrokerSettings>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => onAuthStateChanged(auth, async (currentUser) => {
    setUser(currentUser);
    if (!currentUser) { setLoading(false); return; }
    try {
      const snapshot = await getDoc(doc(db, "users", currentUser.uid));
      const saved = snapshot.data()?.settings as Partial<BrokerSettings> | undefined;
      setSettings({
        notifications: { ...defaults.notifications, ...saved?.notifications },
        virtualTours: { ...defaults.virtualTours, ...saved?.virtualTours },
      });
    } catch (loadError) {
      console.error("Unable to load settings:", loadError);
      setError("Your saved settings could not be loaded.");
    } finally { setLoading(false); }
  }), []);

  const saveSettings = async () => {
    if (!user || saving) return;
    setSaving(true); setError(""); setMessage("");
    try {
      await updateDoc(doc(db, "users", user.uid), { settings, settingsUpdatedAt: serverTimestamp() });
      setMessage("Settings saved successfully.");
    } catch (saveError) {
      console.error("Unable to save settings:", saveError);
      setError("Settings could not be saved. Check your connection and permissions.");
    } finally { setSaving(false); }
  };

  const resetPassword = async () => {
    if (!user?.email || resetting) return;
    setResetting(true); setError(""); setMessage("");
    try {
      await sendPasswordResetEmail(auth, user.email);
      setMessage(`Password-reset instructions were sent to ${user.email}.`);
    } catch (resetError) {
      console.error("Unable to send password reset:", resetError);
      setError("Password-reset email could not be sent. Try again shortly.");
    } finally { setResetting(false); }
  };

  const endSession = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try { await signOut(auth); router.replace("/login"); }
    catch (sessionError) { console.error("Unable to sign out:", sessionError); setError("You could not be signed out."); setSigningOut(false); }
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-50"><LoaderCircle className="animate-spin text-blue-600" size={38} /></div>;
  if (!user) return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6"><div className="max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center"><ShieldCheck className="mx-auto text-slate-400" size={40} /><h1 className="mt-4 text-2xl font-semibold">Sign in required</h1><Link href="/login" className="mt-6 inline-flex rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white">Go to login</Link></div></main>;

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-5 lg:px-8"><div className="flex items-center gap-4"><Link href="/broker" aria-label="Back to dashboard" className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50"><ArrowLeft size={19} /></Link><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">Broker account</p><h1 className="mt-1 text-2xl font-semibold">Settings</h1></div></div><button onClick={() => void saveSettings()} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{saving ? <LoaderCircle className="animate-spin" size={17} /> : <Save size={17} />}<span className="hidden sm:inline">Save changes</span></button></div></header>
    <main className="mx-auto max-w-5xl space-y-6 px-5 py-8 lg:px-8 lg:py-10">
      {error && <Notice error>{error}</Notice>}{message && <Notice>{message}</Notice>}
      <PushNotificationSettings />
      <SettingsSection icon={Bell} title="Notifications" description="Choose which activity appears in your LiBot notification center.">
        <Toggle label="Listing activity" detail="Updates related to your property listings." checked={settings.notifications.listings} onChange={(value) => setSettings((current) => ({ ...current, notifications: { ...current.notifications, listings: value } }))} />
        <Toggle label="Broker verification" detail="Approval, rejection, and credential review updates." checked={settings.notifications.verification} onChange={(value) => setSettings((current) => ({ ...current, notifications: { ...current.notifications, verification: value } }))} />
      </SettingsSection>

      <SettingsSection icon={Camera} title="Virtual-tour defaults" description="These values prefill the reconstruction studio and can still be changed per room.">
        <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6"><div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"><p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Feature detector</p><p className="mt-1 font-semibold">SIFT — stronger matching</p></div><label className="text-sm font-semibold text-slate-700">RANSAC threshold<input type="number" min="1" max="10" step="0.5" value={settings.virtualTours.ransacThreshold} onChange={(event) => setSettings((current) => ({ ...current, virtualTours: { ...current.virtualTours, ransacThreshold: Math.min(10, Math.max(1, Number(event.target.value) || 4)) } }))} className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4 font-normal outline-none focus:border-blue-400" /><span className="mt-2 block text-xs font-normal leading-5 text-slate-500">1–10 pixels. The balanced default is 4.</span></label></div>
      </SettingsSection>

      <SettingsSection icon={KeyRound} title="Account security" description={`Signed in as ${user.email || "your broker account"}.`}>
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"><div><p className="text-sm font-semibold">Password</p><p className="mt-1 text-xs leading-5 text-slate-500">Firebase will email a secure password-reset link to your sign-in address.</p></div><button onClick={() => void resetPassword()} disabled={resetting || !user.email} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{resetting ? <LoaderCircle className="animate-spin" size={16} /> : <KeyRound size={16} />}Send reset email</button></div>
        <div className="flex flex-col gap-4 border-t border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"><div><p className="text-sm font-semibold">Current session</p><p className="mt-1 text-xs leading-5 text-slate-500">Sign out of LiBot on this browser.</p></div><button onClick={() => void endSession()} disabled={signingOut} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">{signingOut ? <LoaderCircle className="animate-spin" size={16} /> : <LogOut size={16} />}Sign out</button></div>
      </SettingsSection>
    </main>
  </div>;
}

function SettingsSection({ icon: Icon, title, description, children }: { icon: typeof Bell; title: string; description: string; children: React.ReactNode }) { return <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="flex gap-3 border-b border-slate-200 p-5 sm:p-6"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Icon size={19} /></span><div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-sm leading-6 text-slate-500">{description}</p></div></div><div className="divide-y divide-slate-100">{children}</div></section>; }
function Toggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) { return <div className="flex items-center justify-between gap-5 p-5 sm:p-6"><div><p className="text-sm font-semibold">{label}</p><p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p></div><button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? "bg-blue-600" : "bg-slate-300"}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition ${checked ? "left-6" : "left-1"}`} /></button></div>; }
function Notice({ children, error = false }: { children: React.ReactNode; error?: boolean }) { const Icon = error ? AlertCircle : CheckCircle2; return <div role={error ? "alert" : "status"} className={`flex items-center gap-3 rounded-2xl border p-4 text-sm ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}><Icon size={19} />{children}</div>; }
