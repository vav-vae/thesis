import assert from "node:assert/strict";
import test from "node:test";
import { pollPanoramaJob, PanoramaJobError, type PanoramaJob } from "../src/lib/panorama-job-poll.ts";

const base: PanoramaJob<{ panorama: string }> = { id: "job-1", status: "running", stage: "Checking photos", requestId: "req-1", elapsedMs: 10,
  input: { image_urls: ["photo"], algorithm: "sift", ransac_threshold: 4, property_id: "p-1", room_type: "Living room" } };

test("a lost status connection recovers the saved result without restarting generation", async () => {
  let reads = 0;
  let reconnects = 0;
  const restored = await pollPanoramaJob("job-1", async () => {
    reads++;
    if (reads === 1) throw new TypeError("Load failed");
    if (reads === 2) return base;
    return { ...base, status: "completed", result: { panorama: "saved.jpg" } };
  }, { signal: new AbortController().signal, onReconnect: () => reconnects++, delay: async () => {} });
  assert.equal(reads, 3);
  assert.equal(reconnects, 1);
  assert.equal(restored.result?.panorama, "saved.jpg");
});

test("a new page can retrieve an already completed job immediately", async () => {
  let waits = 0;
  const result = await pollPanoramaJob("job-1", async () => ({ ...base, status: "completed", result: { panorama: "saved.jpg" } }), {
    signal: new AbortController().signal, delay: async () => { waits++; },
  });
  assert.equal(waits, 0);
  assert.equal(result.input.room_type, "Living room");
});

test("terminal worker failures preserve job and request IDs for debugging", async () => {
  await assert.rejects(pollPanoramaJob("job-1", async () => ({ ...base, status: "failed", code: "TOUR_JOB_EXPIRED", error: "Worker expired" }), {
    signal: new AbortController().signal,
  }), (error) => error instanceof PanoramaJobError && error.jobId === "job-1" && error.requestId === "req-1" && error.code === "TOUR_JOB_EXPIRED");
});

test("permission failures stop polling; page cancellation stops only the client watcher", async () => {
  let reads = 0;
  await assert.rejects(pollPanoramaJob("job-1", async () => { reads++; throw Object.assign(new Error("Forbidden"), { status: 403 }); }, { signal: new AbortController().signal }), /Forbidden/);
  assert.equal(reads, 1);
  const controller = new AbortController();
  controller.abort(new Error("Page closed"));
  await assert.rejects(pollPanoramaJob("job-1", async () => base, { signal: controller.signal }), /Page closed/);
});
