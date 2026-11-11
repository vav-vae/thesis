"use client";

/* eslint-disable @next/next/no-img-element -- Local capture blobs are released when each preview unmounts. */

import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { CAPTURE_GUIDE, type CaptureView } from "@/lib/capture-guide";

export function LocalCaptureImage({ file, alt, className, onError }: { file: File; alt: string; className?: string; onError?: () => void }) {
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = imageRef.current;
    if (image) image.src = url;
    return () => { if (image) image.removeAttribute("src"); URL.revokeObjectURL(url); };
  }, [file]);
  return <img ref={imageRef} alt={alt} className={className} loading="lazy" decoding="async" onError={onError} />;
}

export default function CapturedPhotoPreview({ file, index, total, view, dimensions, issues = [], onPrevious, onNext, onClose, onImageError }: {
  file: File;
  index: number;
  total: number;
  view: CaptureView;
  dimensions?: { width: number; height: number };
  issues?: string[];
  onPrevious?: () => void;
  onNext?: () => void;
  onClose: () => void;
  onImageError?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => { dialog?.close(); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);

  return <dialog ref={dialogRef} aria-labelledby="capture-preview-title" className="m-auto h-[90dvh] max-h-[95dvh] w-[min(64rem,95vw)] max-w-none overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 p-0 text-white shadow-2xl backdrop:bg-black/80 open:flex open:flex-col"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={(event) => { if (event.key === "ArrowLeft" && onPrevious) { event.preventDefault(); onPrevious(); } if (event.key === "ArrowRight" && onNext) { event.preventDefault(); onNext(); } }}>
    <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 p-4">
      <div className="min-w-0"><h2 id="capture-preview-title" className="font-semibold">Photo {index + 1} of {total} · {CAPTURE_GUIDE[view].label}</h2><p className="mt-1 break-all text-xs text-slate-300">{file.name}</p><p className="mt-1 text-xs text-slate-400">{dimensions && `${dimensions.width}×${dimensions.height} · `}{(file.size / 1024 / 1024).toFixed(2)} MB</p></div>
      <button type="button" onClick={onClose} aria-label="Close photo preview" className="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-blue-300"><X size={22} /></button>
    </div>
    <LocalCaptureImage file={file} alt={`Preview of ${file.name}`} className="min-h-0 w-full flex-1 bg-black object-contain" onError={onImageError} />
    {issues.length > 0 && <ul className="max-h-[14dvh] shrink-0 space-y-1 overflow-y-auto border-t border-white/10 px-4 py-3 text-sm text-amber-200">{issues.map((issue, issueIndex) => <li key={issueIndex}>{issue}</li>)}</ul>}
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/10 p-3">
      <button type="button" onClick={onPrevious} disabled={!onPrevious} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm hover:bg-white/10 disabled:opacity-30"><ArrowLeft size={18} />Previous</button>
      <button type="button" onClick={onClose} className="min-h-11 rounded-xl bg-white px-4 text-sm font-semibold text-slate-900">Close preview</button>
      <button type="button" onClick={onNext} disabled={!onNext} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm hover:bg-white/10 disabled:opacity-30">Next<ArrowRight size={18} /></button>
    </div>
  </dialog>;
}
