/** Handle JSON APIs and plain-text errors returned by hosting proxies. */
export async function readJsonResponse<T = Record<string, unknown>>(
  response: Response,
  fallback: string,
): Promise<T> {
  const raw = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    if (/request entity too large|payload too large/i.test(raw)) {
      throw new Error("The upload is too large for the server. Reload LiBot and try again with smaller photos.");
    }
    throw new Error(response.status === 504
      ? "The panorama processor timed out. Please try again with smaller photos."
      : `${fallback} The server returned an unexpected response. Please try again.`);
  }
  if (response.status === 413) {
    const body = data && typeof data === "object" ? data as { detail?: unknown } : null;
    throw new Error(typeof body?.detail === "string"
      ? body.detail
      : "The upload is too large for the server. Reload LiBot and try again with smaller photos.");
  }
  if (!response.ok) {
    let detail = fallback;
    if (data && typeof data === "object") {
      const body = data as { detail?: unknown; error?: { message?: unknown } };
      if (typeof body.detail === "string") detail = body.detail;
      else if (typeof body.error?.message === "string") detail = body.error.message;
    }
    const retry = response.headers.get("Retry-After");
    throw new Error(retry ? `${detail} Try again in ${retry} seconds.` : detail);
  }
  return data as T;
}
