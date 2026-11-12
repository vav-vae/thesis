export type PanoramaJob<T> = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  stage: string;
  requestId: string;
  elapsedMs: number;
  input: { image_urls: string[]; capture_views?: ("around" | "top" | "bottom")[] | null; algorithm: "orb" | "sift"; ransac_threshold: number; property_id: string; room_type: string };
  result?: T;
  error?: string;
  code?: string;
};

export class PanoramaJobError extends Error {
  readonly code: string;
  readonly jobId: string;
  readonly requestId: string;
  constructor(message: string, jobId: string, requestId: string, code = "TOUR_JOB_FAILED") {
    super(message);
    this.name = "PanoramaJobError";
    this.code = code;
    this.jobId = jobId;
    this.requestId = requestId;
  }
}

export async function pollPanoramaJob<T>(id: string, read: () => Promise<PanoramaJob<T>>, options: {
  signal: AbortSignal;
  onUpdate?: (job: PanoramaJob<T>) => void;
  onReconnect?: () => void;
  delay?: (signal: AbortSignal) => Promise<void>;
}): Promise<PanoramaJob<T>> {
  const delay = options.delay ?? ((signal) => new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 5000);
    signal.addEventListener("abort", abort, { once: true });
  }));
  for (;;) {
    options.signal.throwIfAborted();
    let job: PanoramaJob<T>;
    try { job = await read(); }
    catch (error) {
      options.signal.throwIfAborted();
      const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
      if (status === 401 || status === 403 || status === 404 || status === 409) throw error;
      options.onReconnect?.();
      await delay(options.signal);
      continue;
    }
    if (job.id !== id) throw new PanoramaJobError("The server returned a different tour job.", id, job.requestId, "TOUR_JOB_MISMATCH");
    options.onUpdate?.(job);
    if (job.status === "completed") {
      if (!job.result) throw new PanoramaJobError("The completed job has no saved result.", id, job.requestId, "TOUR_JOB_MISSING_RESULT");
      return job;
    }
    if (job.status === "failed") throw new PanoramaJobError(job.error || "The panorama job failed.", id, job.requestId, job.code);
    await delay(options.signal);
  }
}
