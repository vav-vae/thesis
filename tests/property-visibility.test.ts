import test from "node:test";
import assert from "node:assert/strict";
import { isBrowsableProperty } from "../src/lib/property-visibility.ts";
import { isPublishedTour } from "../src/lib/published-tour.ts";

test("active and legacy listings are browsable, explicit inactive states are hidden", () => {
  for (const property of [{}, { status: null }, { status: "active" }]) {
    assert.equal(isBrowsableProperty(property), true);
  }
  for (const status of ["pending", "rejected", "inactive", "deleted", "draft"]) {
    assert.equal(isBrowsableProperty({ status }), false);
  }
});

test("published tour joins to its legacy property with no status", () => {
  const property = { id: "legacy-apartment" };
  const tour = { propertyId: property.id, status: "published", panoramaUrl: "https://example.com/tour.jpg" };
  const tourIds = new Set([tour].filter(isPublishedTour).map((item) => item.propertyId));
  assert.equal([property].filter((item) => isBrowsableProperty(item as { status?: unknown }) && tourIds.has(item.id)).length, 1);
});
