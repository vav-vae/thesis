import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseTourLog } from "../src/lib/tour-log-diagnosis.ts";

test("legacy stream failure distinguishes last client stage from server failure", () => {
  const diagnosis = diagnoseTourLog({ message: "The panorama response stream was interrupted.", detail: "Stage: Tour generation (Checking overlap for photo 6 of 28)\nCapture set: 28 photos\nHTTP: 200\nRequest ID: request-123", online: true });
  assert.equal(diagnosis.code, "TOUR_STREAM_INTERRUPTED");
  assert.match(diagnosis.explanation, /backend may have continued/);
  assert.match(diagnosis.explanation, /exact cause is unconfirmed/);
  assert.equal(diagnosis.facts.find((fact) => fact.label === "Request ID")?.value, "request-123");
  assert.match(diagnosis.facts.find((fact) => fact.label === "HTTP")!.value, /completion not guaranteed/);
});

test("permission and capacity failures have distinct debugging steps", () => {
  assert.equal(diagnoseTourLog({ message: "Rejected", detail: "HTTP: 403", online: true }).code, "TOUR_ACCESS_DENIED");
  assert.equal(diagnoseTourLog({ message: "Busy", detail: "HTTP: 503", online: true }).code, "TOUR_PROCESSOR_BUSY");
  assert.equal(diagnoseTourLog({ message: "Error", detail: "HTTP: 504", online: true }).code, "TOUR_TIMEOUT");
});

test("upload HTTP 500 is a server failure even when the browser reports offline", () => {
  const diagnosis = diagnoseTourLog({ message: "photo upload failed: Unable to authorize this upload.", detail: "Stage: photo upload\nHTTP: 500\nRequest: POST https://api.cloudinary.com/v1_1/example/image/upload\nResponse URL: https://libot-weld.vercel.app/api/backend/uploads/sign\nVercel request ID: request-500", online: false });
  assert.equal(diagnosis.code, "TOUR_SERVER_ERROR");
  assert.equal(diagnosis.facts.find((fact) => fact.label === "Request")?.value, "https://libot-weld.vercel.app/api/backend/uploads/sign");
  assert.match(diagnosis.suggestions.join(" "), /Vercel request ID/);
});

test("upload failed wording alone does not imply a browser transport failure", () => {
  assert.equal(diagnoseTourLog({ message: "Photo upload failed: Invalid signature", detail: "HTTP: 400", online: true }).code, "TOUR_OPERATION_FAILED");
  assert.equal(diagnoseTourLog({ message: "Load failed", detail: "", online: true }).code, "TOUR_NETWORK_ERROR");
});
