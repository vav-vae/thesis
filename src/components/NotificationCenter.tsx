"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, onSnapshot, query, Timestamp, where } from "firebase/firestore";
import { Bell, CalendarDays, CheckCheck, Flag, Home, ShieldCheck } from "lucide-react";
import { auth, db } from "@/lib/firebase";

type Audience = "buyer" | "broker";

type PropertyRecord = {
  id: string;
  title?: string;
  brokerId?: string;
  status?: string;
  createdAt?: Timestamp | Date | { toDate?: () => Date };
};

type NotificationItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  createdAt?: PropertyRecord["createdAt"];
  kind: "property" | "verification" | "report" | "schedule";
};

type ReportRecord = {
  id: string;
  targetLabel?: string;
  status?: "open" | "in_review" | "resolved" | "dismissed";
  resolutionNote?: string | null;
  updatedAt?: PropertyRecord["createdAt"];
};

type ScheduleRecord = {
  id: string;
  propertyTitle?: string;
  buyerName?: string;
  brokerName?: string;
  buyerId?: string;
  brokerId?: string;
  status?: "pending" | "confirmed" | "completed" | "cancelled" | "rejected";
  scheduledAt?: Timestamp;
  createdAt?: PropertyRecord["createdAt"];
  updatedAt?: PropertyRecord["createdAt"];
};

const asDate = (value: NotificationItem["createdAt"]) => {
  if (!value) return null;
  return "toDate" in value && typeof value.toDate === "function"
    ? value.toDate()
    : value instanceof Date
      ? value
      : null;
};

