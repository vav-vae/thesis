/** Listings created before moderation had no status field. */
export function isBrowsableProperty(property: { status?: unknown }): boolean {
  return property.status == null || property.status === "active";
}
