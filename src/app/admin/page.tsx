"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { onAuthStateChanged, signOut, User as FirebaseUser } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  Bell,
  Building2,
  Camera,
  CheckCircle2,
  CheckCheck,
  ChevronRight,
  CircleUserRound,
  ClipboardCheck,
  Home,
  House,
  Flag,
  LoaderCircle,
  LogOut,
  Menu,
  Pencil,
  Search,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
  X,
  XCircle,
} from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { isRemoteImageUrl, uploadImageToCloudinary } from "@/lib/cloudinary";

type AdminSection = "dashboard" | "buyers" | "brokers" | "verification" | "properties" | "reports" | "profile";
type VerificationStatus = "pending" | "verified" | "rejected";

type AdminNotification = {
  id: string;
  title: string;
  detail: string;
  createdAt?: PlatformUser["createdAt"];
  target: AdminSection;
  tone: "amber" | "blue" | "emerald";
};

type PlatformUser = {
  id: string;
  uid?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  role?: string;
  profilePicture?: string | null;
  profilePhoto?: string | null;
  agencyName?: string;
  position?: string;
  experience?: string;
  serviceArea?: string;
  prcLicense?: string | null;
  governmentId?: string | null;
  verificationStatus?: VerificationStatus;
  rejectionReason?: string | null;
  accountStatus?: "active" | "inactive";
  createdAt?: Timestamp | Date | { toDate?: () => Date };
};

type PropertyListing = {
  id: string;
  title?: string;
  description?: string;
  price?: string | number;
  currency?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  brokerId?: string;
  propertyType?: string;
  beds?: number;
  baths?: number;
  amenities?: string[];
  availabilityStatus?: string;
  image?: string;
  imageUrls?: string[];
  status?: string;
  createdAt?: Timestamp | Date | { toDate?: () => Date };
  updatedAt?: Timestamp | Date | { toDate?: () => Date };
};

type RoomImageRecord = {
  propertyId?: string;
  imageUrls?: string[];
};

type ReportRecord = {
  id: string;
  reporterId?: string;
  reporterRole?: "buyer" | "broker";
  targetType?: "user" | "property";
  targetId?: string;
  targetLabel?: string;
  reportedUserId?: string | null;
  propertyId?: string | null;
  negotiationId?: string | null;
  reason?: string;
  details?: string;
  status?: "open" | "in_review" | "resolved" | "dismissed";
  resolutionNote?: string | null;
  updatedAt?: Timestamp | Date | { toDate?: () => Date };
  createdAt?: Timestamp | Date | { toDate?: () => Date };
};

const navigation: Array<{ id: AdminSection; label: string; icon: LucideIcon }> = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "buyers", label: "Buyers", icon: UserRound },
  { id: "brokers", label: "Brokers", icon: Building2 },
  { id: "verification", label: "Broker Verification", icon: ClipboardCheck },
  { id: "properties", label: "Property Listings", icon: House },
  { id: "reports", label: "Reports", icon: Flag },
  { id: "profile", label: "Profile", icon: CircleUserRound },
];

const formatDate = (value: PlatformUser["createdAt"] | PropertyListing["createdAt"]) => {
  if (!value) return "Not available";
  const date = "toDate" in value && typeof value.toDate === "function"
    ? value.toDate()
    : value instanceof Date
      ? value
      : null;
  return date?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) ?? "Not available";
};

const toDate = (value: PlatformUser["createdAt"] | PropertyListing["createdAt"]) => {
  if (!value) return null;
  return "toDate" in value && typeof value.toDate === "function"
    ? value.toDate()
    : value instanceof Date
      ? value
      : null;
};

const formatNotificationTime = (value: AdminNotification["createdAt"]) => {
  const date = toDate(value);
  if (!date) return "Recently";
  const elapsed = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : formatDate(value);
};

const displayName = (user: PlatformUser) =>
  user.name || [user.firstName, user.lastName].filter(Boolean).join(" ") || "Unnamed user";

const brokerStatus = (broker: PlatformUser): VerificationStatus => broker.verificationStatus ?? "pending";

