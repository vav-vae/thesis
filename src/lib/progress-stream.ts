import { HttpResponseError } from "./http-response.ts";

type ProgressEvent<T> = {
  type?: string;
  stage?: string;
  detail?: string;
  result?: T;
};

export class ProgressStreamError extends HttpResponseError {
  readonly code: string;
  readonly lastStage: string;
  readonly streamDurationMs: number;
  readonly lastUpdateAgoMs: number;
  readonly receivedBytes: number;
  readonly progressEvents: number;

  constructor(message: string, response: Response, diagnostics: { code: string; lastStage: string; streamDurationMs: number; lastUpdateAgoMs: number; receivedBytes: number; progressEvents: number }, options?: ErrorOptions) {
    super(message, response, options);
    this.name = "ProgressStreamError";
    this.code = diagnostics.code;
    this.lastStage = diagnostics.lastStage;
    this.streamDurationMs = diagnostics.streamDurationMs;
    this.lastUpdateAgoMs = diagnostics.lastUpdateAgoMs;
    this.receivedBytes = diagnostics.receivedBytes;
    this.progressEvents = diagnostics.progressEvents;
  }
}

export async function readProgressStream<T>(
  response: Response,
  onProgress?: (stage: string) => void,
): Promise<T> {
  let complete: T | undefined;
  let lastStage = "";
  const started = Date.now();
  let lastUpdate = started;
  let receivedBytes = 0;
  let progressEvents = 0;
  const failure = (code: string, message: string, cause?: unknown) => new ProgressStreamError(message, response, {
    code, lastStage, streamDurationMs: Date.now() - started,
    lastUpdateAgoMs: Date.now() - lastUpdate, receivedBytes, progressEvents,
  }, cause === undefined ? undefined : { cause });

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    let event: ProgressEvent<T>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object") throw new Error("Invalid progress event");
      event = parsed as ProgressEvent<T>;
    } catch {
      throw failure("TOUR_STREAM_INVALID_EVENT", "The panorama processor sent an unreadable progress update.");
    }
    if (event.type === "progress" && typeof event.stage === "string") {
      lastStage = event.stage;
      lastUpdate = Date.now();
      progressEvents += 1;
      onProgress?.(event.stage);
    }
    if (event.type === "error") throw failure("TOUR_PROCESSOR_ERROR", event.detail || "The panorama processor could not finish this tour.");
    if (event.type === "complete") complete = event.result;
  };

  const reader = response.body?.getReader();
  if (!reader) {
    (await response.text()).split("\n").forEach(consumeLine);
  } else {
    const decoder = new TextDecoder();
    let pending = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        receivedBytes += value?.byteLength ?? 0;
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        lines.forEach(consumeLine);
        if (done) break;
      }
      consumeLine(pending);
    } catch (error) {
      if (error instanceof HttpResponseError) throw error;
      throw failure("TOUR_STREAM_INTERRUPTED", "The panorama response stream was interrupted. Your photos are still on this page; keep this tab open and try Generate tour again.", error);
    } finally {
      reader.releaseLock();
    }
  }

  if (complete === undefined) throw failure("TOUR_STREAM_INCOMPLETE", `The panorama processor stopped before sending a result${lastStage ? ` during “${lastStage}”` : ""}. Your photos are still on this page; try generating again.`);
  return complete;
}
