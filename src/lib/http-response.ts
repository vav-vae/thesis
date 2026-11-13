export class HttpResponseError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly requestId: string | null;
  readonly vercelId: string | null;
  readonly retryAfter: string | null;
  readonly contentType: string | null;

  constructor(message: string, response: Response, options?: ErrorOptions) {
    super(message, options);
    this.name = "HttpResponseError";
    this.status = response.status;
    this.statusText = response.statusText;
    this.url = response.url;
    this.requestId = response.headers.get("X-Request-ID");
    this.vercelId = response.headers.get("X-Vercel-ID");
    this.retryAfter = response.headers.get("Retry-After");
    this.contentType = response.headers.get("Content-Type");
  }
}

/** Handle JSON APIs and plain-text errors returned by hosting proxies. */
export async function readJsonResponse<T = Record<string, unknown>>(
  response: Response,
  fallback: string,
): Promise<T> {
  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    throw new HttpResponseError("The server response could not be read.", response, { cause: error });
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    if (/request entity too large|payload too large/i.test(raw)) {
      throw new HttpResponseError("The upload is too large for the server. Reload LiBot and try again with smaller photos.", response);
    }
    throw new HttpResponseError(response.status === 504
      ? "The panorama processor timed out. Please try again with smaller photos."
      : response.status >= 500 && response.status <= 599
      ? `${fallback} The server failed (HTTP ${response.status}). Please try again shortly.`
      : `${fallback} The server returned an unexpected response. Please try again.`, response);
  }
  if (response.status === 413) {
    const body = data && typeof data === "object" ? data as { detail?: unknown } : null;
    throw new HttpResponseError(typeof body?.detail === "string"
      ? body.detail
      : "The upload is too large for the server. Reload LiBot and try again with smaller photos.", response);
  }
  if (!response.ok) {
    let detail = fallback;
    if (data && typeof data === "object") {
      const body = data as { detail?: unknown; error?: { message?: unknown } };
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail)) detail = body.detail.map((issue: unknown) => {
        if (!issue || typeof issue !== "object") return "Invalid request field";
        const item = issue as { loc?: unknown; msg?: unknown };
        return `${Array.isArray(item.loc) ? item.loc.join(".") : "request"}: ${typeof item.msg === "string" ? item.msg : "Invalid value"}`;
      }).join("; ");
      else if (typeof body.error?.message === "string") detail = body.error.message;
    }
    const retry = response.headers.get("Retry-After");
    throw new HttpResponseError(retry ? `${detail} Try again in ${retry} seconds.` : detail, response);
  }
  return data as T;
}
