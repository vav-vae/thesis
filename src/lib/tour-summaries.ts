export type TourSummary = {
  id: string;
  propertyId?: string;
  brokerId?: string;
  status?: string;
  panoramaUrl?: string;
};

type ListingResponse = { documents?: { name: string; fields?: Record<string, { stringValue?: string }> }[]; nextPageToken?: string };
const summaries = new Map<string, { expires: number; promise: Promise<TourSummary[]> }>();
const FIELDS = ["propertyId", "brokerId", "status", "panoramaUrl"] as const;

/** Public discovery needs tour availability, never reconstruction reports/photos. */
export function loadTourSummaries(projectId: string): Promise<TourSummary[]> {
  const cached = summaries.get(projectId);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const promise = (async () => {
    const tours: TourSummary[] = [];
    let nextPageToken: string | undefined;
    do {
      const params = new URLSearchParams({ pageSize: "200" });
      for (const field of FIELDS) params.append("mask.fieldPaths", field);
      if (nextPageToken) params.set("pageToken", nextPageToken);
      const response = await fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/roomTours?${params}`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Tour summaries could not be loaded (HTTP ${response.status}).`);
      const data = await response.json() as ListingResponse;
      for (const document of data.documents ?? []) {
        const tour: TourSummary = { id: document.name.split("/").at(-1) ?? "" };
        for (const field of FIELDS) {
          const value = document.fields?.[field]?.stringValue;
          if (typeof value === "string") tour[field] = value;
        }
        tours.push(tour);
      }
      nextPageToken = data.nextPageToken;
    } while (nextPageToken);
    return tours;
  })();
  const entry = { expires: Date.now() + 30_000, promise };
  summaries.set(projectId, entry);
  void promise.catch(() => { if (summaries.get(projectId) === entry) summaries.delete(projectId); });
  return promise;
}

export function invalidateTourSummaries(projectId: string) { summaries.delete(projectId); }
