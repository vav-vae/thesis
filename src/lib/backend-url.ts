/** Shared by the browser and Next configuration so routing and CSP agree. */
export function backendUrl(value: string | undefined, production = false): string {
  const configured = value?.trim().replace(/\/+$/, "");
  if (!configured) return production ? "/api/backend" : "http://127.0.0.1:8000";
  if (configured.startsWith("/") && !configured.startsWith("//") && /^\/[A-Za-z0-9/_-]+$/.test(configured)) {
    return configured;
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("NEXT_PUBLIC_PANORAMA_API_URL must be an absolute API URL or a same-origin path.");
  }
  if (!["http:", "https:"].includes(url.protocol) || (production && url.protocol !== "https:")
      || url.username || url.password || url.search || url.hash) {
    throw new Error("NEXT_PUBLIC_PANORAMA_API_URL must use HTTPS in production and contain no credentials, query, or fragment.");
  }
  return url.href.replace(/\/+$/, "");
}
