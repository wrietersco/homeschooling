// Verifies the agent DB-index triggers keep families/{id}/_agent_index/{col}
// counts live. Needs the FUNCTIONS emulator running (the triggers) alongside
// Firestore. Run via:
//   firebase emulators:exec --only firestore,functions "node --test tests/agents/*.e2e.mjs"
import { test, before } from "node:test";
import assert from "node:assert/strict";
import admin from "firebase-admin";

let db;
const FAM = "idxFam";

before(() => {
  // Project must match the emulator's so the index triggers fire (see note in
  // agent-tools.e2e.mjs).
  if (!admin.apps.length) admin.initializeApp({ projectId: "homeschooling-b3e57" });
  db = admin.firestore();
});

// Poll until predicate(value) is true or timeout — triggers are async.
async function waitFor(getter, predicate, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    const v = await getter();
    if (predicate(v)) return v;
    if (Date.now() - start > timeoutMs) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
}

test("creating children increments the agent index count", async () => {
  const children = db.collection("families").doc(FAM).collection("children");
  await children.doc("k1").set({ name: "A", strengths: "x" });
  await children.doc("k2").set({ name: "B" });

  const idxRef = db.collection("families").doc(FAM).collection("_agent_index").doc("children");
  const data = await waitFor(
    async () => (await idxRef.get()).data() || {},
    (d) => d.count === 2
  );
  assert.equal(data.count, 2, `expected count 2, got ${data.count}`);
  // Field-name hints captured from written docs.
  assert.ok(Array.isArray(data.fields) && data.fields.includes("name"));
});

test("deleting a child decrements the count", async () => {
  const children = db.collection("families").doc(FAM).collection("children");
  await children.doc("k1").delete();
  const idxRef = db.collection("families").doc(FAM).collection("_agent_index").doc("children");
  const data = await waitFor(
    async () => (await idxRef.get()).data() || {},
    (d) => d.count === 1
  );
  assert.equal(data.count, 1, `expected count 1, got ${data.count}`);
});
