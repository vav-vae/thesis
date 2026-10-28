"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, LoaderCircle, Trash2 } from "lucide-react";
import { auth } from "@/lib/firebase";
import { PANORAMA_API_URL } from "@/lib/panorama-api";

type Device = { id: string; platform?: string; enabled?: boolean };
const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const toBytes = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));

export default function PushNotificationSettings() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [state, setState] = useState<"loading" | "unsupported" | "disabled" | "enabled" | "denied" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const api = async (path: string, init: RequestInit = {}) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Sign in before managing notifications.");
    const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${await user.getIdToken()}`);
    return fetch(`${PANORAMA_API_URL}${path}`, { ...init, headers, cache: "no-store" });
  };

  const refresh = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !vapidKey) { setState("unsupported"); return; }
    try { const response = await api("/notifications/subscriptions"); if (!response.ok) throw new Error("Could not load devices."); const data = await response.json(); const registered = data.subscriptions || []; setDevices(registered); const permission = Notification.permission; setState(permission === "denied" ? "denied" : registered.length ? "enabled" : "disabled"); }
    catch { setState("error"); setMessage("Notification settings could not be loaded."); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);

  const enable = async () => {
    setBusy(true); setMessage("");
    try {
      if (!vapidKey || !("serviceWorker" in navigator) || !("PushManager" in window)) { setState("unsupported"); return; }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "denied" : "disabled"); return; }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(vapidKey) });
      const response = await api("/notifications/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint, keys: subscription.toJSON().keys, platform: /iPhone|iPad/i.test(navigator.userAgent) ? "ios" : /Android/i.test(navigator.userAgent) ? "android" : "desktop" }) });
      if (!response.ok) throw new Error("Could not register this device.");
      setMessage("Push notifications are enabled on this device."); await refresh(); setState("enabled");
    } catch (error) { setState("error"); setMessage(error instanceof Error ? error.message : "Push notifications could not be enabled."); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => { setBusy(true); try { const response = await api(`/notifications/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" }); if (!response.ok) throw new Error("Device could not be removed."); setDevices((current) => current.filter((device) => device.id !== id)); setMessage("Device removed."); } catch { setMessage("Device could not be removed."); } finally { setBusy(false); } };

  return <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="flex gap-3 border-b border-slate-200 p-5 sm:p-6"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Bell size={19} /></span><div><h2 className="font-semibold">Push notifications</h2><p className="mt-1 text-sm leading-6 text-slate-500">Receive generic activity updates even when LiBot is closed.</p></div></div><div className="p-5 sm:p-6"><p className="text-sm text-slate-600">{state === "unsupported" ? "Push notifications are not supported or are not configured for this deployment." : state === "denied" ? "Notifications are blocked. Allow them in your browser settings, then try again." : message || (devices.length ? `${devices.length} device${devices.length === 1 ? "" : "s"} enabled.` : "Notifications are currently disabled on this device.")}</p><div className="mt-4 flex flex-wrap gap-3"><button onClick={() => void enable()} disabled={busy || state === "unsupported" || state === "denied"} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="animate-spin" size={16} /> : <Bell size={16} />}Enable push notifications</button>{devices.map((device) => <button key={device.id} onClick={() => void remove(device.id)} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"><Trash2 size={15} />Remove {device.platform || "device"}</button>)}</div></div></section>;
}
