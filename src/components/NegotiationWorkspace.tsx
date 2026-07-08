"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { arrayUnion, collection, doc, getDoc, onSnapshot, query, Timestamp, updateDoc, where } from "firebase/firestore";
import { Archive, ArrowLeft, Building2, CalendarDays, Check, ChevronLeft, ClipboardCheck, Handshake, Home, Mail, MapPin, Phone, Search, Send, UserRound, X } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import ReportButton from "@/components/ReportButton";

type Role = "buyer" | "broker";
type Status = "active" | "accepted" | "rejected";
type Message = { id: string; senderId: string; senderRole: Role; text: string; offerAmount?: number; createdAt?: Timestamp };
type ContactDetails = { name?: string; email?: string; phone?: string };
type ViewingDetails = { scheduledFor?: string; location?: string; notes?: string; scheduledBy?: string; updatedAt?: Timestamp };
type DealChecklist = { viewingCompleted?: boolean; documentsPrepared?: boolean; finalAgreementSigned?: boolean };
type Negotiation = {
  id: string;
  propertyId: string;
  propertyTitle?: string;
  listingPrice?: string | number;
  buyerId: string;
  buyerName?: string;
  brokerId: string;
  brokerName?: string;
  status?: Status;
  messages?: Message[];
  updatedAt?: Timestamp;
  agreedPrice?: number;
  buyerContact?: ContactDetails;
  brokerContact?: ContactDetails;
  viewing?: ViewingDetails;
  dealChecklist?: DealChecklist;
  archivedBy?: string[];
};

const money = (value?: string | number) => value === undefined || value === "" ? "Not provided" : `₱${Number(value).toLocaleString("en-PH")}`;

