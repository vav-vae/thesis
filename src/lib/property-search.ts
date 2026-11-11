/** Normalize spelling and separators without letting one place match another. */
export function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ")
    .replace(/\bla\s+paz\b/g, "lapaz")
    .replace(/\bcity\s+proper\b/g, "cityproper")
    .trim().replace(/\s+/g, " ");
}

const districts = new Set(["lapaz", "lapuz", "jaro", "mandurriao", "molo", "arevalo", "cityproper"]);

export function matchesLocation(location: string | undefined, query: string): boolean {
  const words = new Set(normalizeSearch(location ?? "").split(" "));
  return normalizeSearch(query).split(" ").filter(Boolean).every((word) => words.has(word));
}

export function matchesPropertySearch(property: { title?: string; location?: string }, query: string): boolean {
  const locationWords = new Set(normalizeSearch(property.location ?? "").split(" "));
  const allWords = new Set(normalizeSearch(`${property.title ?? ""} ${property.location ?? ""}`).split(" "));
  return normalizeSearch(query).split(" ").filter(Boolean).every((word) =>
    districts.has(word) ? locationWords.has(word) : allWords.has(word));
}
