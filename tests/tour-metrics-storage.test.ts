import assert from "node:assert/strict";
import test from "node:test";
import { initializeApp, deleteApp } from "firebase/app";
import { doc, getFirestore, serverTimestamp, writeBatch } from "firebase/firestore";
import { tourMetricsForStorage } from "../src/lib/tour-metrics-storage.ts";

const metrics = {
  image_count: 72,
  output_width: 4096,
  coverage_report: { around_coverage_ratio: 0.98 },
  camera_report: {
    exposure_gains: Array.from({ length: 72 }, (_, index) => [1 + index / 1000, 1, 0.95]),
    seam_resolution: [512, 256],
    focal_lengths: [800, 805],
  },
  overlap_report: [{ from_index: 0, to_index: 1, issues: [] }],
  ai_generated_regions: [{ pixel_bounds: { x: 0, y: 0, width: 20, height: 10 } }],
};

test("preserves 72-photo report values without mutating the generated result", () => {
  const original = structuredClone(metrics);
  const stored = tourMetricsForStorage(metrics) as Omit<typeof metrics, "camera_report"> & {
    camera_report: Omit<typeof metrics.camera_report, "exposure_gains"> & { exposure_gains: { values: number[] }[] };
  };
  assert.equal(stored.camera_report.exposure_gains.length, 72);
  assert.deepEqual(stored.camera_report.exposure_gains.map((row) => row.values), metrics.camera_report.exposure_gains);
  assert.deepEqual(stored.coverage_report, metrics.coverage_report);
  assert.deepEqual(stored.camera_report.seam_resolution, [512, 256]);
  assert.deepEqual(stored.overlap_report, metrics.overlap_report);
  assert.deepEqual(stored.ai_generated_regions, metrics.ai_generated_regions);
  assert.deepEqual(metrics, original);
});

test("supports deeper matrices, empty arrays and null, and is idempotent", () => {
  const stored = tourMetricsForStorage({ matrix: [[[1, 2], []], [null]], reports: [{ indices: [0, 1] }] });
  assert.deepEqual(stored, { matrix: [{ values: [{ values: [1, 2] }, { values: [] }] }, { values: [null] }], reports: [{ indices: [0, 1] }] });
  assert.deepEqual(tourMetricsForStorage(stored), stored);
  assert.equal(tourMetricsForStorage(null), null);
});

test("Firestore SDK accepts both create and update payloads with the saved job's matrix", async () => {
  const app = initializeApp({ projectId: "demo-tour-metrics" }, "tour-metrics-validation");
  try {
    const db = getFirestore(app);
    const reference = doc(db, "roomTours", "validation-only");
    // Parsing happens synchronously. Never commit this batch or make a network request.
    assert.throws(() => writeBatch(db).set(reference, { metrics }), /Nested arrays are not supported/);
    const payload = {
      propertyId: "property-1", brokerId: "broker-1", roomType: "Living room",
      metrics: tourMetricsForStorage(metrics), sourceImageUrls: ["https://example.com/source.jpg"],
      updatedAt: serverTimestamp(),
    };
    assert.doesNotThrow(() => writeBatch(db).set(reference, { ...payload, createdAt: serverTimestamp() }));
    assert.doesNotThrow(() => writeBatch(db).update(reference, payload));
  } finally {
    await deleteApp(app);
  }
});