export default function AdminPage() {
  const router = useRouter();
  const [section, setSection] = useState<AdminSection>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [admin, setAdmin] = useState<PlatformUser | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [properties, setProperties] = useState<PropertyListing[]>([]);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [selectedBroker, setSelectedBroker] = useState<PlatformUser | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<PropertyListing | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [actionError, setActionError] = useState("");
  const [search, setSearch] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([]);

  const loadPlatformData = useCallback(async () => {
    setLoadingData(true);
    setActionError("");
    try {
      const [userSnapshot, propertySnapshot, reportSnapshot, roomImageSnapshot] = await Promise.all([
        getDocs(collection(db, "users")),
        getDocs(collection(db, "properties")),
        getDocs(collection(db, "reports")),
        getDocs(collection(db, "roomImages")).catch((error) => {
          console.warn("Unable to load legacy property image fallbacks:", error);
          return null;
        }),
      ]);
      const firstImageByProperty = new Map<string, string>();
      roomImageSnapshot?.docs.forEach((item) => {
        const room = item.data() as RoomImageRecord;
        const firstImage = room.imageUrls?.find(isRemoteImageUrl);
        if (room.propertyId && firstImage && !firstImageByProperty.has(room.propertyId)) firstImageByProperty.set(room.propertyId, firstImage);
      });
      setUsers(userSnapshot.docs.map((item) => ({ id: item.id, ...item.data() } as PlatformUser)));
      setProperties(propertySnapshot.docs.map((item) => {
        const property = { id: item.id, ...item.data() } as PropertyListing;
        const storedCover = isRemoteImageUrl(property.image) ? property.image : property.imageUrls?.find(isRemoteImageUrl);
        return { ...property, image: storedCover || firstImageByProperty.get(item.id) };
      }));
      setReports(reportSnapshot.docs.map((item) => ({ id: item.id, ...item.data() } as ReportRecord)));
    } catch (error) {
      console.error("Unable to load admin data:", error);
      setActionError("Unable to load platform data. Check your Firestore admin permissions.");
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser: FirebaseUser | null) => {
      if (!currentUser) {
        setAuthorized(false);
        setLoadingData(false);
        return;
      }
      try {
        const adminSnapshot = await getDoc(doc(db, "users", currentUser.uid));
        const adminData = adminSnapshot.data();
        if (adminData?.role !== "admin") {
          setAuthorized(false);
          setLoadingData(false);
          return;
        }
        setAdmin({ id: currentUser.uid, ...adminData } as PlatformUser);
        try {
          const savedIds = window.localStorage.getItem(`admin-notifications-read:${currentUser.uid}`);
          setReadNotificationIds(savedIds ? JSON.parse(savedIds) : []);
        } catch {
          setReadNotificationIds([]);
        }
        setAuthorized(true);
        await loadPlatformData();
      } catch (error) {
        console.error("Unable to verify admin access:", error);
        setAuthorized(false);
        setLoadingData(false);
      }
    });
    return () => unsubscribe();
  }, [loadPlatformData]);

  const buyers = useMemo(() => users.filter((user) => user.role === "buyer"), [users]);
  const brokers = useMemo(() => users.filter((user) => user.role === "broker"), [users]);
  const pendingBrokers = useMemo(() => brokers.filter((broker) => brokerStatus(broker) === "pending"), [brokers]);
  const notifications = useMemo<AdminNotification[]>(() => {
    const userNotifications = users
      .filter((user) => user.role === "buyer" || user.role === "broker")
      .map((user): AdminNotification => {
        const pending = user.role === "broker" && brokerStatus(user) === "pending";
        return {
          id: `user:${user.id}:${pending ? "verification" : "joined"}`,
          title: pending ? "Broker verification needed" : `New ${user.role} account`,
          detail: pending ? `${displayName(user)} is waiting for review.` : `${displayName(user)} joined LiBot.`,
          createdAt: user.createdAt,
          target: pending ? "verification" : user.role === "buyer" ? "buyers" : "brokers",
          tone: pending ? "amber" : "blue",
        };
      });
    const propertyNotifications = properties.map((property): AdminNotification => ({
      id: `property:${property.id}:created`,
      title: "New property listing",
      detail: property.title || "An untitled property was added.",
      createdAt: property.createdAt,
      target: "properties",
      tone: "emerald",
    }));
    const reportNotifications = reports
      .filter((report) => report.status === "open")
      .map((report): AdminNotification => ({
        id: `report:${report.id}:open`,
        title: "New safety report",
        detail: `${report.reporterRole || "User"} reported ${report.targetLabel || report.targetType || "an item"}.`,
        createdAt: report.createdAt,
        target: "reports",
        tone: "amber",
      }));
    return [...reportNotifications, ...userNotifications, ...propertyNotifications]
      .sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0))
      .slice(0, 12);
  }, [properties, reports, users]);
  const unreadCount = notifications.filter((notification) => !readNotificationIds.includes(notification.id)).length;
  const query = search.trim().toLowerCase();
  const filterUsers = (items: PlatformUser[]) => items.filter((user) =>
    !query || `${displayName(user)} ${user.email ?? ""} ${user.agencyName ?? ""}`.toLowerCase().includes(query),
  );

  const updateVerification = async (broker: PlatformUser, status: "verified" | "rejected") => {
    if (status === "rejected" && !rejectionReason.trim()) {
      setActionError("Add a rejection reason before rejecting this broker.");
      return;
    }
    setActionId(broker.id);
    setActionError("");
    try {
      const changes = status === "verified"
        ? { verificationStatus: status, rejectionReason: null, verifiedAt: serverTimestamp() }
        : { verificationStatus: status, rejectionReason: rejectionReason.trim(), rejectedAt: serverTimestamp() };
      await updateDoc(doc(db, "users", broker.id), changes);
      setUsers((current) => current.map((user) => user.id === broker.id
        ? { ...user, verificationStatus: status, rejectionReason: status === "rejected" ? rejectionReason.trim() : null }
        : user));
      setSelectedBroker(null);
      setRejectionReason("");
    } catch (error) {
      console.error("Unable to update broker verification:", error);
      setActionError("The broker status could not be updated.");
    } finally {
      setActionId(null);
    }
  };

  const toggleAccount = async (user: PlatformUser) => {
    const nextStatus = user.accountStatus === "inactive" ? "active" : "inactive";
    setActionId(user.id);
    try {
      await updateDoc(doc(db, "users", user.id), { accountStatus: nextStatus, updatedAt: serverTimestamp() });
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, accountStatus: nextStatus } : item));
    } catch (error) {
      console.error("Unable to update account:", error);
      setActionError("The account status could not be updated.");
    } finally {
      setActionId(null);
    }
  };

  const updateReportStatus = async (report: ReportRecord, status: "in_review" | "resolved" | "dismissed") => {
    const resolutionNote = status === "in_review"
      ? null
      : window.prompt(status === "resolved" ? "Add a resolution note for the reporter:" : "Explain why this report is being dismissed:", report.resolutionNote ?? "");
    if (status !== "in_review" && !resolutionNote?.trim()) {
      setActionError("A resolution note is required when resolving or dismissing a report.");
      return;
    }
    setActionId(report.id);
    setActionError("");
    try {
      const changes = { status, resolutionNote: resolutionNote?.trim() || null, reviewedBy: admin?.id ?? null, updatedAt: serverTimestamp(), ...(status !== "in_review" ? { resolvedAt: serverTimestamp() } : {}) };
      await updateDoc(doc(db, "reports", report.id), changes);
      setReports((current) => current.map((item) => item.id === report.id ? { ...item, status, resolutionNote: resolutionNote?.trim() || null, updatedAt: new Date() } : item));
    } catch (error) {
      console.error("Unable to update report:", error);
      setActionError("The report status could not be updated.");
    } finally {
      setActionId(null);
    }
  };

  const deactivateReportedUser = async (report: ReportRecord) => {
    const userId = report.reportedUserId;
    if (!userId) return;
    const reportedUser = users.find((user) => user.id === userId || user.uid === userId);
    if (!reportedUser || reportedUser.accountStatus === "inactive") return;
    if (!window.confirm(`Deactivate ${displayName(reportedUser)}? They will be signed out and blocked from using LiBot.`)) return;
    setActionId(report.id);
    setActionError("");
    try {
      await updateDoc(doc(db, "users", reportedUser.id), { accountStatus: "inactive", updatedAt: serverTimestamp() });
      await updateDoc(doc(db, "reports", report.id), { status: "resolved", resolution: "account_deactivated", resolutionNote: "The reported account was deactivated after administrator review.", reviewedBy: admin?.id ?? null, resolvedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      setUsers((current) => current.map((item) => item.id === reportedUser.id ? { ...item, accountStatus: "inactive" } : item));
      setReports((current) => current.map((item) => item.id === report.id ? { ...item, status: "resolved", resolutionNote: "The reported account was deactivated after administrator review.", updatedAt: new Date() } : item));
    } catch (error) {
      console.error("Unable to deactivate reported user:", error);
      setActionError("The reported account could not be deactivated.");
    } finally {
      setActionId(null);
    }
  };

  const togglePropertyArchive = async (property: PropertyListing) => {
    const nextStatus = property.status === "archived" ? "active" : "archived";
    setActionId(property.id);
    try {
      await updateDoc(doc(db, "properties", property.id), {
        status: nextStatus,
        archivedAt: nextStatus === "archived" ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      });
      setProperties((current) => current.map((item) => item.id === property.id ? { ...item, status: nextStatus } : item));
    } catch (error) {
      console.error("Unable to update property status:", error);
      setActionError("The property status could not be updated.");
    } finally {
      setActionId(null);
    }
  };

  const removeProperty = async (property: PropertyListing) => {
    if (!window.confirm(`Remove “${property.title || "this listing"}”? This cannot be undone.`)) return;
    setActionId(property.id);
    try {
      await deleteDoc(doc(db, "properties", property.id));
      setProperties((current) => current.filter((item) => item.id !== property.id));
      setSelectedProperty(null);
    } catch (error) {
      console.error("Unable to remove property:", error);
      setActionError("The property could not be removed.");
    } finally {
      setActionId(null);
    }
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut(auth);
      router.replace("/login");
    } catch (error) {
      console.error("Unable to sign out:", error);
      setSigningOut(false);
    }
  };

  if (authorized === null || (authorized && loadingData && !admin)) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50"><LoaderCircle className="animate-spin text-slate-700" size={38} /></div>;
  }

  if (!authorized) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <ShieldCheck className="mx-auto text-slate-400" size={44} />
          <h1 className="mt-4 text-2xl font-semibold text-slate-900">Admin access required</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">Sign in with an account whose Firestore user document has <code className="rounded bg-slate-100 px-1.5 py-0.5">role: admin</code>.</p>
          <button onClick={() => router.replace("/login")} className="mt-6 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white">Go to login</button>
        </div>
      </main>
    );
  }

  const selectSection = (nextSection: AdminSection) => {
    setSection(nextSection);
    setSidebarOpen(false);
    setSearch("");
    setActionError("");
  };

  const saveReadNotifications = (ids: string[]) => {
    setReadNotificationIds(ids);
    if (admin) window.localStorage.setItem(`admin-notifications-read:${admin.id}`, JSON.stringify(ids));
  };

  const openNotification = (notification: AdminNotification) => {
    if (!readNotificationIds.includes(notification.id)) {
      saveReadNotifications([...readNotificationIds, notification.id]);
    }
    setNotificationsOpen(false);
    selectSection(notification.target);
  };

  const markAllNotificationsRead = () => {
    saveReadNotifications(Array.from(new Set([...readNotificationIds, ...notifications.map((notification) => notification.id)])));
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {sidebarOpen && <button aria-label="Close navigation" onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden" />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[min(18rem,calc(100vw-2rem))] flex-col border-r border-slate-200 bg-white shadow-xl transition-transform lg:w-72 lg:translate-x-0 lg:shadow-none ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-24 items-center gap-3 border-b border-slate-200 px-7">
          <div className="relative h-11 w-11"><Image src="/logo.png" alt="LiBot" fill sizes="44px" className="object-contain" /></div>
          <div><p className="font-semibold">LiBot Admin</p><p className="text-xs text-slate-500">Platform operations</p></div>
          <button aria-label="Close menu" onClick={() => setSidebarOpen(false)} className="ml-auto p-2 lg:hidden"><X size={20} /></button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-5">
          <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Navigation</p>
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} onClick={() => selectSection(item.id)} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition ${section === item.id ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>
                <Icon size={19} /><span>{item.label}</span>
                {item.id === "verification" && pendingBrokers.length > 0 && <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${section === item.id ? "bg-white/15" : "bg-amber-100 text-amber-700"}`}>{pendingBrokers.length}</span>}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-slate-200 p-5">
          <div className="mb-3 rounded-xl bg-slate-50 px-4 py-3"><p className="truncate text-sm font-semibold">{admin ? displayName(admin) : "Administrator"}</p><p className="truncate text-xs text-slate-500">{admin?.email}</p></div>
          <button onClick={handleSignOut} disabled={signingOut} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"><LogOut size={19} />{signingOut ? "Signing out..." : "Logout"}</button>
        </div>
      </aside>

      <main className="lg:ml-72">
        <header className="sticky top-0 z-30 flex min-h-20 items-center border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-8">
          <button aria-label="Open navigation" onClick={() => setSidebarOpen(true)} className="mr-3 rounded-xl p-2 text-slate-700 hover:bg-slate-100 hover:text-blue-600 lg:hidden"><Menu size={23} /></button>
          <div className="min-w-0"><h1 className="truncate text-lg font-semibold sm:text-xl">{navigation.find((item) => item.id === section)?.label}</h1><p className="hidden text-sm text-slate-500 sm:block">Manage LiBot safely and efficiently.</p></div>
          <div className="relative ml-auto">
            <button aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)} className="relative flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">
              <Bell size={19} />
              {unreadCount > 0 && <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unreadCount > 9 ? "9+" : unreadCount}</span>}
            </button>
            {notificationsOpen && <NotificationPanel notifications={notifications} readIds={readNotificationIds} onOpen={openNotification} onMarkAll={markAllNotificationsRead} />}
          </div>
          <button onClick={loadPlatformData} disabled={loadingData} className="ml-2 shrink-0 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 sm:ml-3 sm:px-4 sm:text-sm">{loadingData ? "Refreshing..." : "Refresh"}</button>
        </header>

        <div className="p-4 sm:p-8 lg:p-10">
          {actionError && <div role="alert" className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700"><span>{actionError}</span><button onClick={() => setActionError("")}><X size={17} /></button></div>}
          {section === "dashboard" && <Dashboard buyers={buyers} brokers={brokers} pending={pendingBrokers} properties={properties} onNavigate={selectSection} />}
          {(section === "buyers" || section === "brokers") && (
            <UserManagement
              title={section === "buyers" ? "Buyer accounts" : "Broker accounts"}
              users={filterUsers(section === "buyers" ? buyers : brokers)}
              search={search}
              onSearch={setSearch}
              onView={section === "brokers" ? setSelectedBroker : undefined}
              onToggle={toggleAccount}
              actionId={actionId}
            />
          )}
          {section === "verification" && <VerificationQueue brokers={filterUsers(brokers)} search={search} onSearch={setSearch} onReview={setSelectedBroker} />}
          {section === "properties" && <PropertyManagement properties={properties} onView={setSelectedProperty} onToggleArchive={togglePropertyArchive} onRemove={removeProperty} actionId={actionId} />}
          {section === "reports" && <ReportManagement reports={reports} users={users} actionId={actionId} onStatus={updateReportStatus} onDeactivate={deactivateReportedUser} />}
          {section === "profile" && <AdminProfile admin={admin} onUpdate={setAdmin} />}
        </div>
      </main>

      {selectedBroker && (
        <BrokerReviewModal
          broker={selectedBroker}
          reason={rejectionReason}
          onReason={setRejectionReason}
          onClose={() => { setSelectedBroker(null); setRejectionReason(""); setActionError(""); }}
          onApprove={() => updateVerification(selectedBroker, "verified")}
          onReject={() => updateVerification(selectedBroker, "rejected")}
          working={actionId === selectedBroker.id}
        />
      )}
      {selectedProperty && <PropertyModal property={selectedProperty} onClose={() => setSelectedProperty(null)} onRemove={() => removeProperty(selectedProperty)} working={actionId === selectedProperty.id} />}
    </div>
  );
}

function NotificationPanel({ notifications, readIds, onOpen, onMarkAll }: { notifications: AdminNotification[]; readIds: string[]; onOpen: (notification: AdminNotification) => void; onMarkAll: () => void }) {
  const hasUnread = notifications.some((notification) => !readIds.includes(notification.id));
  const toneStyles = {
    amber: "bg-amber-100 text-amber-700",
    blue: "bg-blue-100 text-blue-700",
    emerald: "bg-emerald-100 text-emerald-700",
  };

  return <div className="fixed inset-x-4 top-20 z-50 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[min(24rem,calc(100vw-2rem))]">
    <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
      <div><h2 className="font-semibold text-slate-900">Notifications</h2><p className="text-xs text-slate-500">Recent platform activity</p></div>
      <button onClick={onMarkAll} disabled={!hasUnread} className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 disabled:text-slate-300"><CheckCheck size={15} />Mark all read</button>
    </div>
    <div className="max-h-[28rem] overflow-y-auto">
      {notifications.map((notification) => {
        const unread = !readIds.includes(notification.id);
        return <button key={notification.id} onClick={() => onOpen(notification)} className={`flex w-full gap-3 border-b border-slate-100 px-5 py-4 text-left transition hover:bg-slate-50 ${unread ? "bg-blue-50/40" : "bg-white"}`}>
          <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${toneStyles[notification.tone]}`}><Bell size={16} /></span>
          <span className="min-w-0 flex-1"><span className="flex items-start gap-2"><span className={`text-sm text-slate-900 ${unread ? "font-semibold" : "font-medium"}`}>{notification.title}</span>{unread && <span aria-label="Unread" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600" />}</span><span className="mt-1 block truncate text-xs text-slate-500">{notification.detail}</span><span className="mt-1.5 block text-[11px] font-medium text-slate-400">{formatNotificationTime(notification.createdAt)}</span></span>
        </button>;
      })}
      {notifications.length === 0 && <div className="px-6 py-10 text-center"><Bell className="mx-auto text-slate-300" size={30} /><p className="mt-3 text-sm font-medium text-slate-600">You&apos;re all caught up</p><p className="mt-1 text-xs text-slate-400">New platform activity will appear here.</p></div>}
    </div>
  </div>;
}

