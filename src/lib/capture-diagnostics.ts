export type CaptureDiagnosticContext = {
  stage: string;
  endpoint?: string;
  method?: string;
  photoIndex?: number;
  photoCount?: number;
  file?: { name: string; size: number; type: string };
  dimensions?: string;
  algorithm?: string;
  ransacThreshold?: number;
  durationMs?: number;
  online?: boolean;
  detail?: string;
};

export function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/Bearer\s+[^\s"',;]+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted token]")
    .replace(/https?:\/\/[^\s<>"')]+/g, (value) => {
      try { const url = new URL(value); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString(); } catch { return "[invalid URL]"; }
    });
}

export function formatCaptureDiagnostic(error: unknown, context: CaptureDiagnosticContext): string {
  const lines = [`Stage: ${context.stage}`];
  if (context.endpoint) lines.push(`Request: ${context.method ?? "POST"} ${context.endpoint}`);
  if (context.photoCount != null) lines.push(`Capture set: ${context.photoCount} photos`);
  if (context.photoIndex != null) lines.push(`Photo: ${context.photoIndex + 1}${context.file ? ` · ${context.file.name}` : ""}`);
  else if (context.file) lines.push(`File: ${context.file.name}`);
  if (context.file) lines.push(`Original file: ${context.file.type || "unknown type"}, ${context.file.size.toLocaleString()} bytes`);
  if (context.dimensions) lines.push(`Dimensions: ${context.dimensions}`);
  if (context.algorithm) lines.push(`Matching: ${context.algorithm.toUpperCase()}, RANSAC ${context.ransacThreshold ?? "default"}`);
  if (context.durationMs != null) lines.push(`Elapsed: ${Math.round(context.durationMs)} ms`);
  if (context.online != null) lines.push(`Browser network: ${context.online ? "online" : "offline"}`);
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth = 0) => {
    if (depth > 4 || seen.has(value)) return;
    seen.add(value);
    if (!value || typeof value !== "object") { lines.push(String(value)); return; }
    const item = value as { name?: unknown; message?: unknown; code?: unknown; status?: unknown; statusText?: unknown; url?: unknown; requestId?: unknown; vercelId?: unknown; retryAfter?: unknown; contentType?: unknown; stack?: unknown; cause?: unknown; lastStage?: unknown; streamDurationMs?: unknown; lastUpdateAgoMs?: unknown; receivedBytes?: unknown; progressEvents?: unknown };
    lines.push(`${depth ? "Caused by: " : ""}${typeof item.name === "string" ? item.name : "Error"}: ${typeof item.message === "string" ? item.message : "No error message was provided"}`);
    if (typeof item.code === "string") lines.push(`Error code: ${item.code}`);
    if (typeof item.lastStage === "string") lines.push(`Last received stage: ${item.lastStage || "No progress received"}`);
    if (typeof item.streamDurationMs === "number") lines.push(`Stream duration: ${item.streamDurationMs} ms`);
    if (typeof item.lastUpdateAgoMs === "number") lines.push(`Time since last progress: ${item.lastUpdateAgoMs} ms`);
    if (typeof item.receivedBytes === "number") lines.push(`Stream bytes received: ${item.receivedBytes}`);
    if (typeof item.progressEvents === "number") lines.push(`Progress events received: ${item.progressEvents}`);
    if (typeof item.status === "number") lines.push(`HTTP: ${item.status} ${typeof item.statusText === "string" ? item.statusText : ""}`.trim());
    if (typeof item.url === "string" && item.url) lines.push(`Response URL: ${item.url}`);
    if (typeof item.requestId === "string") lines.push(`Request ID: ${item.requestId}`);
    if (typeof item.vercelId === "string") lines.push(`Vercel request ID: ${item.vercelId}`);
    if (typeof item.retryAfter === "string") lines.push(`Retry after: ${item.retryAfter} seconds`);
    if (typeof item.contentType === "string") lines.push(`Response type: ${item.contentType}`);
    if (typeof item.stack === "string") lines.push(item.stack);
    if (item.cause) visit(item.cause, depth + 1);
  };
  visit(error);
  if (context.detail) lines.push(context.detail);
  return sanitizeDiagnosticText(lines.join("\n"));
}
