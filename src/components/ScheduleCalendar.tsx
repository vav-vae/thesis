"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, onSnapshot, query, Timestamp, updateDoc, where } from "firebase/firestore";
import { AlertCircle, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Home, LoaderCircle, MapPin, X } from "lucide-react";

import { auth, db } from "@/lib/firebase";

export type ScheduleRole = "buyer" | "broker";
type ScheduleStatus = "pending" | "confirmed" | "completed" | "cancelled" | "rejected";
type ViewingSchedule = {
  id: string;
  propertyId: string;
  propertyTitle: string;
  propertyLocation?: string;
  buyerId: string;
  buyerName: string;
  brokerId: string;
  brokerName: string;
  scheduledAt: Timestamp;
  durationMinutes: number;
  status: ScheduleStatus;
  notes?: string;
};

const statusStyle: Record<ScheduleStatus, string> = {
  pending: "bg-amber-50 text-amber-700",
  confirmed: "bg-emerald-50 text-emerald-700",
  completed: "bg-blue-50 text-blue-700",
  cancelled: "bg-slate-100 text-slate-500",
  rejected: "bg-red-50 text-red-700",
};

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

export default function ScheduleCalendar({ role }: { role: ScheduleRole }) {
  const [items, setItems] = useState<ViewingSchedule[]>([]);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let stopSchedules = () => {};
    const stopAuth = onAuthStateChanged(auth, (user) => {
      stopSchedules();
      if (!user) { setItems([]); setLoading(false); return; }
      const field = role === "broker" ? "brokerId" : "buyerId";
      stopSchedules = onSnapshot(query(collection(db, "viewingSchedules"), where(field, "==", user.uid)), (snapshot) => {
        setItems(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as ViewingSchedule)).filter((item) => item.scheduledAt?.toDate).sort((a, b) => a.scheduledAt.toMillis() - b.scheduledAt.toMillis()));
        setLoading(false);
      }, (scheduleError) => {
        console.error("Unable to load schedules:", scheduleError);
        setError("Schedules could not be loaded. Check Firestore permissions.");
        setLoading(false);
      });
    });
    return () => { stopSchedules(); stopAuth(); };
  }, [role]);

  const cells = useMemo(() => {
    const firstWeekday = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
    const start = new Date(month.getFullYear(), month.getMonth(), 1 - firstWeekday);
    return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  }, [month]);
  const byDay = useMemo(() => new Map(cells.map((date) => [dayKey(date), items.filter((item) => dayKey(item.scheduledAt.toDate()) === dayKey(date))])), [cells, items]);
  const selectedItems = byDay.get(dayKey(selectedDay)) ?? [];
  const upcoming = items.filter((item) => item.scheduledAt.toMillis() >= startOfDay(new Date()) && !["cancelled", "rejected", "completed"].includes(item.status));

  const changeStatus = async (schedule: ViewingSchedule, status: ScheduleStatus) => {
    setWorkingId(schedule.id); setError("");
    try {
      if (role === "broker" && status === "confirmed") {
        const requestedStart = schedule.scheduledAt.toMillis();
        const requestedEnd = requestedStart + schedule.durationMinutes * 60_000;
        const conflict = items.some((item) => item.id !== schedule.id && item.status === "confirmed" && item.scheduledAt.toMillis() < requestedEnd && item.scheduledAt.toMillis() + item.durationMinutes * 60_000 > requestedStart);
        if (conflict) throw new Error("This viewing overlaps another confirmed appointment.");
      }
      await updateDoc(doc(db, "viewingSchedules", schedule.id), { status, updatedAt: Timestamp.now() });
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "The schedule could not be updated.");
    } finally { setWorkingId(""); }
  };

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-5 lg:px-8"><div className="flex items-center gap-4"><Link href={`/${role}`} className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50" aria-label="Back to dashboard"><ChevronLeft size={19} /></Link><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">{role} workspace</p><h1 className="mt-1 text-2xl font-semibold">Viewing calendar</h1></div></div><span className="hidden rounded-full bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-700 sm:block">{upcoming.length} upcoming</span></div></header>
    <main className="mx-auto max-w-7xl px-5 py-7 lg:px-8 lg:py-10">
      {error && <div role="alert" className="mb-6 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle size={18} />{error}</div>}
      {loading ? <div className="flex min-h-96 items-center justify-center"><LoaderCircle className="animate-spin text-blue-600" /></div> : <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-200 p-5 sm:p-6"><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-xl border border-slate-200 p-2"><ChevronLeft size={18} /></button><h2 className="text-lg font-semibold">{month.toLocaleDateString("en-PH", { month: "long", year: "numeric" })}</h2><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-xl border border-slate-200 p-2"><ChevronRight size={18} /></button></div><div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="py-3">{day}</div>)}</div><div className="grid grid-cols-7">{cells.map((date) => {
          const dateItems = byDay.get(dayKey(date)) ?? []; const active = dayKey(date) === dayKey(selectedDay); const currentMonth = date.getMonth() === month.getMonth(); const today = dayKey(date) === dayKey(new Date());
          return <button key={date.toISOString()} onClick={() => setSelectedDay(date)} className={`min-h-24 border-b border-r border-slate-100 p-2 text-left transition hover:bg-blue-50/40 ${active ? "bg-blue-50 ring-1 ring-inset ring-blue-300" : ""} ${currentMonth ? "" : "text-slate-300"}`}><span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${today ? "bg-blue-600 text-white" : ""}`}>{date.getDate()}</span><div className="mt-1 space-y-1">{dateItems.slice(0, 2).map((item) => <span key={item.id} className={`block truncate rounded px-1.5 py-1 text-[9px] font-semibold ${statusStyle[item.status]}`}>{item.scheduledAt.toDate().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })} {item.propertyTitle}</span>)}{dateItems.length > 2 && <span className="block text-[9px] text-slate-400">+{dateItems.length - 2} more</span>}</div></button>;
        })}</div></section>
        <aside className="space-y-5"><section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><CalendarDays className="text-blue-600" /><div><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Selected date</p><h2 className="font-semibold">{selectedDay.toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric" })}</h2></div></div><div className="mt-5 space-y-3">{selectedItems.length ? selectedItems.map((item) => <ScheduleCard key={item.id} item={item} role={role} working={workingId === item.id} onStatus={changeStatus} />) : <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">No viewing scheduled.</div>}</div></section>{role === "buyer" && <section className="rounded-3xl bg-slate-900 p-5 text-white"><h3 className="font-semibold">Request a viewing</h3><p className="mt-2 text-xs leading-5 text-white/65">Open any property and select “Schedule viewing” to propose a date and time.</p><Link href="/buyer/properties" className="mt-4 inline-flex rounded-xl bg-white px-4 py-2.5 text-xs font-semibold text-slate-900">Browse properties</Link></section>}</aside>
      </div>}
    </main>
  </div>;
}

function ScheduleCard({ item, role, working, onStatus }: { item: ViewingSchedule; role: ScheduleRole; working: boolean; onStatus: (item: ViewingSchedule, status: ScheduleStatus) => void }) {
  const date = item.scheduledAt.toDate();
  return <article className="rounded-2xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{item.propertyTitle}</p><p className="mt-1 text-xs text-slate-500">{role === "broker" ? item.buyerName : item.brokerName}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${statusStyle[item.status]}`}>{item.status}</span></div><div className="mt-3 space-y-1.5 text-xs text-slate-500"><p className="flex items-center gap-2"><Clock3 size={14} />{date.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })} · {item.durationMinutes} minutes</p>{item.propertyLocation && <p className="flex items-center gap-2"><MapPin size={14} />{item.propertyLocation}</p>}</div>{item.notes && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">{item.notes}</p>}<div className="mt-4 flex flex-wrap gap-2"><Link href={role === "buyer" ? `/buyer/properties/${item.propertyId}` : "/broker/properties"} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold"><Home size={13} />Property</Link>{role === "broker" && item.status === "pending" && <><button disabled={working} onClick={() => onStatus(item, "confirmed")} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Check size={13} />Confirm</button><button disabled={working} onClick={() => onStatus(item, "rejected")} className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50"><X size={13} />Reject</button></>}{role === "broker" && item.status === "confirmed" && <button disabled={working} onClick={() => onStatus(item, "completed")} className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">Mark completed</button>}{role === "buyer" && ["pending", "confirmed"].includes(item.status) && <button disabled={working} onClick={() => onStatus(item, "cancelled")} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50">Cancel request</button>}</div></article>;
}
