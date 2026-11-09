const test = require("node:test");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, setDoc, getDoc, updateDoc, deleteDoc, Timestamp } = require("firebase/firestore");
const fs = require("node:fs");

let env;
const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
test.before(async () => {
  if (!emulatorAvailable) return;
  env = await initializeTestEnvironment({ projectId: "demo-libot", firestore: { rules: fs.readFileSync("../firestore.rules", "utf8") } });
  await env.withSecurityRulesDisabled(async context => {
    for (const [uid, role] of Object.entries({ 'buyer-1': 'buyer', 'buyer-2': 'buyer', 'broker-1': 'broker', 'broker-2': 'broker', 'admin-1': 'admin' })) {
      await setDoc(doc(context.firestore(), 'users', uid), { role, accountStatus: 'active' });
    }
    await setDoc(doc(context.firestore(), 'properties/p-1'), { brokerId: 'broker-1', status: 'active' });
  });
});
test.after(async () => { if (env) await env.cleanup(); });
const db = (uid, token = {}) => env.authenticatedContext(uid, token).firestore();

const ruleTest = emulatorAvailable ? test : test.skip;
ruleTest("owners can edit settings but cannot grant privileges", async () => {
  await assertSucceeds(updateDoc(doc(db("buyer-1"), "users/buyer-1"), { settings: { listings: true } }));
  await assertSucceeds(getDoc(doc(db("buyer-1"), "users/buyer-1")));
  await assertFails(updateDoc(doc(db("buyer-1"), "users/buyer-1"), { role: 'admin' }));
  await assertFails(updateDoc(doc(db("buyer-2"), "users/buyer-1"), { settings: {} }));
});
ruleTest("schedule participants can read, but unrelated users cannot", async () => {
  await assertSucceeds(setDoc(doc(db("buyer-1"), "viewingSchedules/s-1"), { buyerId: "buyer-1", brokerId: "broker-1", propertyId: 'p-1', status: "pending", scheduledAt: Timestamp.fromMillis(Date.now() + 3600000), durationMinutes: 60 }));
  await assertSucceeds(getDoc(doc(db("broker-1"), "viewingSchedules/s-1")));
  await assertFails(getDoc(doc(db("buyer-2"), "viewingSchedules/s-1")));
});
ruleTest("property ownership and negotiation participation are enforced", async () => {
  await assertSucceeds(setDoc(doc(db("broker-1"), "properties/p-1"), { brokerId: "broker-1", status: "active" }));
  await assertFails(updateDoc(doc(db("broker-2"), "properties/p-1"), { status: "inactive" }));
  await assertSucceeds(setDoc(doc(db("buyer-1"), "negotiations/n-1"), { buyerId: "buyer-1", brokerId: "broker-1", propertyId: 'p-1', status: 'active', messages: [] }));
  await assertSucceeds(getDoc(doc(db("broker-1"), "negotiations/n-1")));
});
ruleTest("clients cannot access notification collections", async () => {
  await assertFails(setDoc(doc(db("buyer-1"), "users/buyer-1/pushSubscriptions/device-1"), { enabled: true }));
  await assertFails(getDoc(doc(db("buyer-1"), "users/buyer-1/pushSubscriptions/device-1")));
  await assertFails(setDoc(doc(db("buyer-1"), "notificationQueue/job-1"), { status: "pending" }));
  await assertFails(deleteDoc(doc(db("buyer-1"), "notificationQueue/job-1")));
});
ruleTest("published property reads remain compatible with production", async () => { await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), "properties/p-1"))); });
ruleTest("new brokers register pending but cannot verify themselves", async () => {
  await assertSucceeds(setDoc(doc(db('new-broker'), 'users/new-broker'), { role: 'broker', verificationStatus: 'pending', rejectionReason: null }));
  await assertFails(updateDoc(doc(db('new-broker'), 'users/new-broker'), { verificationStatus: 'verified' }));
  await assertFails(setDoc(doc(db('fake-admin'), 'users/fake-admin'), { role: 'admin' }));
  await assertSucceeds(updateDoc(doc(db('admin-1'), 'users/new-broker'), { verificationStatus: 'verified' }));
});
ruleTest("gallery uploads authorize through the property, without a brokerId field", async () => {
  await assertSucceeds(setDoc(doc(db('broker-1'), 'roomImages/room-1'), { propertyId: 'p-1', roomType: 'Living room', imageUrls: ['https://example.com/room.jpg'] }));
  await assertFails(setDoc(doc(db('broker-2'), 'roomImages/room-2'), { propertyId: 'p-1', imageUrls: [] }));
});
