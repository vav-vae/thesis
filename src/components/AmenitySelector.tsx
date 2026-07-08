"use client";

import { Check, Minus, Plus } from "lucide-react";
import { AMENITY_GROUPS, PROPERTY_TYPES } from "@/lib/propertyAmenities";

export function PropertyTypeSelector({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3">{PROPERTY_TYPES.map((type) => <button key={type} type="button" onClick={() => onChange(type)} aria-pressed={value === type} className={`rounded-2xl border px-4 py-4 text-left text-sm font-semibold transition ${value === type ? "border-blue-600 bg-blue-50 text-blue-700 ring-1 ring-blue-600" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"}`}><span className="flex items-center justify-between gap-2">{type}{value === type && <Check className="shrink-0" size={17} />}</span></button>)}</div>;
}

export function AmenitySelector({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  return <div className="space-y-6">{AMENITY_GROUPS.map((group) => <div key={group.title}><h4 className="mb-3 text-sm font-semibold text-slate-700">{group.title}</h4><div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3">{group.options.map((option) => { const selected = value.includes(option.id); return <button key={option.id} type="button" onClick={() => toggle(option.id)} aria-pressed={selected} className={`min-h-14 rounded-2xl border px-4 py-3 text-left text-sm font-medium transition ${selected ? "border-blue-600 bg-blue-50 text-blue-700 ring-1 ring-blue-600" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"}`}><span className="flex items-center justify-between gap-2"><span>{option.label}</span>{selected && <Check className="shrink-0" size={16} />}</span></button>; })}</div></div>)}</div>;
}

export function NumberStepper({ label, detail, value, onChange, min = 0, max = 20 }: { label: string; detail: string; value: number; onChange: (value: number) => void; min?: number; max?: number }) {
  return <div className="flex flex-col gap-3 border-b border-slate-100 py-4 text-slate-900 last:border-0 min-[380px]:flex-row min-[380px]:items-center min-[380px]:justify-between min-[380px]:gap-5"><div className="min-w-0"><p className="text-sm font-semibold text-slate-800">{label}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div><div className="flex shrink-0 items-center gap-3"><button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`Decrease ${label}`} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 disabled:text-slate-400 disabled:opacity-40"><Minus size={16} /></button><span className="w-6 text-center text-base font-semibold text-slate-900">{value}</span><button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`Increase ${label}`} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 disabled:text-slate-400 disabled:opacity-40"><Plus size={16} /></button></div></div>;
}
