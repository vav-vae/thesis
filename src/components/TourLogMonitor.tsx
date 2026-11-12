"use client";

import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

type TourLog = {
  id: string; brokerId: string; sessionId: string; propertyId: string;
  level: "info" | "error"; message: string; detail: string;
  page: string; browser: string; online: boolean; clientTime: string; createdAt?: Timestamp;
};

export default function TourLogMonitor() {
  const [logs, setLogs] = useState<TourLog[]>([]);
  const [status, setStatus] = useState("Connecting…");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("all");
  const [paused, setPaused] = useState(false);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    if (paused) return;
    return onSnapshot(query(collection(db, "tourLogs"), orderBy("createdAt", "desc"), limit(200)), { includeMetadataChanges: true }, (snapshot) => {
      setLogs(snapshot.docs.map((item) => ({ ...item.data(), id: item.id }) as TourLog));
      setError("");
      setStatus(snapshot.metadata.fromCache ? "Cached · waiting for server" : "Live");
    }, (failure) => {
      setStatus("Disconnected");
      setError(`Cannot read tour logs (${failure.code}). Check your connection and ensure the tourLogs Firestore rules are deployed.`);
    });
  }, [paused]);

  const filtered = logs.filter((log) => (level === "all" || log.level === level)
    && [log.message, log.detail, log.brokerId, log.propertyId, log.sessionId].join(" ").toLowerCase().includes(search.toLowerCase()));

  async function copy(log: TourLog) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(log, null, 2));
      setCopied(log.id);
    } catch { setCopied("failed"); }
  }

  return <section className="space-y-5" aria-label="Virtual tour logs">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="text-xl font-semibold text-slate-900">Virtual tour logs</h2><p className="mt-1 text-sm text-slate-600">Broker capture, validation, generation and publishing events. Latest 200 events, newest first.</p></div>
      <div className="flex items-center gap-3"><span role="status" className="text-sm font-medium">{paused ? "Paused" : status}</span><button type="button" onClick={() => setPaused(!paused)} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm">{paused ? "Resume live feed" : "Pause feed"}</button></div>
    </div>
    <p className="text-sm text-slate-600">{logs.filter((log) => log.level === "error").length} errors in loaded events · {new Set(logs.map((log) => log.sessionId)).size} sessions. Browser reports are best effort; offline or closed tabs may miss events. These are client diagnostics, not server console logs.</p>
    <div className="flex flex-wrap gap-3">
      <input aria-label="Search tour logs" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search error, broker ID, property ID or session…" className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" />
      <select aria-label="Log severity" value={level} onChange={(event) => setLevel(event.target.value)} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm"><option value="all">All events</option><option value="error">Errors only</option><option value="info">Information</option></select>
    </div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {copied === "failed" && <p role="alert">Could not copy. Select the details manually.</p>}
    {!filtered.length && <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">{logs.length ? "No events match these filters." : "No events received yet. New broker tour activity will appear here."}</p>}
    <div className="space-y-3">{filtered.map((log) => <article key={log.id} className={`rounded-xl border bg-white p-4 ${log.level === "error" ? "border-red-200" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-center gap-3 text-xs"><span className={log.level === "error" ? "font-bold text-red-700" : "font-bold text-teal-700"}>{log.level.toUpperCase()}</span><time>{log.createdAt?.toDate().toLocaleString() ?? "Time pending"}</time><button type="button" onClick={() => void copy(log)} className="ml-auto rounded-lg border px-3 py-1">{copied === log.id ? "Copied" : "Copy event"}</button></div>
      <p className="mt-2 break-words text-sm font-semibold text-slate-900">{log.message}</p>
      <p className="mt-2 break-all text-xs text-slate-600">Broker: {log.brokerId} · Property: {log.propertyId || "Not selected"} · Session: {log.sessionId}</p>
      <details className="mt-3 text-sm"><summary className="cursor-pointer text-teal-800">Diagnostic details</summary><p className="mt-2 break-all text-xs text-slate-600">{log.page} · {log.online ? "Online" : "Offline"} · Client time: {log.clientTime}<br />{log.browser}</p><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-4 text-xs text-slate-100">{log.detail || "No additional details."}</pre></details>
    </article>)}</div>
  </section>;
}
