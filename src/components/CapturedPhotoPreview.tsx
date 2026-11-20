"use client";

/* eslint-disable @next/next/no-img-element -- Local capture blobs are released when each preview unmounts. */

import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, RotateCcw, Trash2, X } from "lucide-react";
import { CAPTURE_GUIDE, CAPTURE_VIEWS, type CaptureView } from "@/lib/capture-guide";

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

export default function CapturedPhotoPreview({ file, index, total, view, details, issues = [], edit, onPrevious, onNext, onClose, onImageError }: {
  file: File;
  index: number;
  total: number;
  view: CaptureView;
  details?: { width: number; height: number; blurScore?: number; brightness?: number; keypoints?: number };
  issues?: string[];
  edit?: {
    disabled: boolean;
    removeDisabled: boolean;
    onViewChange: (view: CaptureView) => void;
    onRetake: () => void;
    onRemove: () => void;
  };
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

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="capture-preview-title"
      className="m-auto h-[90dvh] max-h-[95dvh] w-[min(64rem,95vw)] max-w-none overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 p-0 text-white shadow-2xl backdrop:bg-black/80 open:flex open:flex-col"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLSelectElement) return;
        const navigate = event.key === "ArrowLeft" ? onPrevious : event.key === "ArrowRight" ? onNext : undefined;
        if (navigate) { event.preventDefault(); navigate(); }
      }}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-4 py-2">
        <div className="min-w-0">
          <h2 id="capture-preview-title" className="text-sm font-semibold" aria-live="polite">Photo {index + 1} of {total}{!edit && ` · ${CAPTURE_GUIDE[view].label}`}</h2>
          <p className="mt-1 line-clamp-2 text-xs text-slate-100 [overflow-wrap:anywhere]">{file.name}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close photo preview" className="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-blue-300"><X size={22} /></button>
      </header>

      <LocalCaptureImage file={file} alt={`Preview of ${file.name}`} className="min-h-20 w-full flex-1 bg-black object-contain" onError={onImageError} />

      <div className="min-h-0 max-h-[25dvh] space-y-2 overflow-y-auto overscroll-contain border-t border-white/10 px-4 py-2 text-xs text-slate-100">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {details && <span>{details.width}×{details.height}</span>}
          <span>{(file.size / 1024 / 1024).toFixed(2)} MB</span>
          {details?.keypoints != null ? <span>{details.keypoints} features</span> : edit && <span>Overlap check runs during generation</span>}
          {details?.blurScore != null && <span>Sharpness {details.blurScore.toFixed(0)}</span>}
          {details?.brightness != null && <span>Brightness {details.brightness.toFixed(0)}</span>}
        </div>
        {issues.length > 0 && <ul className="list-disc space-y-1 pl-4 text-amber-200">{issues.map((issue, issueIndex) => <li key={issueIndex} className="[overflow-wrap:anywhere]">{issue}</li>)}</ul>}
      </div>

      {(edit || onPrevious || onNext) && (
        <footer className="grid shrink-0 gap-2 border-t border-white/10 p-2 sm:grid-cols-2 sm:gap-4">
          {edit && (
            <div className="grid grid-cols-[minmax(0,1fr)_44px_44px] gap-2 sm:col-start-2 sm:row-start-1">
              <select aria-label="Photo type" value={view} onChange={(event) => edit.onViewChange(event.target.value as CaptureView)} disabled={edit.disabled} className="h-11 min-w-0 rounded-xl border border-slate-500 bg-slate-950 px-2 text-base text-white disabled:opacity-50">
                {CAPTURE_VIEWS.map((choice) => <option key={choice} value={choice}>{CAPTURE_GUIDE[choice].label}</option>)}
              </select>
              <button type="button" onClick={edit.onRetake} disabled={edit.disabled} aria-label="Retake photo" title="Retake photo" className="flex size-11 items-center justify-center rounded-xl border border-slate-500 hover:bg-white/10 disabled:opacity-40"><RotateCcw size={18} /></button>
              <button type="button" onClick={edit.onRemove} disabled={edit.removeDisabled} aria-label="Remove photo" title="Remove photo" className="flex size-11 items-center justify-center rounded-xl border border-slate-500 text-red-200 hover:bg-white/10 disabled:opacity-40"><Trash2 size={18} /></button>
            </div>
          )}
          {(onPrevious || onNext) && (
            <nav className="grid grid-cols-2 gap-2 sm:col-start-1 sm:row-start-1" aria-label="Photo navigation">
              <button type="button" onClick={onPrevious} disabled={!onPrevious} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-500 px-2 text-sm hover:bg-white/10 disabled:opacity-40"><ArrowLeft size={16} />Previous</button>
              <button type="button" onClick={onNext} disabled={!onNext} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-500 px-2 text-sm hover:bg-white/10 disabled:opacity-40">Next<ArrowRight size={16} /></button>
            </nav>
          )}
        </footer>
      )}
    </dialog>
  );
}
