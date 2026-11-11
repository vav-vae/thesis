import test from "node:test";
import assert from "node:assert/strict";
import { isPublishedTour } from "../src/lib/published-tour.ts";

test("published and legacy sample tours are discoverable", () => {
  assert.equal(isPublishedTour({ panoramaUrl: "/sample.jpg", status: "published" }), true);
  assert.equal(isPublishedTour({ panoramaUrl: "/sample.jpg" }), true);
  assert.equal(isPublishedTour({ panoramaUrl: "/sample.jpg", status: null }), true);
});

test("unpublished tours and missing panoramas stay hidden", () => {
  for (const status of ["unpublished", "draft", "deleted"]) {
    assert.equal(isPublishedTour({ panoramaUrl: "/sample.jpg", status }), false);
  }
  for (const panoramaUrl of [undefined, null, "", "   ", 42]) {
    assert.equal(isPublishedTour({ panoramaUrl, status: "published" }), false);
  }
});
