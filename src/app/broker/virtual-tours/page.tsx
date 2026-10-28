"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { collection, deleteDoc, doc, getDocs, onSnapshot, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Eye,
  ImageIcon,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import PanoramaViewer from "@/components/PanoramaViewer";
import { auth, db } from "@/lib/firebase";

type Metrics = {
  algorithm?: string;
  average_inlier_ratio?: number;
  coverage_ratio?: number;
  total_processing_ms?: number;
  processing_ms?: number;
  output_width?: number;
  output_height?: number;
};

type RoomTour = {
  id: string;
  propertyId: string;
  brokerId: string;
  roomType: string;
  panoramaUrl: string;
  algorithm?: string;
  projection?: string;
  sourceImageCount?: number;
  status?: "published" | "unpublished";
  metrics?: Metrics;
};

type PropertyOption = { id: string; title?: string };

export default function VirtualToursPage() {
  const [tours, setTours] = useState<RoomTour[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<RoomTour | null>(null);
  const [editing, setEditing] = useState<RoomTour | null>(null);
  const [roomName, setRoomName] = useState("");
  const [deleting, setDeleting] = useState<RoomTour | null>(null);
  const [workingId, setWorkingId] = useState("");

  useEffect(() => {
    let stopTours: () => void = () => {};
    const stopAuth = onAuthStateChanged(auth, async (user) => {
      stopTours();
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        const propertySnapshot = await getDocs(query(collection(db, "properties"), where("brokerId", "==", user.uid)));
        setProperties(propertySnapshot.docs.map((item) => ({ id: item.id, ...item.data() } as PropertyOption)));
        stopTours = onSnapshot(
          query(collection(db, "roomTours"), where("brokerId", "==", user.uid)),
          (snapshot) => {
            setTours(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as RoomTour)));
            setLoading(false);
          },
          (snapshotError) => {
            console.error("Unable to load tours:", snapshotError);
            setError("Virtual tours could not be loaded. Check your Firestore permissions.");
            setLoading(false);
          },
        );
      } catch (loadError) {
        console.error("Unable to load tour workspace:", loadError);
        setError("The tour workspace could not be loaded.");
        setLoading(false);
      }
    });
    return () => { stopTours(); stopAuth(); };
  }, []);

  const propertyNames = useMemo(() => new Map(properties.map((property) => [property.id, property.title || "Untitled property"])), [properties]);
  const filteredTours = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tours.filter((tour) => !term || `${tour.roomType} ${propertyNames.get(tour.propertyId) ?? ""}`.toLowerCase().includes(term));
  }, [propertyNames, search, tours]);
  const grouped = useMemo(() => {
    const groups = new Map<string, RoomTour[]>();
    filteredTours.forEach((tour) => groups.set(tour.propertyId, [...(groups.get(tour.propertyId) ?? []), tour]));
    return [...groups.entries()];
  }, [filteredTours]);
  const publishedCount = tours.filter((tour) => (tour.status ?? "published") === "published").length;

  const toggleStatus = async (tour: RoomTour) => {
    setWorkingId(tour.id); setError("");
    try {
      await updateDoc(doc(db, "roomTours", tour.id), { status: (tour.status ?? "published") === "published" ? "unpublished" : "published", updatedAt: serverTimestamp() });
    } catch (statusError) {
      console.error("Unable to change tour status:", statusError);
      setError("The tour status could not be changed.");
    } finally { setWorkingId(""); }
  };

  const saveName = async () => {
    if (!editing || !roomName.trim()) return;
    const duplicate = tours.some((tour) => tour.id !== editing.id && tour.propertyId === editing.propertyId && tour.roomType.trim().toLowerCase() === roomName.trim().toLowerCase());
    if (duplicate) { setError("That property already has a tour with this room name."); return; }
    setWorkingId(editing.id); setError("");
    try {
      await updateDoc(doc(db, "roomTours", editing.id), { roomType: roomName.trim(), updatedAt: serverTimestamp() });
      setEditing(null);
    } catch (renameError) {
      console.error("Unable to rename room:", renameError);
      setError("The room name could not be updated.");
    } finally { setWorkingId(""); }
  };

  const removeTour = async () => {
    if (!deleting) return;
    setWorkingId(deleting.id); setError("");
    try {
      await deleteDoc(doc(db, "roomTours", deleting.id));
      if (preview?.id === deleting.id) setPreview(null);
      setDeleting(null);
    } catch (deleteError) {
      console.error("Unable to delete tour:", deleteError);
      setError("The virtual tour could not be deleted.");
    } finally { setWorkingId(""); }
  };

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-5 lg:px-8"><div className="flex items-center gap-4"><Link href="/broker" aria-label="Back to dashboard" className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50"><ArrowLeft size={19} /></Link><div><h1 className="mt-1 text-2xl font-semibold">Manage virtual tours</h1></div></div><Link href="/broker/create-tour" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"><Plus size={17} /><span className="hidden sm:inline">Create room tour</span></Link></div></header>
    <main className="mx-auto max-w-7xl px-5 py-8 lg:px-8 lg:py-10">
      {error && <div role="alert" className="mb-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="mt-0.5 shrink-0" size={19} /><p>{error}</p></div>}
      <section className="grid gap-4 sm:grid-cols-3"><Summary label="Total room tours" value={tours.length} /><Summary label="Published" value={publishedCount} accent /><Summary label="Properties with tours" value={new Set(tours.map((tour) => tour.propertyId)).size} /></section>
      <div className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-semibold">Your reconstructed rooms</h2><p className="mt-1 text-sm text-slate-500">Preview quality, control visibility, or rebuild a room.</p></div><label className="relative block sm:w-80"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search property or room" className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm outline-none focus:border-blue-400" /></label></div>
      {loading ? <div className="mt-7 grid gap-5 md:grid-cols-2"><Skeleton /><Skeleton /></div> : grouped.length ? <div className="mt-7 space-y-7">{grouped.map(([propertyId, propertyTours]) => <section key={propertyId} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-200 px-6 py-5"><div><h3 className="font-semibold">{propertyNames.get(propertyId) || "Unknown property"}</h3><p className="mt-1 text-xs text-slate-500">{propertyTours.length} reconstructed room{propertyTours.length === 1 ? "" : "s"}</p></div><Link href="/broker/create-tour" className="text-xs font-semibold text-blue-600">Add room</Link></div><div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">{propertyTours.map((tour) => <TourCard key={tour.id} tour={tour} working={workingId === tour.id} onPreview={() => setPreview(tour)} onRename={() => { setEditing(tour); setRoomName(tour.roomType); }} onToggle={() => void toggleStatus(tour)} onDelete={() => setDeleting(tour)} />)}</div></section>)}</div> : <div className="mt-7 rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"><span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-500"><ImageIcon size={30} /></span><h2 className="mt-5 text-xl font-semibold">{search ? "No matching tours" : "No virtual tours yet"}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{search ? "Try a different property or room name." : "Reconstruct your first room from overlapping static images."}</p>{!search && <Link href="/broker/create-tour" className="mt-6 inline-flex rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white">Create virtual tour</Link>}</div>}
    </main>

    {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"><div className="max-h-[95vh] w-full max-w-5xl overflow-y-auto rounded-3xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-200 px-6 py-5"><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Immersive preview</p><h2 className="mt-1 text-xl font-semibold">{preview.roomType}</h2></div><button onClick={() => setPreview(null)} aria-label="Close preview" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><X /></button></div><div className="p-4 sm:p-6"><PanoramaViewer panorama={preview.panoramaUrl} caption={`${propertyNames.get(preview.propertyId) || "Property"} · ${preview.roomType}`} /><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="Algorithm" value={preview.algorithm || preview.metrics?.algorithm || "—"} /><Metric label="Quality" value={qualityLabel(preview.metrics)} /><Metric label="Source images" value={String(preview.sourceImageCount ?? "—")} /><Metric label="Output" value={preview.metrics?.output_width ? `${preview.metrics.output_width}×${preview.metrics.output_height}` : "—"} /></div></div></div></div>}
    {editing && <Modal title="Rename room" onClose={() => setEditing(null)}><label className="block text-sm font-semibold text-slate-700">Room name<input autoFocus value={roomName} onChange={(event) => setRoomName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveName(); }} className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4 font-normal outline-none focus:border-blue-400" /></label><div className="mt-6 flex justify-end gap-3"><button onClick={() => setEditing(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold">Cancel</button><button onClick={() => void saveName()} disabled={!roomName.trim() || workingId === editing.id} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Save name</button></div></Modal>}
    {deleting && <Modal title="Delete virtual tour?" onClose={() => setDeleting(null)}><p className="text-sm leading-6 text-slate-600">This removes the <strong>{deleting.roomType}</strong> panorama from LiBot. The Cloudinary asset may require separate media-library cleanup.</p><div className="mt-6 flex justify-end gap-3"><button onClick={() => setDeleting(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold">Keep tour</button><button onClick={() => void removeTour()} disabled={workingId === deleting.id} className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Delete tour</button></div></Modal>}
  </div>;
}

function TourCard({ tour, working, onPreview, onRename, onToggle, onDelete }: { tour: RoomTour; working: boolean; onPreview: () => void; onRename: () => void; onToggle: () => void; onDelete: () => void }) {
  const published = (tour.status ?? "published") === "published";
  const processing = ((tour.metrics?.total_processing_ms ?? tour.metrics?.processing_ms ?? 0) / 1000).toFixed(2);
  return <article className="overflow-hidden rounded-2xl border border-slate-200"><button onClick={onPreview} className="group relative block h-36 w-full overflow-hidden bg-slate-950 text-left"><div className="absolute inset-0 bg-gradient-to-br from-blue-900 via-slate-900 to-slate-950" /><div className="absolute inset-0 flex items-center justify-center"><Eye className="text-white/70 transition group-hover:scale-110" size={31} /></div><span className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-semibold ${published ? "bg-emerald-400 text-emerald-950" : "bg-white/15 text-white"}`}>{published ? "PUBLISHED" : "HIDDEN"}</span></button><div className="p-4"><div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold">{tour.roomType}</h4><p className="mt-1 text-xs text-slate-500">{tour.algorithm || tour.metrics?.algorithm || "Computer vision"} reconstruction</p></div><span className={`rounded-lg px-2 py-1 text-[10px] font-semibold ${qualityStyle(tour.metrics)}`}>{qualityLabel(tour.metrics)}</span></div><div className="mt-4 flex gap-4 text-[11px] text-slate-500"><span className="flex items-center gap-1"><ImageIcon size={13} />{tour.sourceImageCount ?? "—"} images</span><span className="flex items-center gap-1"><Clock3 size={13} />{processing}s</span></div><div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-200 pt-4"><button onClick={onPreview} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700"><Eye size={14} />Preview</button><button onClick={onRename} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600"><Pencil size={14} />Rename</button><button onClick={onToggle} disabled={working} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-50">{working ? <LoaderCircle className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}{published ? "Unpublish" : "Publish"}</button><Link href="/broker/create-tour" className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"><RefreshCw size={14} />Regenerate</Link></div><button onClick={onDelete} className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"><Trash2 size={14} />Delete tour</button></div></article>;
}

function qualityScore(metrics?: Metrics) { return metrics?.coverage_ratio ?? metrics?.average_inlier_ratio ?? 0; }
function qualityLabel(metrics?: Metrics) { const score = qualityScore(metrics); return score >= 0.55 ? "Strong" : score >= 0.3 ? "Review" : score ? "Weak" : "Unrated"; }
function qualityStyle(metrics?: Metrics) { const score = qualityScore(metrics); return score >= 0.55 ? "bg-emerald-50 text-emerald-700" : score >= 0.3 ? "bg-amber-50 text-amber-700" : score ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-500"; }
function Summary({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) { return <div className={`rounded-2xl border p-5 ${accent ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white"}`}><p className={`text-xs font-semibold uppercase tracking-wider ${accent ? "text-blue-600" : "text-slate-400"}`}>{label}</p><p className="mt-2 text-3xl font-light">{value}</p></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-sm font-semibold">{value}</p></div>; }
function Skeleton() { return <div className="h-72 animate-pulse rounded-3xl border border-slate-200 bg-white"><div className="h-16 border-b border-slate-100 bg-slate-50" /></div>; }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-xl font-semibold">{title}</h2><button onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button></div><div className="mt-5">{children}</div></div></div>; }
