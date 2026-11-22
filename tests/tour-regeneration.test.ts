import assert from "node:assert/strict";
import test from "node:test";
import { appendOverheadPhoto, tourRegenerationInput } from "../src/lib/tour-regeneration.ts";

const tour = {
  brokerId: "broker-1", propertyId: "property-1", roomType: "Living room", algorithm: "SIFT", ransacThreshold: 4,
  panoramaUrl: "https://example.com/panorama.jpg",
  sourceImageUrls: Array.from({ length: 72 }, (_, i) => `https://example.com/source-${i}.jpg`),
  captureViews: Array.from({ length: 72 }, (_, i) => i < 14 ? "around" : i < 42 ? "top" : "bottom"),
};

test("regeneration retains all 72 source photos, views, order, and room identity", () => {
  const input = tourRegenerationInput(tour, "broker-1");
  assert.deepEqual(input.image_urls, tour.sourceImageUrls);
  assert.deepEqual(input.capture_views, tour.captureViews);
  assert.equal(input.property_id, "property-1");
  assert.equal(input.room_type, "Living room");
  assert.equal(input.algorithm, "sift");
  assert.notEqual(input.image_urls, tour.sourceImageUrls);
  assert.ok(!input.image_urls.includes(tour.panoramaUrl));
});

test("regeneration rejects other owners and missing original photos", () => {
  assert.throws(() => tourRegenerationInput(tour, "other-broker"), /owner/);
  assert.throws(() => tourRegenerationInput({ ...tour, sourceImageUrls: [] }, "broker-1"), /complete saved photo set/);
});

test("legacy tours can omit view labels and receive a valid threshold", () => {
  const input = tourRegenerationInput({ ...tour, captureViews: ["top"], ransacThreshold: NaN, algorithm: "ORB" }, "broker-1");
  assert.equal(input.capture_views, undefined);
  assert.equal(input.ransac_threshold, 4);
  assert.equal(input.algorithm, "orb");
});

test("adding an overhead photo retains every saved photo and view in order", () => {
  const input = tourRegenerationInput(tour, "broker-1");
  const overhead = "https://example.com/overhead.jpg";
  const result = appendOverheadPhoto(input, overhead);
  assert.deepEqual(result, {
    ...input,
    image_urls: [...tour.sourceImageUrls, overhead],
    capture_views: [...tour.captureViews, "top"],
  });
  assert.deepEqual(input.image_urls, tour.sourceImageUrls);
  assert.throws(() => appendOverheadPhoto(result, overhead), /already in the saved capture set/);
  assert.throws(() => appendOverheadPhoto({ ...input, capture_views: ["top"] }, overhead), /missing their view labels/);
});
