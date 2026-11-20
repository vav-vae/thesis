"use client";

import { useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";
import type { CaptureView } from "@/lib/capture-guide";
import { LocalCaptureImage } from "./CapturedPhotoPreview";

const PHOTOS_PER_PAGE = 6;
const viewLabels: Record<CaptureView, string> = { around: "Walls", top: "Ceiling", bottom: "Floor" };

type ReviewPhoto = { file: File; view: CaptureView; issue?: "warning" | "error" };

export default function CapturedPhotoGallery({ photos, onPreview }: {
  photos: ReviewPhoto[];
  onPreview: (file: File) => void;
}) {
  const [page, setPage] = useState(0);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const numberedPhotos = photos.map((photo, index) => ({ ...photo, number: index + 1 }));
  const issuePhotos = numberedPhotos.filter((photo) => photo.issue);
  const visiblePhotos = issuesOnly ? issuePhotos : numberedPhotos;
  const pageCount = Math.ceil(visiblePhotos.length / PHOTOS_PER_PAGE);
  const currentPage = Math.min(page, Math.max(pageCount - 1, 0));
  const start = currentPage * PHOTOS_PER_PAGE;
  const end = Math.min(start + PHOTOS_PER_PAGE, visiblePhotos.length);

  return (
    <section className="mt-5 min-w-0 space-y-3" aria-label="Captured photos">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div>
          <h3 className="text-sm font-semibold">{photos.length} captured {photos.length === 1 ? "photo" : "photos"}</h3>
          <p className="mt-0.5 text-xs text-slate-600">Select a photo to review or edit it.</p>
        </div>
        {(issuePhotos.length > 0 || issuesOnly) && (
          <button
            type="button"
            aria-pressed={issuesOnly}
            onClick={() => { setIssuesOnly(!issuesOnly); setPage(0); }}
            className="ui-button ui-button-secondary px-3 text-xs aria-pressed:border-blue-300 aria-pressed:bg-blue-50 aria-pressed:text-blue-700"
          >
            <TriangleAlert size={15} aria-hidden="true" />
            Needs attention ({issuePhotos.length})
          </button>
        )}
      </div>

      {visiblePhotos.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600" role="status">All photos in this set are clear of flagged issues.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 lg:grid-cols-6">
          {visiblePhotos.slice(start, end).map(({ file, number, view, issue }) => (
            <li key={`${number}-${file.name}`} className="min-w-0">
              <button
                type="button"
                onClick={() => onPreview(file)}
                aria-label={`Review photo ${number}, ${viewLabels[view]}${issue ? `, ${issue === "error" ? "action needed" : "warning"}` : ""}: ${file.name}`}
                className="block w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-left hover:border-blue-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
              >
                <span className="relative block aspect-[4/3] overflow-hidden bg-slate-100">
                  <LocalCaptureImage file={file} alt="" className="size-full object-cover" />
                  {issue && (
                    <span className={`absolute right-1 top-1 rounded-md p-1 text-white ${issue === "error" ? "bg-red-800" : "bg-amber-800"}`}>
                      {issue === "error" ? <AlertCircle size={14} aria-hidden="true" /> : <TriangleAlert size={14} aria-hidden="true" />}
                    </span>
                  )}
                </span>
                <span className="block px-2 py-1.5 leading-tight">
                  <span className="block text-xs font-semibold tabular-nums">#{number}</span>
                  <span className="mt-0.5 block text-xs text-slate-600">{viewLabels[view]}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <nav className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 sm:max-w-72" aria-label="Photo pages">
          <button type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 0} aria-label="Previous photo page" className="ui-icon-button disabled:opacity-40">
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <select
            aria-label={issuesOnly ? "Photos needing attention by range" : "Photos by range"}
            value={currentPage}
            onChange={(event) => setPage(Number(event.target.value))}
            className="ui-select h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white pl-2 text-base tabular-nums"
          >
            {Array.from({ length: pageCount }, (_, index) => (
              <option key={index} value={index}>{index * PHOTOS_PER_PAGE + 1}–{Math.min((index + 1) * PHOTOS_PER_PAGE, visiblePhotos.length)} of {visiblePhotos.length}</option>
            ))}
          </select>
          <button type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage + 1 === pageCount} aria-label="Next photo page" className="ui-icon-button disabled:opacity-40">
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </nav>
      )}
      <p className="sr-only" role="status">{visiblePhotos.length > 0 && `Showing ${start + 1}–${end} of ${visiblePhotos.length} ${issuesOnly ? "photos needing attention" : "photos"}.`}</p>
    </section>
  );
}
