import assert from "node:assert/strict";
import test from "node:test";
import { listingImageSrcSet, listingImageUrl } from "../src/lib/listing-image.ts";

test("card delivery is resized while original source URLs stay unchanged", () => {
  const source = "https://res.cloudinary.com/example/image/upload/v123/listings/room.jpg";
  assert.equal(listingImageUrl(source, 640), "https://res.cloudinary.com/example/image/upload/c_limit,w_640/q_auto/f_auto/v123/listings/room.jpg");
  assert.match(listingImageSrcSet(source)!, /w_320.*320w/);
  assert.match(listingImageSrcSet(source)!, /w_1920.*1920w/);
  assert.equal(source, "https://res.cloudinary.com/example/image/upload/v123/listings/room.jpg");
});

test("signed, transformed, local, and third-party images retain their delivery URLs", () => {
  for (const source of ["/logo.png", "https://example.com/image.jpg", "https://res.cloudinary.com/example/image/upload/s--signature--/v123/room.jpg", "https://res.cloudinary.com/example/image/upload/c_crop/v123/room.jpg", "https://res.cloudinary.com/example/image/upload/v123/room.jpg?token=private"]) {
    assert.equal(listingImageUrl(source, 640), source);
    assert.equal(listingImageSrcSet(source), undefined);
  }
});
