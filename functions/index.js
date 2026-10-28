const crypto = require("node:crypto");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

admin.initializeApp();
setGlobalOptions({ region: "asia-southeast1", maxInstances: 3, memory: "256MiB", timeoutSeconds: 60 });
const db = getFirestore();
const QUEUE = process.env.NOTIFICATION_QUEUE_COLLECTION || "notificationQueue";
const GENERIC = {
  "viewing-request": ["New viewing request", "Open LiBot to review a viewing request.", "schedule"],
  "viewing-approved": ["Viewing approved", "Your LiBot viewing update is ready.", "schedule"],
  "viewing-declined": ["Viewing update", "Your LiBot viewing update is ready.", "schedule"],
  "viewing-rescheduled": ["Viewing rescheduled", "Your LiBot viewing update is ready.", "schedule"],
  "negotiation-update": ["Negotiation update", "Your LiBot negotiation has an update.", "negotiation"],
  "broker-verification": ["Verification update", "Your LiBot verification status has changed.", "schedule"],
};

function eventId(type, sourceId, recipientId, version) {
  return crypto.createHash("sha256").update(`${type}:${sourceId}:${recipientId}:${version}`).digest("hex");
}

async function enqueue(type, sourceId, recipientId, target, version) {
  const [title, body, targetType] = GENERIC[type];
  const subscriptions = await db.collection("users").doc(recipientId).collection("pushSubscriptions").where("enabled", "==", true).get();
  const batch = db.batch();
  subscriptions.forEach((subscription) => {
    const id = eventId(type, sourceId, `${recipientId}:${subscription.id}`, version);
    batch.set(db.collection(QUEUE).doc(id), {
      payload: { type, targetType, target, userId: recipientId, subscriptionId: subscription.id },
      preview: { title, body }, status: "pending", attempts: 0,
      createdAt: FieldValue.serverTimestamp(), nextAttemptAt: FieldValue.serverTimestamp(),
    }, { merge: false });
  });
  await batch.commit();
}

exports.viewingScheduleChanged = onDocumentWritten("viewingSchedules/{scheduleId}", async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  if (!after) return;
  const status = after.status || "pending";
  const previous = before && before.status;
  const type = !before ? "viewing-request" : status !== previous ? ({ confirmed: "viewing-approved", rejected: "viewing-declined", cancelled: "viewing-declined" }[status] || (status === "pending" && previous === "confirmed" ? "viewing-rescheduled" : null)) : null;
  if (!type) return;
  const recipient = type === "viewing-request" ? after.brokerId : after.buyerId;
  if (recipient) await enqueue(type, event.params.scheduleId, recipient, type === "viewing-request" ? "/broker/calendar" : "/buyer/calendar", after.updatedAt || status);
});

exports.negotiationChanged = onDocumentWritten("negotiations/{negotiationId}", async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  if (!after || JSON.stringify(before && before.messages) === JSON.stringify(after.messages)) return;
  const latestSenderId = Array.isArray(after.messages) ? after.messages.at(-1)?.senderId : null;
  const recipient = latestSenderId === after.buyerId ? after.brokerId : latestSenderId === after.brokerId ? after.buyerId : null;
  if (recipient) await enqueue("negotiation-update", event.params.negotiationId, recipient, after.buyerId === recipient ? "/buyer/negotiations" : "/broker/negotiations", after.updatedAt || Date.now());
});

exports.brokerVerificationChanged = onDocumentWritten("users/{userId}", async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  if (!after || after.role !== "broker" || !before || before.verificationStatus === after.verificationStatus || !["verified", "rejected"].includes(after.verificationStatus)) return;
  await enqueue("broker-verification", event.params.userId, event.params.userId, "/broker/profile", after.verificationStatus);
});
