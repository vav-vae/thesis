"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readTourGenerationJob, startTourGenerationJob, type TourGenerationJob } from "@/lib/panorama-api";
import { pollPanoramaJob } from "@/lib/panorama-job-poll";
import { recordTourLog } from "@/lib/tour-logs";
import { formatCaptureDiagnostic } from "@/lib/capture-diagnostics";

type SavedDraft = { id: string; input: TourGenerationJob["input"] };
const key = (uid: string) => `libot:tour-job:v1:${uid}`;

export function useTourGenerationJob(brokerId: string) {
  const [job, setJob] = useState<TourGenerationJob | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("");
  const [saved, setSaved] = useState<SavedDraft | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const watch = useCallback(async (draft: SavedDraft, submit: boolean) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setSaved(draft);
    setJob(null);
    setActive(true);
    setError("");
    setConnection(submit ? "Saving generation job…" : "Reconnecting to saved job…");
    const remember = (value: SavedDraft) => {
      try { localStorage.setItem(key(brokerId), JSON.stringify(value)); }
      catch { setConnection("Device storage is unavailable. Keep this page open or save the job ID below."); }
    };
    remember(draft);
    let lastStage = "";
    try {
      if (submit) {
        try { await startTourGenerationJob(draft.id, draft.input, controller.signal); }
        catch (failure) {
          if (failure && typeof failure === "object" && "status" in failure && typeof failure.status === "number" && failure.status >= 400 && failure.status < 500) throw failure;
          controller.signal.throwIfAborted();
          // The response may have been lost after the server accepted the job.
        }
      }
      await pollPanoramaJob(draft.id, async () => {
        try { return await readTourGenerationJob(draft.id, controller.signal); }
        catch (failure) {
          if (failure && typeof failure === "object" && "status" in failure && failure.status === 404) {
            return startTourGenerationJob(draft.id, draft.input, controller.signal);
          }
          throw failure;
        }
      }, {
        signal: controller.signal,
        onReconnect: () => setConnection("Connection interrupted. Your saved job is safe; reconnecting automatically…"),
        onUpdate: (update) => {
          setJob(update);
          setConnection("");
          if (lastStage !== update.stage) {
            lastStage = update.stage;
            recordTourLog("info", `Background tour job: ${update.stage}`, `Job ID: ${update.id}\nRequest ID: ${update.requestId}\nElapsed: ${update.elapsedMs} ms`, update.input.property_id);
          }
        },
      });
    } catch (failure) {
      if (controller.signal.aborted) return;
      const message = failure instanceof Error ? failure.message : "Could not resume this tour job.";
      setError(message);
      recordTourLog("error", `Background tour job failed: ${message}`, formatCaptureDiagnostic(failure, { stage: lastStage || "Background job submission", photoCount: draft.input.image_urls.length, detail: `Job ID: ${draft.id}`, endpoint: `/reconstruct/jobs/${draft.id}`, online: navigator.onLine }), draft.input.property_id);
    } finally {
      if (!controller.signal.aborted) setActive(false);
    }
  }, [brokerId]);

  useEffect(() => {
    if (!brokerId) return;
    let disposed = false;
    // Restore only this authenticated broker's draft, never another account's.
    void Promise.resolve().then(() => {
      if (disposed) return;
      try {
        const raw = localStorage.getItem(key(brokerId));
        if (!raw) return;
        const draft = JSON.parse(raw) as SavedDraft;
        if (typeof draft.id === "string" && /^[0-9a-f-]{36}$/i.test(draft.id) && draft.input && Array.isArray(draft.input.image_urls)) void watch(draft, false);
      } catch { /* A corrupt/disabled local store must not block capture. */ }
    });
    return () => { disposed = true; controllerRef.current?.abort(); };
  }, [brokerId, watch]);

  const clear = useCallback(() => {
    controllerRef.current?.abort();
    try { localStorage.removeItem(key(brokerId)); } catch { /* optional storage */ }
    setSaved(null); setJob(null); setError(""); setConnection(""); setActive(false);
  }, [brokerId]);

  return {
    job, active, error, connection, saved, clear,
    start: (input: TourGenerationJob["input"]) => watch({ id: crypto.randomUUID(), input }, true),
    resume: () => saved && watch(saved, false),
    retry: () => saved && watch({ ...saved, id: crypto.randomUUID() }, true),
  };
}