function Dashboard({ buyers, brokers, pending, properties, onNavigate }: { buyers: PlatformUser[]; brokers: PlatformUser[]; pending: PlatformUser[]; properties: PropertyListing[]; onNavigate: (section: AdminSection) => void }) {
  const cards = [
    { label: "Total Buyers", value: buyers.length, icon: UserRound, color: "bg-blue-50 text-blue-700", target: "buyers" as const },
    { label: "Total Brokers", value: brokers.length, icon: Building2, color: "bg-violet-50 text-violet-700", target: "brokers" as const },
    { label: "Pending Verifications", value: pending.length, icon: ClipboardCheck, color: "bg-amber-50 text-amber-700", target: "verification" as const },
    { label: "Property Listings", value: properties.length, icon: House, color: "bg-emerald-50 text-emerald-700", target: "properties" as const },
  ];
  return (
    <div className="space-y-8">
      <section><p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">Platform overview</p><h2 className="mt-2 text-3xl font-light sm:text-4xl">Good decisions start with a clear view.</h2><p className="mt-2 text-slate-600">Monitor users, verification applications, and property activity.</p></section>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, color, target }) => <button key={label} onClick={() => onNavigate(target)} className="rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:p-6"><div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${color}`}><Icon size={23} /></div><p className="mt-5 text-3xl font-light sm:mt-6">{value}</p><div className="mt-2 flex items-center justify-between text-sm text-slate-500"><span>{label}</span><ChevronRight size={16} /></div></button>)}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center justify-between"><h3 className="text-lg font-semibold">Verification priority</h3><button onClick={() => onNavigate("verification")} className="text-sm font-semibold text-blue-600">View queue</button></div><div className="mt-5 space-y-3">{pending.slice(0, 5).map((broker) => <div key={broker.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 p-4"><Avatar user={broker} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{displayName(broker)}</p><p className="truncate text-xs text-slate-500">{broker.agencyName || "Independent broker"}</p></div><StatusBadge status="pending" /></div>)}{pending.length === 0 && <EmptyState message="No broker applications are waiting for review." />}</div></div>
        <div className="rounded-3xl bg-slate-900 p-6 text-white shadow-sm"><ShieldCheck size={25} className="text-blue-300" /><h3 className="mt-5 text-2xl font-light">Verification protects the marketplace.</h3><p className="mt-3 text-sm leading-6 text-white/60">Review identification, professional details, and license information before allowing brokers to publish trusted listings.</p><button onClick={() => onNavigate("verification")} className="mt-7 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900">Review applications</button></div>
      </div>
    </div>
  );
}

function UserManagement({ title, users, search, onSearch, onView, onToggle, actionId }: { title: string; users: PlatformUser[]; search: string; onSearch: (value: string) => void; onView?: (user: PlatformUser) => void; onToggle: (user: PlatformUser) => void; actionId: string | null }) {
  return <section className="rounded-3xl border border-slate-200 bg-white shadow-sm"><PanelHeader title={title} search={search} onSearch={onSearch} /><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="border-y border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-6 py-4">User</th><th className="px-6 py-4">Contact</th><th className="px-6 py-4">Joined</th><th className="px-6 py-4">Status</th><th className="px-6 py-4 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{users.map((user) => <tr key={user.id}><td className="px-6 py-4"><div className="flex items-center gap-3"><Avatar user={user} /><div><p className="font-semibold">{displayName(user)}</p><p className="text-xs text-slate-500">{user.agencyName || user.role}</p></div></div></td><td className="px-6 py-4 text-sm text-slate-600"><p>{user.email || "No email"}</p><p className="text-xs text-slate-400">{user.phone || "No phone"}</p></td><td className="px-6 py-4 text-sm text-slate-600">{formatDate(user.createdAt)}</td><td className="px-6 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${user.accountStatus === "inactive" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{user.accountStatus === "inactive" ? "Inactive" : "Active"}</span></td><td className="px-6 py-4"><div className="flex justify-end gap-2">{onView && <button onClick={() => onView(user)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold hover:bg-slate-50">View</button>}<button onClick={() => onToggle(user)} disabled={actionId === user.id} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">{user.accountStatus === "inactive" ? "Reactivate" : "Deactivate"}</button></div></td></tr>)}{users.length === 0 && <tr><td colSpan={5}><EmptyState message="No matching users found." /></td></tr>}</tbody></table></div></section>;
}

function VerificationQueue({ brokers, search, onSearch, onReview }: { brokers: PlatformUser[]; search: string; onSearch: (value: string) => void; onReview: (broker: PlatformUser) => void }) {
  const ordered = brokers
    .filter((broker) => brokerStatus(broker) !== "verified")
    .sort((a, b) => ({ pending: 0, rejected: 1 })[brokerStatus(a) as "pending" | "rejected"] - ({ pending: 0, rejected: 1 })[brokerStatus(b) as "pending" | "rejected"]);
  return <section className="rounded-3xl border border-slate-200 bg-white shadow-sm"><PanelHeader title="Broker applications" search={search} onSearch={onSearch} /><div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">{ordered.map((broker) => <article key={broker.id} className="rounded-2xl border border-slate-200 p-5"><div className="flex items-start gap-3"><Avatar user={broker} large /><div className="min-w-0 flex-1"><p className="truncate font-semibold">{displayName(broker)}</p><p className="truncate text-sm text-slate-500">{broker.agencyName || "Independent broker"}</p></div><StatusBadge status={brokerStatus(broker)} /></div><div className="mt-5 space-y-2 text-sm text-slate-600"><p><span className="text-slate-400">Position:</span> {broker.position || "Not provided"}</p><p><span className="text-slate-400">Service area:</span> {broker.serviceArea || "Not provided"}</p><p><span className="text-slate-400">Government ID:</span> {broker.governmentId ? "Provided" : "Missing"}</p></div>{brokerStatus(broker) === "rejected" && broker.rejectionReason && <p className="mt-4 rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-700">{broker.rejectionReason}</p>}<button onClick={() => onReview(broker)} className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">Review application</button></article>)}{ordered.length === 0 && <div className="md:col-span-2 xl:col-span-3"><EmptyState message="No broker applications found." /></div>}</div></section>;
}

function PropertyManagement({ properties, onView, onToggleArchive, onRemove, actionId }: { properties: PropertyListing[]; onView: (property: PropertyListing) => void; onToggleArchive: (property: PropertyListing) => void; onRemove: (property: PropertyListing) => void; actionId: string | null }) {
  return <section className="rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="p-6"><h2 className="text-xl font-semibold">All property listings</h2><p className="mt-1 text-sm text-slate-500">Select a property to review its complete listing information.</p></div><div className="grid gap-4 border-t border-slate-200 p-5 md:grid-cols-2 xl:grid-cols-3">{properties.map((property) => <article key={property.id} className="overflow-hidden rounded-2xl border border-slate-200 transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"><button type="button" onClick={() => onView(property)} className="block w-full text-left"><div className="relative flex h-44 items-center justify-center overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200">{isRemoteImageUrl(property.image) ? <Image src={property.image} alt={`${property.title || "Property"} cover`} fill sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw" className="object-cover" /> : <House size={35} className="text-slate-400" />}</div><div className="p-5"><div className="flex items-start justify-between gap-3"><h3 className="font-semibold">{property.title || "Untitled property"}</h3><span className={`rounded-full px-2 py-1 text-xs font-semibold ${property.status === "archived" ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>{property.status || "active"}</span></div><p className="mt-2 line-clamp-1 text-sm text-slate-500">{property.location || "No location"}</p><div className="mt-3 flex items-end justify-between gap-3"><p className="text-lg font-semibold">₱{property.price || "Not provided"}</p><span className="text-xs font-semibold text-blue-600">View full details →</span></div></div></button><div className="flex flex-wrap gap-2 border-t border-slate-200 px-5 py-4"><button onClick={() => onToggleArchive(property)} disabled={actionId === property.id} className={`rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40 ${property.status === "archived" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"}`}>{actionId === property.id ? "Updating..." : property.status === "archived" ? "Activate" : "Archive"}</button><button onClick={() => onRemove(property)} disabled={actionId === property.id} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-40">Remove</button></div></article>)}{properties.length === 0 && <div className="md:col-span-2 xl:col-span-3"><EmptyState message="No property listings found." /></div>}</div></section>;
}

function ReportManagement({ reports, users, actionId, onStatus, onDeactivate }: { reports: ReportRecord[]; users: PlatformUser[]; actionId: string | null; onStatus: (report: ReportRecord, status: "in_review" | "resolved" | "dismissed") => void; onDeactivate: (report: ReportRecord) => void }) {
  const ordered = [...reports].sort((a, b) => {
    const priority = { open: 0, in_review: 1, resolved: 2, dismissed: 3 };
    const statusDifference = priority[a.status ?? "open"] - priority[b.status ?? "open"];
    if (statusDifference) return statusDifference;
    return (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0);
  });

  return <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="p-5 sm:p-6"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-600">Trust and safety</p><h2 className="mt-2 text-xl font-semibold">User reports</h2><p className="mt-1 text-sm text-slate-500">Review evidence before dismissing, resolving, or deactivating an account.</p></div><div className="grid gap-4 border-t border-slate-200 p-4 md:grid-cols-2 xl:grid-cols-3 sm:p-5">{ordered.map((report) => {
    const reportedUser = users.find((user) => user.id === report.reportedUserId || user.uid === report.reportedUserId);
    const status = report.status ?? "open";
    const busy = actionId === report.id;
    return <article key={report.id} className="flex flex-col rounded-2xl border border-slate-200 p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{report.targetType || "Report"}</p><h3 className="mt-1 truncate font-semibold">{report.targetLabel || "Reported item"}</h3></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${status === "open" ? "bg-red-50 text-red-700" : status === "in_review" ? "bg-amber-50 text-amber-700" : status === "resolved" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{status.replace("_", " ")}</span></div><div className="mt-4 rounded-xl bg-slate-50 p-4"><p className="text-sm font-semibold text-slate-800">{report.reason || "No reason supplied"}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{report.details || "No details supplied."}</p></div><div className="mt-4 space-y-1 text-xs text-slate-500"><p>Reporter: <span className="font-medium text-slate-700">{report.reporterRole || "Unknown"}</span></p>{reportedUser && <p>Reported account: <span className="font-medium text-slate-700">{displayName(reportedUser)} · {reportedUser.accountStatus === "inactive" ? "Inactive" : "Active"}</span></p>}<p>Submitted: <span className="font-medium text-slate-700">{formatDate(report.createdAt)}</span></p>{report.negotiationId && <p className="break-all">Negotiation: {report.negotiationId}</p>}</div><div className="mt-auto flex flex-wrap gap-2 border-t border-slate-200 pt-5">{status === "open" && <button onClick={() => onStatus(report, "in_review")} disabled={busy} className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 disabled:opacity-50">Review</button>}{status !== "resolved" && status !== "dismissed" && <button onClick={() => onStatus(report, "resolved")} disabled={busy} className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 disabled:opacity-50">Resolve</button>}{status !== "dismissed" && <button onClick={() => onStatus(report, "dismissed")} disabled={busy} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-50">Dismiss</button>}{reportedUser && reportedUser.accountStatus !== "inactive" && <button onClick={() => onDeactivate(report)} disabled={busy} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Deactivate account</button>}</div></article>;
  })}{ordered.length === 0 && <div className="md:col-span-2 xl:col-span-3"><EmptyState message="No reports have been submitted." /></div>}</div></section>;
}

