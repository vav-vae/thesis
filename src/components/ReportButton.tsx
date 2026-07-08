"use client";

import { FormEvent, useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { Flag, X } from "lucide-react";
import { auth, db } from "@/lib/firebase";

type ReportTarget = "user" | "property";

const reasons = [
  "Misleading or false information",
  "Suspected fraud or scam",
  "Harassment or inappropriate behavior",
  "Spam or fake offer",
  "Missed viewing or repeated no-show",
  "Other",
];

export default function ReportButton({ reporterRole, targetType, targetId, targetLabel, reportedUserId, propertyId, negotiationId, className = "", buttonLabel = "Report" }: { reporterRole: "buyer" | "broker"; targetType: ReportTarget; targetId: string; targetLabel: string; reportedUserId?: string; propertyId?: string; negotiationId?: string; className?: string; buttonLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const close = () => {
    if (saving) return;
    setOpen(false);
    setError("");
    setSubmitted(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const user = auth.currentUser;
    if (!user) { setError("Sign in before submitting a report."); return; }
    if (!reason) { setError("Choose a reason for this report."); return; }
    if (details.trim().length < 10) { setError("Add at least 10 characters explaining what happened."); return; }
    setSaving(true);
    setError("");
    try {
      const contextId = negotiationId || propertyId || "general";
      const reportId = `${user.uid}_${targetType}_${targetId}_${contextId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
      const reportRef = doc(db, "reports", reportId);
      await setDoc(reportRef, {
        reporterId: user.uid,
        reporterRole,
        targetType,
        targetId,
        targetLabel,
        reportedUserId: reportedUserId || null,
        propertyId: propertyId || null,
        negotiationId: negotiationId || null,
        reason,
        details: details.trim(),
        status: "open",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setSubmitted(true);
      setReason("");
      setDetails("");
    } catch (submitError) {
      console.error("Unable to submit report:", submitError);
      setError("The report could not be submitted. Check your connection or permissions.");
    } finally {
      setSaving(false);
    }
  };

  return <>
    <button type="button" onClick={() => setOpen(true)} className={`inline-flex items-center justify-center gap-2 text-sm font-semibold text-red-600 hover:text-red-700 ${className}`}><Flag size={16} />{buttonLabel}</button>
    {open && <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:items-center sm:p-4"><div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 text-slate-900 shadow-2xl sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-600">Safety report</p><h2 className="mt-2 text-2xl font-semibold">Report {targetLabel}</h2><p className="mt-1 text-sm leading-6 text-slate-500">Reports are private and reviewed by an administrator.</p></div><button type="button" aria-label="Close report dialog" onClick={close} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button></div>{submitted ? <div className="mt-6 rounded-2xl bg-emerald-50 p-5 text-sm text-emerald-800"><p className="font-semibold">Report submitted</p><p className="mt-1 leading-6">An administrator can now review the information you provided.</p><button type="button" onClick={close} className="mt-5 rounded-full bg-emerald-700 px-5 py-2.5 font-semibold text-white">Done</button></div> : <form onSubmit={submit} className="mt-6 space-y-4"><label className="block text-sm font-semibold text-slate-700">Reason<select required value={reason} onChange={(event) => setReason(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-4 font-normal outline-none focus:border-red-300"><option value="">Choose a reason</option>{reasons.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label className="block text-sm font-semibold text-slate-700">What happened?<textarea required rows={5} value={details} onChange={(event) => setDetails(event.target.value)} maxLength={1000} placeholder="Include relevant details without sharing passwords or sensitive financial information." className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-4 py-3 font-normal outline-none focus:border-red-300" /><span className="mt-1 block text-right text-xs font-normal text-slate-400">{details.length}/1000</span></label>{error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}<div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end"><button type="button" onClick={close} disabled={saving} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600">Cancel</button><button disabled={saving} className="rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Submitting..." : "Submit report"}</button></div></form>}</div></div>}
  </>;
}