const formatTime = (value: NotificationItem["createdAt"]) => {
  const date = asDate(value);
  if (!date) return "Recently";
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

export default function NotificationCenter({ audience }: { audience: Audience }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [verificationStatus, setVerificationStatus] = useState("");
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([]);
  const [preferences, setPreferences] = useState({ listings: true, verification: true });
  const [readIds, setReadIds] = useState<string[]>([]);
  const [notificationOpenedAt] = useState(() => Date.now());

  useEffect(() => onAuthStateChanged(auth, (user) => {
    const uid = user?.uid ?? "";
    setUserId(uid);
    if (!uid) {
      setReadIds([]);
      return;
    }
    try {
      const stored = window.localStorage.getItem(`${audience}-notifications-read:${uid}`);
      setReadIds(stored ? JSON.parse(stored) : []);
    } catch {
      setReadIds([]);
    }
  }), [audience]);

  useEffect(() => {
    if (!userId) return;
    const unsubscribeProperties = onSnapshot(collection(db, "properties"), (snapshot) => {
      setProperties(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as PropertyRecord)));
    }, (error) => console.error("Unable to load notifications:", error));

    const unsubscribeProfile = onSnapshot(doc(db, "users", userId), (snapshot) => {
      const data = snapshot.data();
      if (audience === "broker") setVerificationStatus(data?.verificationStatus ?? "pending");
      setPreferences({
        listings: data?.settings?.notifications?.listings ?? true,
        verification: data?.settings?.notifications?.verification ?? true,
      });
    });
    const unsubscribeReports = onSnapshot(query(collection(db, "reports"), where("reporterId", "==", userId)), (snapshot) => {
      setReports(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as ReportRecord)));
    }, (error) => console.error("Unable to load report notifications:", error));
    const scheduleField = audience === "broker" ? "brokerId" : "buyerId";
    const unsubscribeSchedules = onSnapshot(query(collection(db, "viewingSchedules"), where(scheduleField, "==", userId)), (snapshot) => {
      setSchedules(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as ScheduleRecord)));
    }, (error) => console.error("Unable to load schedule notifications:", error));

    return () => {
      unsubscribeProperties();
      unsubscribeProfile();
      unsubscribeReports();
      unsubscribeSchedules();
    };
  }, [audience, userId]);

  const notifications = useMemo<NotificationItem[]>(() => {
    const propertyItems = properties
      .filter(() => preferences.listings)
      .filter((property) => audience === "buyer"
        ? property.status !== "archived"
        : property.brokerId === userId)
      .map((property): NotificationItem => ({
        id: `${audience}:property:${property.id}`,
        title: audience === "buyer" ? "New property available" : "Listing added",
        detail: property.title || "An untitled property listing was added.",
        href: audience === "buyer" ? `/buyer/properties/${property.id}` : "/broker/properties",
        createdAt: property.createdAt,
        kind: "property",
      }));

    const verificationItem: NotificationItem[] = audience === "broker" && verificationStatus && preferences.verification
      ? [{
          id: `broker:verification:${verificationStatus}`,
          title: verificationStatus === "verified" ? "Account verified" : verificationStatus === "rejected" ? "Verification needs attention" : "Verification pending",
          detail: verificationStatus === "verified" ? "Your broker account has been approved." : verificationStatus === "rejected" ? "Review your profile and submitted credentials." : "Your broker application is waiting for admin review.",
          href: "/broker/profile",
          kind: "verification",
        }]
      : [];

    const reportItems: NotificationItem[] = reports
      .filter((report) => report.status && report.status !== "open")
      .map((report) => ({
        id: `${audience}:report:${report.id}:${report.status}`,
        title: report.status === "in_review" ? "Report under review" : report.status === "resolved" ? "Report resolved" : "Report dismissed",
        detail: report.resolutionNote || (report.status === "in_review" ? `An administrator is reviewing your report about ${report.targetLabel || "the reported item"}.` : `Your report about ${report.targetLabel || "the reported item"} has been updated.`),
        href: audience === "buyer" ? "/buyer" : "/broker",
        createdAt: report.updatedAt,
        kind: "report",
      }));

    const scheduleItems: NotificationItem[] = schedules.flatMap((schedule) => {
      const items: NotificationItem[] = [];
      const appointment = schedule.scheduledAt?.toDate?.();
      const appointmentText = appointment?.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) ?? "the proposed time";
      const href = `/${audience}/calendar`;

      if (audience === "broker" && schedule.status === "pending") {
        items.push({ id: `broker:schedule:${schedule.id}:pending`, title: "New viewing request", detail: `${schedule.buyerName || "A buyer"} requested ${schedule.propertyTitle || "a property"} on ${appointmentText}.`, href, createdAt: schedule.createdAt, kind: "schedule" });
      }
      if (audience === "buyer" && schedule.status === "confirmed") {
        items.push({ id: `buyer:schedule:${schedule.id}:confirmed`, title: "Viewing confirmed", detail: `${schedule.propertyTitle || "Your property viewing"} is confirmed for ${appointmentText}.`, href, createdAt: schedule.updatedAt, kind: "schedule" });
      }
      if (audience === "buyer" && schedule.status === "rejected") {
        items.push({ id: `buyer:schedule:${schedule.id}:rejected`, title: "Viewing request declined", detail: `The broker could not approve your requested time for ${schedule.propertyTitle || "the property"}.`, href, createdAt: schedule.updatedAt, kind: "schedule" });
      }
      if (audience === "broker" && schedule.status === "cancelled") {
        items.push({ id: `broker:schedule:${schedule.id}:cancelled`, title: "Viewing cancelled", detail: `${schedule.buyerName || "The buyer"} cancelled the viewing for ${schedule.propertyTitle || "the property"}.`, href, createdAt: schedule.updatedAt, kind: "schedule" });
      }

      const now = notificationOpenedAt;
      if (schedule.status === "confirmed" && appointment && appointment.getTime() >= now && appointment.getTime() <= now + 24 * 60 * 60 * 1000) {
        items.push({ id: `${audience}:schedule:${schedule.id}:reminder:${dayKey(appointment)}`, title: "Upcoming viewing", detail: `${schedule.propertyTitle || "Property viewing"} is scheduled for ${appointmentText}.`, href, createdAt: schedule.scheduledAt, kind: "schedule" });
      }
      return items;
    });

    return [...scheduleItems, ...reportItems, ...verificationItem, ...propertyItems]
      .sort((a, b) => (asDate(b.createdAt)?.getTime() ?? Number.MAX_SAFE_INTEGER) - (asDate(a.createdAt)?.getTime() ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 12);
  }, [audience, notificationOpenedAt, preferences, properties, reports, schedules, userId, verificationStatus]);

  const unreadCount = notifications.filter((notification) => !readIds.includes(notification.id)).length;

  const saveReadIds = (ids: string[]) => {
    setReadIds(ids);
    if (userId) window.localStorage.setItem(`${audience}-notifications-read:${userId}`, JSON.stringify(ids));
  };

  const openNotification = (notification: NotificationItem) => {
    if (!readIds.includes(notification.id)) saveReadIds([...readIds, notification.id]);
    setOpen(false);
    router.push(notification.href);
  };

  const markAllRead = () => saveReadIds(Array.from(new Set([...readIds, ...notifications.map((notification) => notification.id)])));

  return <div className="relative">
    <button aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`} aria-expanded={open} onClick={() => setOpen((current) => !current)} className="relative flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900">
      <Bell size={20} />
      {unreadCount > 0 && <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white">{unreadCount > 9 ? "9+" : unreadCount}</span>}
    </button>

    {open && <div className="fixed inset-x-4 top-20 z-50 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[min(24rem,calc(100vw-2rem))]">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div><h2 className="font-semibold text-slate-900">Notifications</h2><p className="text-xs text-slate-500">Your latest LiBot activity</p></div>
        <button onClick={markAllRead} disabled={unreadCount === 0} className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 disabled:text-slate-300"><CheckCheck size={15} />Mark all read</button>
      </div>
      <div className="max-h-[28rem] overflow-y-auto">
        {notifications.map((notification) => {
          const unread = !readIds.includes(notification.id);
          const Icon = notification.kind === "verification" ? ShieldCheck : notification.kind === "report" ? Flag : notification.kind === "schedule" ? CalendarDays : Home;
          return <button key={notification.id} onClick={() => openNotification(notification)} className={`flex w-full gap-3 border-b border-slate-100 px-5 py-4 text-left transition hover:bg-slate-50 ${unread ? "bg-blue-50/40" : "bg-white"}`}>
            <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${notification.kind === "verification" ? "bg-amber-100 text-amber-700" : notification.kind === "report" ? "bg-red-100 text-red-700" : notification.kind === "schedule" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}><Icon size={16} /></span>
            <span className="min-w-0 flex-1"><span className="flex items-start gap-2"><span className={`text-sm text-slate-900 ${unread ? "font-semibold" : "font-medium"}`}>{notification.title}</span>{unread && <span aria-label="Unread" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600" />}</span><span className="mt-1 block truncate text-xs text-slate-500">{notification.detail}</span><span className="mt-1.5 block text-[11px] font-medium text-slate-400">{formatTime(notification.createdAt)}</span></span>
          </button>;
        })}
        {notifications.length === 0 && <div className="px-6 py-10 text-center"><Bell className="mx-auto text-slate-300" size={30} /><p className="mt-3 text-sm font-medium text-slate-600">You&apos;re all caught up</p><p className="mt-1 text-xs text-slate-400">New activity will appear here.</p></div>}
      </div>
    </div>}
  </div>;
}
