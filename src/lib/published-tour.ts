/** Older tours predate the status field and are published by default. */
export function isPublishedTour(tour: { status?: unknown; panoramaUrl?: unknown }): boolean {
  return (tour.status ?? "published") === "published"
    && typeof tour.panoramaUrl === "string" && tour.panoramaUrl.trim().length > 0;
}