function AdminProfile({ admin, onUpdate }: { admin: PlatformUser | null; onUpdate: (admin: PlatformUser) => void }) {
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => () => {
    if (photoPreview.startsWith("blob:")) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  if (!admin) return null;

  const picture = photoPreview || (isRemoteImageUrl(admin.profilePicture) ? admin.profilePicture : isRemoteImageUrl(admin.profilePhoto) ? admin.profilePhoto : "");

  const startEditing = () => {
    const nameParts = (admin.name ?? "").trim().split(/\s+/);
    setFirstName(admin.firstName ?? nameParts[0] ?? "");
    setLastName(admin.lastName ?? nameParts.slice(1).join(" "));
    setPhone(admin.phone ?? "");
    setPhotoFile(null);
    setPhotoPreview("");
    setMessage("");
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setPhotoFile(null);
    setPhotoPreview("");
    setMessage("");
  };

  const selectPhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      setMessage("Choose an image that is 5 MB or smaller.");
      event.target.value = "";
      return;
    }
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    setMessage("");
  };

  const saveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanedFirstName = firstName.trim();
    const cleanedLastName = lastName.trim();
    if (!cleanedFirstName || !cleanedLastName) {
      setMessage("First name and last name are required.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      let profilePicture = isRemoteImageUrl(admin.profilePicture) ? admin.profilePicture : isRemoteImageUrl(admin.profilePhoto) ? admin.profilePhoto : null;
      if (photoFile) profilePicture = await uploadImageToCloudinary(photoFile);
      const changes = {
        firstName: cleanedFirstName,
        lastName: cleanedLastName,
        name: `${cleanedFirstName} ${cleanedLastName}`,
        phone: phone.trim(),
        profilePicture,
        updatedAt: serverTimestamp(),
      };
      await updateDoc(doc(db, "users", admin.id), changes);
      onUpdate({ ...admin, ...changes });
      setEditing(false);
      setPhotoFile(null);
      setPhotoPreview("");
      setMessage("Profile updated successfully.");
    } catch (error) {
      console.error("Unable to update admin profile:", error);
      setMessage("Unable to save the profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return <section className="mx-auto max-w-3xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
    <div className="h-32 bg-gradient-to-r from-slate-900 to-blue-800" />
    <div className="px-6 pb-8 sm:px-8">
      <div className="flex items-end justify-between gap-4">
        <div role={picture ? "img" : undefined} aria-label={picture ? `${displayName(admin)} profile picture` : undefined} style={picture ? { backgroundImage: `url(${picture})` } : undefined} className="-mt-12 flex h-24 w-24 items-center justify-center rounded-3xl border-4 border-white bg-slate-100 bg-cover bg-center shadow-md">
          {!picture && <ShieldCheck size={38} className="text-slate-700" />}
        </div>
        {!editing && <button onClick={startEditing} className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"><Pencil size={16} />Edit profile</button>}
      </div>
      {editing ? <form onSubmit={saveProfile} className="mt-6 space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Camera size={16} />Change photo<input type="file" accept="image/*" onChange={selectPhoto} className="sr-only" /></label>
          <span className="text-xs text-slate-500">JPG, PNG, or WebP up to 5 MB</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <ProfileField label="First name" value={firstName} onChange={setFirstName} autoComplete="given-name" />
          <ProfileField label="Last name" value={lastName} onChange={setLastName} autoComplete="family-name" />
          <ProfileField label="Phone number" value={phone} onChange={setPhone} type="tel" autoComplete="tel" />
          <label className="text-sm font-semibold text-slate-700">Email address<input value={admin.email ?? ""} disabled className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-100 px-4 font-normal text-slate-500" /><span className="mt-1 block text-xs font-normal text-slate-400">Sign-in email cannot be changed here.</span></label>
        </div>
        {message && <p role="alert" className="text-sm text-red-600">{message}</p>}
        <div className="flex justify-end gap-3 border-t border-slate-200 pt-5"><button type="button" onClick={cancelEditing} disabled={saving} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600">Cancel</button><button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Save size={16} />{saving ? "Saving..." : "Save changes"}</button></div>
      </form> : <>
        <div className="mt-5 flex items-center gap-2"><h2 className="text-3xl font-light">{displayName(admin)}</h2><BadgeCheck className="text-blue-600" size={21} /></div>
        <p className="mt-1 text-slate-500">{admin.email}</p>
        {message && <p role="status" className="mt-4 text-sm font-medium text-emerald-700">{message}</p>}
        <div className="mt-7 grid gap-4 sm:grid-cols-2"><InfoBox label="Role" value="Administrator" /><InfoBox label="Account status" value={admin.accountStatus === "inactive" ? "Inactive" : "Active"} /><InfoBox label="Phone" value={admin.phone || "Not provided"} /><InfoBox label="Member since" value={formatDate(admin.createdAt)} /></div>
      </>}
    </div>
  </section>;
}

function ProfileField({ label, value, onChange, type = "text", autoComplete }: { label: string; value: string; onChange: (value: string) => void; type?: string; autoComplete?: string }) {
  return <label className="text-sm font-semibold text-slate-700">{label}<input required={label !== "Phone number"} type={type} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 font-normal outline-none focus:border-slate-400 focus:bg-white" /></label>;
}

function BrokerReviewModal({ broker, reason, onReason, onClose, onApprove, onReject, working }: { broker: PlatformUser; reason: string; onReason: (value: string) => void; onClose: () => void; onApprove: () => void; onReject: () => void; working: boolean }) {
  const governmentIdUrl = isRemoteImageUrl(broker.governmentId) ? broker.governmentId : null;
  const status = brokerStatus(broker);

  return <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:items-center sm:p-4"><div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white shadow-2xl sm:max-h-[92vh]"><div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 sm:px-6 sm:py-5"><div><h2 className="text-xl font-semibold">{status === "verified" ? "Broker details" : "Broker application"}</h2><p className="text-sm text-slate-500">{status === "verified" ? "View the broker’s verified professional information." : "Review identity and professional information."}</p></div><button onClick={onClose} disabled={working} aria-label="Close"><X size={22} /></button></div><div className="space-y-6 p-5 sm:p-6"><div className="flex flex-wrap items-center gap-4"><Avatar user={broker} large /><div className="min-w-0 flex-1"><h3 className="truncate text-xl font-semibold">{displayName(broker)}</h3><p className="truncate text-sm text-slate-500">{broker.email}</p></div><StatusBadge status={status} /></div><div className="grid gap-4 sm:grid-cols-2"><InfoBox label="Agency" value={broker.agencyName || "Independent"} /><InfoBox label="Position" value={broker.position || "Not provided"} /><InfoBox label="Service area" value={broker.serviceArea || "Not provided"} /><InfoBox label="PRC license" value={broker.prcLicense || "Not provided"} /></div><div><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Experience</p><p className="mt-2 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">{broker.experience || "Not provided"}</p></div><div className="rounded-2xl border border-slate-200 p-5"><p className="font-semibold">Government-issued ID</p>{governmentIdUrl ? <a href={governmentIdUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-full bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700">Open uploaded ID</a> : <p className="mt-2 text-sm text-amber-700">{broker.governmentId ? `Legacy file reference: ${broker.governmentId}. The original file is not available.` : "No government ID was uploaded."}</p>}</div>{status !== "verified" && <label className="block text-sm font-semibold text-slate-700">Rejection reason<textarea value={reason} onChange={(event) => onReason(event.target.value)} rows={3} placeholder="Required when rejecting an application" className="mt-2 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-normal outline-none focus:border-slate-400" /></label>}<div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">{status === "verified" ? <button onClick={onClose} className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white">Close</button> : <><button onClick={onReject} disabled={working} className="inline-flex items-center justify-center gap-2 rounded-full bg-red-50 px-5 py-2.5 text-sm font-semibold text-red-700 disabled:opacity-50"><XCircle size={17} />Reject</button><button onClick={onApprove} disabled={working} className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><CheckCircle2 size={17} />{working ? "Updating..." : "Approve broker"}</button></>}</div></div></div></div>;
}

function PropertyModal({ property, onClose, onRemove, working }: { property: PropertyListing; onClose: () => void; onRemove: () => void; working: boolean }) {
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-4"><div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white shadow-2xl sm:max-h-[92vh]"><div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-5 py-4 sm:px-7 sm:py-5"><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Complete property details</p><h2 className="mt-1 text-2xl font-semibold">{property.title || "Untitled property"}</h2></div><button onClick={onClose} aria-label="Close property details" className="rounded-full p-2 hover:bg-slate-100"><X size={21} /></button></div>{isRemoteImageUrl(property.image) ? <div className="relative h-56 overflow-hidden bg-slate-100 sm:h-80"><Image src={property.image} alt={`${property.title || "Property"} cover`} fill sizes="(min-width: 1024px) 56rem, 100vw" className="object-cover" /></div> : <div className="flex h-44 items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200"><House size={45} className="text-slate-400" /></div>}<div className="space-y-7 p-5 sm:p-7"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><InfoBox label="Price" value={`${property.currency === "PHP" || !property.currency ? "₱" : `${property.currency} `}${property.price || "Not provided"}`} /><InfoBox label="Property type" value={property.propertyType || "Not provided"} /><InfoBox label="Bedrooms" value={property.beds == null ? "Not provided" : String(property.beds)} /><InfoBox label="Bathrooms" value={property.baths == null ? "Not provided" : String(property.baths)} /></div><div className="grid gap-4 sm:grid-cols-2"><InfoBox label="Listing status" value={property.status || "active"} /><InfoBox label="Availability" value={property.availabilityStatus || "Not provided"} /><InfoBox label="Created" value={formatDate(property.createdAt)} /><InfoBox label="Last updated" value={formatDate(property.updatedAt)} /></div><section><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Location</p><p className="mt-2 text-sm font-medium text-slate-800">{property.location || "Not provided"}</p>{typeof property.latitude === "number" && typeof property.longitude === "number" && <a href={`https://www.openstreetmap.org/?mlat=${property.latitude}&mlon=${property.longitude}#map=17/${property.latitude}/${property.longitude}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-semibold text-blue-600">{property.latitude.toFixed(6)}, {property.longitude.toFixed(6)} · Open map →</a>}</section><section><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Description</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{property.description || "No description provided."}</p></section><section><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Amenities</p>{property.amenities?.length ? <div className="mt-3 flex flex-wrap gap-2">{property.amenities.map((amenity) => <span key={amenity} className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">{amenity}</span>)}</div> : <p className="mt-2 text-sm text-slate-500">No amenities listed.</p>}</section><div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Broker ID</p><p className="mt-2 break-all text-sm text-slate-700">{property.brokerId || "Not provided"}</p></div><div className="flex justify-end gap-3 border-t border-slate-200 pt-5"><button onClick={onClose} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600">Close</button><button onClick={onRemove} disabled={working} className="inline-flex items-center gap-2 rounded-full bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 disabled:opacity-50"><Trash2 size={16} />{working ? "Removing..." : "Remove listing"}</button></div></div></div></div>;
}

function PanelHeader({ title, search, onSearch }: { title: string; search: string; onSearch: (value: string) => void }) {
  return <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-semibold">{title}</h2><p className="mt-1 text-sm text-slate-500">Search and manage platform accounts.</p></div><label className="relative block"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search users..." className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-slate-400 sm:w-64" /></label></div>;
}

function Avatar({ user, large = false }: { user: PlatformUser; large?: boolean }) {
  const picture = isRemoteImageUrl(user.profilePhoto) ? user.profilePhoto : isRemoteImageUrl(user.profilePicture) ? user.profilePicture : null;
  return <div role={picture ? "img" : undefined} aria-label={picture ? `${displayName(user)} profile picture` : undefined} style={picture ? { backgroundImage: `url(${picture})` } : undefined} className={`flex shrink-0 items-center justify-center rounded-xl bg-slate-100 bg-cover bg-center text-slate-500 ${large ? "h-14 w-14" : "h-10 w-10"}`}>{!picture && <UserRound size={large ? 25 : 19} />}</div>;
}

function StatusBadge({ status }: { status: VerificationStatus }) {
  const style = status === "verified" ? "bg-emerald-50 text-emerald-700" : status === "rejected" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700";
  return <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${style}`}>{status}</span>;
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-2 break-words text-sm font-medium text-slate-700">{value}</p></div>;
}

function EmptyState({ message }: { message: string }) {
  return <div className="p-10 text-center"><UsersRound className="mx-auto text-slate-300" size={34} /><p className="mt-3 text-sm text-slate-500">{message}</p></div>;
}
