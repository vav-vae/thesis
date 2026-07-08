export type MapCoordinates = { latitude: number; longitude: number };

type NominatimResult = { display_name?: string; error?: string };

export async function reverseGeocode({ latitude, longitude }: MapCoordinates, signal?: AbortSignal) {
  const parameters = new URLSearchParams({
    format: "jsonv2",
    lat: String(latitude),
    lon: String(longitude),
    addressdetails: "1",
    zoom: "18",
    layer: "address",
    "accept-language": "en",
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${parameters}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Address lookup failed.");
  const result = await response.json() as NominatimResult;
  if (!result.display_name) throw new Error(result.error || "No mapped address was found for this pin.");
  return result.display_name;
}