export default function NegotiationWorkspace({ role }: { role: Role }) {
  const [userId, setUserId] = useState("");
  const [items, setItems] = useState<Negotiation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const [offer, setOffer] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => onAuthStateChanged(auth, (user) => {
    setUserId(user?.uid ?? "");
    if (!user) setLoading(false);
  }), []);

  useEffect(() => {
    if (!userId) return;
    const participantQuery = query(
      collection(db, "negotiations"),
      where(role === "buyer" ? "buyerId" : "brokerId", "==", userId),
    );
    return onSnapshot(participantQuery, (snapshot) => {
      const records = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() } as Negotiation))
        .filter((item) => !item.archivedBy?.includes(userId))
        .sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
      setItems(records);
      setSelectedId((current) => current && records.some((item) => item.id === current) ? current : records[0]?.id ?? "");
      setLoading(false);
    }, (snapshotError) => {
      console.error("Unable to load negotiations:", snapshotError);
      setError("Unable to load negotiations. Check your Firestore permissions.");
      setLoading(false);
    });
  }, [role, userId]);

  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);
  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => !term || `${item.propertyTitle ?? ""} ${item.buyerName ?? ""} ${item.brokerName ?? ""}`.toLowerCase().includes(term));
  }, [items, search]);
  const latestOfferMessage = selected?.messages?.filter((item) => item.offerAmount).at(-1);
  const latestOffer = latestOfferMessage?.offerAmount;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ block: "end" }));
    return () => window.cancelAnimationFrame(frame);
  }, [selectedId, selected?.messages?.length]);

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !userId || working || (!message.trim() && !offer)) return;
    const offerAmount = offer ? Number(offer) : undefined;
    if (offer && (!Number.isFinite(offerAmount) || Number(offerAmount) <= 0)) {
      setError("Enter a valid offer amount.");
      return;
    }
    setWorking(true);
    setError("");
    try {
      await updateDoc(doc(db, "negotiations", selected.id), {
        messages: arrayUnion({
          id: crypto.randomUUID(),
          senderId: userId,
          senderRole: role,
          text: message.trim() || (role === "buyer" ? "I would like to make an offer." : "Here is my counteroffer."),
          ...(offerAmount ? { offerAmount } : {}),
          createdAt: Timestamp.now(),
        }),
        updatedAt: Timestamp.now(),
      });
      setMessage("");
      setOffer("");
    } catch (sendError) {
      console.error("Unable to send negotiation message:", sendError);
      setError("Your message could not be sent.");
    } finally {
      setWorking(false);
    }
  };

  const setStatus = async (status: "accepted" | "rejected") => {
    if (!selected || working || (status === "rejected" && role !== "broker")) return;
    if (role === "buyer" && (status !== "accepted" || latestOfferMessage?.senderRole !== "broker")) return;
    setWorking(true);
    setError("");
    try {
      let contactChanges = {};
      if (status === "accepted") {
        const [buyerSnapshot, brokerSnapshot] = await Promise.all([
          getDoc(doc(db, "users", selected.buyerId)),
          getDoc(doc(db, "users", selected.brokerId)),
        ]);
        const buyer = buyerSnapshot.data();
        const broker = brokerSnapshot.data();
        contactChanges = {
          buyerContact: { name: selected.buyerName || buyer?.name || "Buyer", email: buyer?.email || "", phone: buyer?.phone || "" },
          brokerContact: { name: selected.brokerName || broker?.name || "Broker", email: broker?.email || "", phone: broker?.phone || "" },
          dealChecklist: selected.dealChecklist ?? { viewingCompleted: false, documentsPrepared: false, finalAgreementSigned: false },
        };
      }
      await updateDoc(doc(db, "negotiations", selected.id), {
        status,
        updatedAt: Timestamp.now(),
        ...contactChanges,
        ...(status === "accepted" ? {
          acceptedBy: userId,
          acceptedByRole: role,
          agreedPrice: latestOffer ?? null,
          acceptedAt: Timestamp.now(),
        } : {}),
      });
    } catch (statusError) {
      console.error("Unable to update negotiation:", statusError);
      setError("The negotiation status could not be updated.");
    } finally {
      setWorking(false);
    }
  };

  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-6 lg:p-8">
    <div className="mx-auto max-w-[90rem]">
      <div className="flex items-center justify-between gap-4">
        <Link href={role === "buyer" ? "/buyer" : "/broker"} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900"><ArrowLeft size={16} />Dashboard</Link>
        <span className="hidden rounded-full bg-white px-4 py-2 text-xs font-medium text-slate-500 shadow-sm sm:block">Private conversation · Buyer and broker only</span>
      </div>
      <div className="mt-6"><p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-600">Negotiation center</p><h1 className="mt-2 text-3xl font-light tracking-tight sm:text-4xl">Offers, without the back-and-forth chaos.</h1><p className="mt-2 text-sm leading-6 text-slate-500">Keep the conversation, proposed prices, and final decision together.</p></div>
      {error && <div role="alert" className="mt-5 flex items-center justify-between rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError("")}><X size={17} /></button></div>}

      {loading ? <div className="mt-7 grid h-[38rem] animate-pulse overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white lg:grid-cols-[23rem_1fr]"><div className="border-r border-slate-100 bg-slate-50" /></div> : items.length === 0 ? <div className="mt-7 rounded-[1.75rem] border border-dashed border-slate-300 bg-white px-6 py-16 text-center shadow-sm"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50"><Handshake className="text-blue-500" size={30} /></div><h2 className="mt-5 text-xl font-semibold">No negotiations yet</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{role === "buyer" ? "When a property catches your eye, submit an offer to begin a private conversation with its broker." : "New offers from buyers will appear here, ready for your response."}</p>{role === "buyer" && <Link href="/buyer/properties" className="mt-6 inline-flex rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white">Browse properties</Link>}</div>
        : <div className="mt-7 grid h-[calc(100vh-15rem)] min-h-[38rem] max-h-[52rem] overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-xl shadow-slate-200/50 lg:grid-cols-[23rem_1fr]">
          <aside className={`${mobileChatOpen ? "hidden" : "flex"} min-h-0 flex-col border-slate-200 lg:flex lg:border-r`}>
            <div className="border-b border-slate-200 p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Conversations</h2><p className="mt-0.5 text-xs text-slate-500">{items.length} {items.length === 1 ? "thread" : "threads"}</p></div><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><Handshake size={17} /></div></div><label className="relative mt-4 block"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search property or person" className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:border-slate-300 focus:bg-white" /></label></div>
            <div className="min-h-0 flex-1 overflow-y-auto">{filteredItems.map((item) => { const last = item.messages?.at(-1); const participant = role === "buyer" ? item.brokerName || "Property broker" : item.buyerName || "Buyer"; return <button key={item.id} onClick={() => { setSelectedId(item.id); setMobileChatOpen(true); }} className={`relative w-full border-b border-slate-100 px-5 py-4 text-left transition hover:bg-slate-50 ${selectedId === item.id ? "bg-blue-50/70 before:absolute before:inset-y-3 before:left-0 before:w-1 before:rounded-r-full before:bg-blue-600" : ""}`}><div className="flex gap-3"><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${selectedId === item.id ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}>{role === "buyer" ? <Building2 size={18} /> : <UserRound size={18} />}</div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className="truncate text-sm font-semibold">{item.propertyTitle || "Property"}</p><Status status={item.status ?? "active"} /></div><p className="mt-0.5 truncate text-xs text-slate-500">{participant}</p><p className={`mt-2 truncate text-xs ${last?.offerAmount ? "font-semibold text-blue-600" : "text-slate-400"}`}>{last?.offerAmount ? `Latest proposal · ${money(last.offerAmount)}` : last?.text || "Negotiation started"}</p></div></div></button>; })}{filteredItems.length === 0 && <div className="p-8 text-center text-sm text-slate-400">No conversations match your search.</div>}</div>
          </aside>

          {selected && <section className={`${mobileChatOpen ? "flex" : "hidden"} min-h-0 flex-col lg:flex`}>
            <div className="flex justify-end border-b border-slate-100 bg-white px-4 py-2 sm:px-6"><ReportButton reporterRole={role} targetType="user" targetId={role === "buyer" ? selected.brokerId : selected.buyerId} reportedUserId={role === "buyer" ? selected.brokerId : selected.buyerId} targetLabel={role === "buyer" ? selected.brokerName || "this broker" : selected.buyerName || "this buyer"} propertyId={selected.propertyId} negotiationId={selected.id} className="rounded-lg px-3 py-2 hover:bg-red-50" /></div>
            <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6"><div className="flex items-center gap-3"><button aria-label="Back to conversations" onClick={() => setMobileChatOpen(false)} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 lg:hidden"><ChevronLeft size={21} /></button><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-500 text-white shadow-sm">{role === "buyer" ? <Building2 size={20} /> : <UserRound size={20} />}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="truncate font-semibold">{selected.propertyTitle || "Property negotiation"}</h2><Status status={selected.status ?? "active"} /></div><p className="mt-0.5 truncate text-xs text-slate-500">with {role === "buyer" ? selected.brokerName || "Property broker" : selected.buyerName || "Buyer"}</p></div><Link href={role === "buyer" ? `/buyer/properties/${selected.propertyId}` : "/broker/properties"} className="hidden items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 sm:inline-flex"><Home size={15} />View property</Link></div><div className="mt-4 grid grid-cols-2 gap-2 sm:flex"><div className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Listing price</p><p className="mt-0.5 text-sm font-semibold">{money(selected.listingPrice)}</p></div><div className="rounded-xl bg-blue-50 px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-wider text-blue-400">Latest proposal</p><p className="mt-0.5 text-sm font-semibold text-blue-700">{latestOffer ? money(latestOffer) : "None yet"}</p></div></div></header>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-slate-50/70 p-4 sm:p-6">{selected.messages?.map((item, index) => { const mine = item.senderId === userId; const previous = selected.messages?.[index - 1]; const showSender = !previous || previous.senderId !== item.senderId; return <div key={item.id} className={`flex gap-2.5 ${mine ? "justify-end" : "justify-start"}`}>{!mine && <div className={`mt-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm ${showSender ? "visible" : "invisible"}`}>{item.senderRole === "broker" ? <Building2 size={13} /> : <UserRound size={13} />}</div>}<div className={`max-w-[85%] sm:max-w-[70%] ${mine ? "items-end" : "items-start"}`}>{showSender && <p className={`mb-1 px-1 text-[11px] font-medium text-slate-400 ${mine ? "text-right" : "text-left"}`}>{mine ? "You" : item.senderRole === "broker" ? selected.brokerName || "Broker" : selected.buyerName || "Buyer"}</p>}<div className={`overflow-hidden rounded-2xl shadow-sm ${mine ? "rounded-br-md bg-slate-900 text-white" : "rounded-bl-md border border-slate-200 bg-white text-slate-700"}`}>{item.offerAmount && <div className={`border-b px-4 py-3 ${mine ? "border-white/10 bg-blue-500/15" : "border-blue-100 bg-blue-50"}`}><p className={`text-[10px] font-semibold uppercase tracking-wider ${mine ? "text-blue-300" : "text-blue-500"}`}>Price proposal</p><p className={`mt-1 text-xl font-semibold ${mine ? "text-white" : "text-blue-700"}`}>{money(item.offerAmount)}</p></div>}<div className="px-4 py-3"><p className="whitespace-pre-wrap text-sm leading-6">{item.text}</p><p className={`mt-1.5 text-right text-[10px] ${mine ? "text-white/45" : "text-slate-400"}`}>{item.createdAt?.toDate?.().toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) || "Sending"}</p></div></div></div></div>; })}<div ref={messagesEndRef} /></div>

            {(selected.status ?? "active") === "active" ? <div className="border-t border-slate-200 bg-white p-4 sm:p-5">{role === "broker" && latestOffer && <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold text-emerald-800">Ready to decide on {money(latestOffer)}?</p><p className="mt-0.5 text-xs text-emerald-700/70">This closes the conversation for further offers.</p></div><div className="flex gap-2"><button onClick={() => void setStatus("rejected")} disabled={working} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-white px-4 py-2 text-xs font-semibold text-red-600 disabled:opacity-50"><X size={14} />Decline</button><button onClick={() => void setStatus("accepted")} disabled={working} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"><Check size={14} />Accept</button></div></div>}{role === "buyer" && latestOffer && latestOfferMessage?.senderRole === "broker" && <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-emerald-900">Broker&apos;s proposed price: {money(latestOffer)}</p><p className="mt-1 text-xs leading-5 text-emerald-700">If this price works for you, agree to close the negotiation successfully.</p></div><button onClick={() => void setStatus("accepted")} disabled={working} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"><Check size={16} />{working ? "Confirming..." : "Agree to this price"}</button></div>}
              <form onSubmit={sendMessage} className="rounded-2xl border border-slate-200 bg-white p-3 text-slate-900 focus-within:border-slate-400"><textarea rows={2} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Write a message about the property or terms..." className="w-full resize-none bg-white px-1 text-sm leading-6 text-slate-900 caret-blue-600 outline-none placeholder:text-slate-400" /><div className="mt-2 flex flex-col gap-2 border-t border-slate-200 pt-3 sm:flex-row sm:items-center"><label className="flex h-10 items-center gap-2 rounded-xl bg-white px-3 text-xs font-semibold text-slate-600 ring-1 ring-slate-200"><span>₱</span><input type="number" min="1" value={offer} onChange={(event) => setOffer(event.target.value)} placeholder={role === "buyer" ? "Add offer" : "Add counteroffer"} className="min-w-0 flex-1 bg-white text-sm font-medium text-slate-900 caret-blue-600 outline-none placeholder:text-slate-400 sm:w-36" /></label><p className="hidden text-xs text-slate-400 sm:block">Price is optional for regular messages.</p><button disabled={working || (!message.trim() && !offer)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:ml-auto"><Send size={15} />{working ? "Sending..." : "Send"}</button></div></form></div>
              : selected.status === "accepted"
                ? <PostAgreementPanel key={selected.id} negotiation={selected} role={role} userId={userId} onError={setError} />
                : <div className="border-t bg-red-50 px-5 py-4 text-center text-sm font-semibold text-red-700">Offer declined — this negotiation is closed.</div>}
          </section>}
        </div>}
    </div>
  </main>;
}

