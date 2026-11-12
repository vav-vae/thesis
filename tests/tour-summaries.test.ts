import assert from "node:assert/strict";
import test from "node:test";
import { invalidateTourSummaries, loadTourSummaries } from "../src/lib/tour-summaries.ts";

test("listing requests project only small fields, paginate, and share cached work", async () => {
  const original = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    assert.deepEqual(url.searchParams.getAll("mask.fieldPaths"), ["propertyId", "brokerId", "status", "panoramaUrl"]);
    assert.equal(url.searchParams.has("metrics"), false);
    const page = url.searchParams.get("pageToken");
    return new Response(JSON.stringify(page ? { documents: [{ name: "projects/test/documents/roomTours/b", fields: { propertyId: { stringValue: "p-b" }, status: { stringValue: "unpublished" } } }] } : {
      documents: [{ name: "projects/test/documents/roomTours/a", fields: { propertyId: { stringValue: "p-a" }, panoramaUrl: { stringValue: "https://example.com/tour.jpg" } } }], nextPageToken: "next-page",
    }));
  };
  try {
    const [first, same] = await Promise.all([loadTourSummaries("test-summary"), loadTourSummaries("test-summary")]);
    assert.deepEqual(first, same);
    assert.equal(first.length, 2);
    assert.equal(first[0].status, undefined); // legacy publication behavior preserved
    assert.equal(first[1].status, "unpublished");
    assert.equal(calls.length, 2);
    await loadTourSummaries("test-summary");
    assert.equal(calls.length, 2);
    invalidateTourSummaries("test-summary");
    await loadTourSummaries("test-summary");
    assert.equal(calls.length, 4);
  } finally { globalThis.fetch = original; invalidateTourSummaries("test-summary"); }
});

test("a failed summary load can be retried", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? new Response("Unavailable", { status: 503 }) : new Response('{"documents":[]}');
  try {
    await assert.rejects(loadTourSummaries("test-retry"), /503/);
    assert.deepEqual(await loadTourSummaries("test-retry"), []);
  } finally { globalThis.fetch = original; invalidateTourSummaries("test-retry"); }
});
