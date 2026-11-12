/** Optimize public Cloudinary display images; capture uploads keep their originals. */
export function listingImageUrl(source: string, width: number): string {
  try {
    const url = new URL(source);
    if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" || url.search || url.hash || url.username || url.password) return source;
    // Only versioned, unsigned image URLs from our existing upload flow.
    if (!/^\/[^/]+\/image\/upload\/v\d+\//.test(url.pathname)) return source;
    const safeWidth = Number.isFinite(width) ? Math.max(32, Math.min(1920, Math.round(width))) : 960;
    url.pathname = url.pathname.replace("/image/upload/", `/image/upload/c_limit,w_${safeWidth}/q_auto/f_auto/`);
    return url.toString();
  } catch { return source; }
}

export function listingImageSrcSet(source: string): string | undefined {
  if (listingImageUrl(source, 640) === source) return undefined;
  return [320, 640, 960, 1280, 1920].map((width) => `${listingImageUrl(source, width)} ${width}w`).join(", ");
}