function Status({ status }: { status: Status }) {
  const style = status === "accepted" ? "bg-emerald-100 text-emerald-700" : status === "rejected" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700";
  return <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize ${style}`}>{status}</span>;
}

function PostAgreementPanel({ negotiation, role, userId, onError }: { negotiation: Negotiation; role: Role; userId: string; onError: (message: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  const [scheduledFor, setScheduledFor] = useState(negotiation.viewing?.scheduledFor ?? "");
  const [location, setLocation] = useState(negotiation.viewing?.location ?? "");
  const [notes, setNotes] = useState(negotiation.viewing?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const contactBackfillStarted = useRef(false);
  const checklist = negotiation.dealChecklist ?? {};
  const completedSteps = [checklist.viewingCompleted, checklist.documentsPrepared, checklist.finalAgreementSigned].filter(Boolean).length;

  useEffect(() => {
    if (contactBackfillStarted.current || (negotiation.buyerContact && negotiation.brokerContact)) return;
    contactBackfillStarted.current = true;

    const backfillContacts = async () => {
      try {
        const [buyerSnapshot, brokerSnapshot] = await Promise.all([
          getDoc(doc(db, "users", negotiation.buyerId)),
          getDoc(doc(db, "users", negotiation.brokerId)),
        ]);
        const buyer = buyerSnapshot.data();
        const broker = brokerSnapshot.data();
        const changes: Record<string, ContactDetails | Timestamp> = { updatedAt: Timestamp.now() };

        if (!negotiation.buyerContact) {
          changes.buyerContact = {
            name: negotiation.buyerName || buyer?.name || [buyer?.firstName, buyer?.lastName].filter(Boolean).join(" ") || "Buyer",
            email: buyer?.email || (auth.currentUser?.uid === negotiation.buyerId ? auth.currentUser.email ?? "" : ""),
            phone: buyer?.phone || "",
          };
        }
        if (!negotiation.brokerContact) {
          changes.brokerContact = {
            name: negotiation.brokerName || broker?.name || [broker?.firstName, broker?.lastName].filter(Boolean).join(" ") || "Broker",
            email: broker?.email || (auth.currentUser?.uid === negotiation.brokerId ? auth.currentUser.email ?? "" : ""),
            phone: broker?.phone || "",
          };
        }

        await updateDoc(doc(db, "negotiations", negotiation.id), changes);
      } catch (error) {
        console.error("Unable to backfill negotiation contacts:", error);
        contactBackfillStarted.current = false;
        onError("Contact details could not be loaded from the participant profiles.");
      }
    };

    void backfillContacts();
  }, [negotiation.brokerContact, negotiation.brokerId, negotiation.brokerName, negotiation.buyerContact, negotiation.buyerId, negotiation.buyerName, negotiation.id, onError]);

  const saveViewing = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!scheduledFor || !location.trim() || saving) return;
    setSaving(true);
    onError("");
    try {
      await updateDoc(doc(db, "negotiations", negotiation.id), {
        viewing: { scheduledFor, location: location.trim(), notes: notes.trim(), scheduledBy: userId, updatedAt: Timestamp.now() },
        updatedAt: Timestamp.now(),
      });
    } catch (error) {
      console.error("Unable to schedule viewing:", error);
      onError("The viewing schedule could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const toggleStep = async (field: keyof DealChecklist, current: boolean) => {
    if (saving) return;
    setSaving(true);
    onError("");
    try {
      await updateDoc(doc(db, "negotiations", negotiation.id), {
        [`dealChecklist.${field}`]: !current,
        updatedAt: Timestamp.now(),
      });
    } catch (error) {
      console.error("Unable to update transaction checklist:", error);
      onError("The transaction checklist could not be updated.");
    } finally {
      setSaving(false);
    }
  };

  const archiveConversation = async () => {
    if (completedSteps !== 3 || saving) return;
    if (!window.confirm("Remove this completed conversation from your inbox? The other participant will keep their copy.")) return;
    setSaving(true);
    onError("");
    try {
      await updateDoc(doc(db, "negotiations", negotiation.id), {
        archivedBy: arrayUnion(userId),
        updatedAt: Timestamp.now(),
      });
    } catch (error) {
      console.error("Unable to archive conversation:", error);
      onError("The completed conversation could not be archived.");
      setSaving(false);
    }
  };

  return <div className="border-t border-emerald-200 bg-white">
    <button onClick={() => setExpanded((current) => !current)} className="flex w-full items-center justify-between gap-4 bg-emerald-50 px-5 py-4 text-left"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white"><Check size={20} /></span><div><p className="text-sm font-semibold text-emerald-900">Price agreed at {money(negotiation.agreedPrice)}</p><p className="mt-0.5 text-xs text-emerald-700">Continue with contact, viewing, and requirements—no online payment.</p></div></div><span className="whitespace-nowrap text-xs font-semibold text-emerald-700">{expanded ? "Hide next steps" : "Show next steps"}</span></button>
    {expanded && <div className="max-h-[22rem] overflow-y-auto p-4 sm:p-5">
      <div className="grid gap-4 xl:grid-cols-[0.8fr_1.1fr_1fr]">
        <section className="rounded-2xl border border-slate-200 p-4"><div className="flex items-center gap-2"><UserRound size={17} className="text-blue-600" /><h3 className="text-sm font-semibold">Shared contact details</h3></div><div className="mt-4 space-y-4"><ContactCard label="Buyer" contact={negotiation.buyerContact} /><ContactCard label="Broker" contact={negotiation.brokerContact} /></div><p className="mt-4 text-[11px] leading-5 text-slate-400">Use these details only to continue this property transaction.</p></section>

        <section className="rounded-2xl border border-slate-200 p-4"><div className="flex items-center gap-2"><CalendarDays size={17} className="text-blue-600" /><h3 className="text-sm font-semibold">Property viewing</h3></div>{negotiation.viewing?.scheduledFor && <div className="mt-3 rounded-xl bg-blue-50 p-3 text-xs text-blue-800"><p className="font-semibold">Scheduled for {new Date(negotiation.viewing.scheduledFor).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}</p><p className="mt-1 flex items-center gap-1.5"><MapPin size={13} />{negotiation.viewing.location}</p>{negotiation.viewing.notes && <p className="mt-2 leading-5 text-blue-700">{negotiation.viewing.notes}</p>}</div>}<form onSubmit={saveViewing} className="mt-3 space-y-2"><input required type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-slate-400" /><input required value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Meeting place or property address" className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-slate-400" /><textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional instructions" className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-slate-400" /><button disabled={saving} className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : negotiation.viewing ? "Update viewing" : "Schedule viewing"}</button></form></section>

        <section className="rounded-2xl border border-slate-200 p-4"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><ClipboardCheck size={17} className="text-blue-600" /><h3 className="text-sm font-semibold">Transaction checklist</h3></div><span className="text-xs font-semibold text-slate-400">{completedSteps}/3</span></div><div className="mt-4 space-y-2"><ChecklistButton label="Property viewing completed" checked={Boolean(checklist.viewingCompleted)} disabled={saving} onClick={() => void toggleStep("viewingCompleted", Boolean(checklist.viewingCompleted))} /><ChecklistButton label="Requirements prepared" checked={Boolean(checklist.documentsPrepared)} disabled={saving} onClick={() => void toggleStep("documentsPrepared", Boolean(checklist.documentsPrepared))} /><ChecklistButton label="Final agreement signed offline" checked={Boolean(checklist.finalAgreementSigned)} disabled={saving} onClick={() => void toggleStep("finalAgreementSigned", Boolean(checklist.finalAgreementSigned))} /></div>{completedSteps === 3 ? <div className="mt-4 space-y-3"><div className="rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-700">Transaction handoff completed.</div><button onClick={() => void archiveConversation()} disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"><Archive size={15} />Archive conversation</button><p className="text-center text-[10px] leading-4 text-slate-400">Removes it from your inbox only. The transaction record is preserved.</p></div> : <p className="mt-4 text-[11px] leading-5 text-slate-400">Both parties can update this shared checklist. Payments and legal signing happen outside LiBot.</p>}</section>
      </div>
      <p className="mt-4 text-center text-[11px] text-slate-400">Signed in as {role === "buyer" ? "buyer" : "broker"} · Changes are shared with the other party.</p>
    </div>}
  </div>;
}

function ContactCard({ label, contact }: { label: string; contact?: ContactDetails }) {
  return <div><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-xs font-semibold text-slate-700">{contact?.name || `${label} contact`}</p><div className="mt-1 space-y-1 text-[11px] text-slate-500"><p className="flex items-center gap-1.5"><Mail size={12} />{contact?.email || "Email not provided"}</p><p className="flex items-center gap-1.5"><Phone size={12} />{contact?.phone || "Phone not provided"}</p></div></div>;
}

function ChecklistButton({ label, checked, disabled, onClick }: { label: string; checked: boolean; disabled: boolean; onClick: () => void }) {
  return <button onClick={onClick} disabled={disabled} className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition disabled:opacity-60 ${checked ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${checked ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300"}`}>{checked && <Check size={13} />}</span>{label}</button>;
}
