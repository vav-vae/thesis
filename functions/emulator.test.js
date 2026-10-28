const test = require("node:test");
const assert = require("node:assert/strict");
const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

async function waitForQuerySize(query, expected, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let snapshot;
  do {
    snapshot = await query.get();
    if (snapshot.size === expected) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  return snapshot;
}

const enabled = process.env.FIRESTORE_EMULATOR_HOST;
test("trigger integration environment is configured", { skip: !enabled }, async () => {
  if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "libot-790e6" });
  const db = getFirestore();
  const broker = "broker-emulator", buyer = "buyer-emulator";
  await db.collection("users").doc(broker).collection("pushSubscriptions").doc("device-1").set({ enabled: true, endpoint: "https://push.example/1", keys: { p256dh: "x", auth: "y" } });
  await db.collection("users").doc(broker).collection("pushSubscriptions").doc("device-2").set({ enabled: false, endpoint: "https://push.example/2", keys: { p256dh: "x", auth: "y" } });
  const schedule = db.collection("viewingSchedules").doc("schedule-emulator");
  await schedule.set({ buyerId: buyer, brokerId: broker, status: "pending", updatedAt: "v1" });
  const jobs = db.collection("notificationQueue").where("payload.userId", "==", broker);
  const first = await waitForQuerySize(jobs, 1);
  assert.equal(first.size, 1, "only enabled devices should receive a job");
  await schedule.update({ propertyTitle: "unrelated change" });
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal((await jobs.get()).size, 1);
});
