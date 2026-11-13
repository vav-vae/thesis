import type { PanoramaJob } from "./panorama-job-poll";

/** Reuse the owner's real source photos; never regenerate from the stitched image. */
export function tourRegenerationInput(tour: Record<string, unknown>, brokerId: string): PanoramaJob<unknown>["input"] {
  if (!brokerId || tour.brokerId !== brokerId) throw new Error("Sign in as the owner of this tour to regenerate it.");
  const urls = tour.sourceImageUrls;
  if (!Array.isArray(urls) || urls.length < 6 || !urls.every((url): url is string => typeof url === "string" && url.startsWith("https://"))) {
    throw new Error("This tour does not have a complete saved photo set. Open Create room tour to upload the original photos.");
  }
  if (typeof tour.propertyId !== "string" || !tour.propertyId || typeof tour.roomType !== "string" || !tour.roomType.trim()) {
    throw new Error("The saved tour is missing its property or room name.");
  }
  const views = tour.captureViews;
  const threshold = tour.ransacThreshold;
  return {
    property_id: tour.propertyId, room_type: tour.roomType,
    image_urls: [...urls], algorithm: String(tour.algorithm).toLowerCase() === "orb" ? "orb" : "sift",
    ransac_threshold: typeof threshold === "number" && Number.isFinite(threshold) && threshold >= 1 && threshold <= 10 ? threshold : 4,
    ...(Array.isArray(views) && views.length === urls.length && views.every((view) => view === "around" || view === "top" || view === "bottom")
      ? { capture_views: [...views] as ("around" | "top" | "bottom")[] } : {}),
  };
}
