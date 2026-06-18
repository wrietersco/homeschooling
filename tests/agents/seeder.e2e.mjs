// Integration tests for the demo-data seeder against the Firestore emulator.
// Verifies that createDemoData writes all expected collections and relationships.
// Run via:
//   firebase emulators:exec --only firestore "node --test tests/agents/seeder.e2e.mjs"
import { test, before } from "node:test";
import assert from "node:assert/strict";
import admin from "firebase-admin";
import { createDemoData } from "../../functions/platform/seeder.js";

let db;
const FAM = "seederTestFam";
const UID = "seeder-owner-uid";

before(async () => {
  if (!admin.apps.length) admin.initializeApp({ projectId: "homeschooling-b3e57" });
  db = admin.firestore();
  await createDemoData(db, FAM, UID);
});

test("createDemoData seeds family profile, children, and member", async () => {
  const profile = await db.collection("families").doc(FAM).collection("profile").doc("family").get();
  assert.ok(profile.exists, "profile/family doc should exist");
  assert.ok(profile.data().guidingLight, "guidingLight should be set");
  assert.equal(profile.data().goalMode, "individual");

  const member = await db.collection("families").doc(FAM).collection("members").doc(UID).get();
  assert.ok(member.exists, "members/{uid} doc should exist");
  assert.equal(member.data().role, "owner");

  const children = await db.collection("families").doc(FAM).collection("children").get();
  assert.equal(children.size, 2, "should have 2 children");

  const guardians = await db.collection("families").doc(FAM).collection("guardians").get();
  assert.equal(guardians.size, 2, "should have 2 guardians");

  const skills = await db.collection("families").doc(FAM).collection("skills").get();
  assert.equal(skills.size, 3, "should have 3 skills");
});

test("createDemoData seeds curriculum with 4 subjects and 20 activities", async () => {
  const currSnap = await db.collection("families").doc(FAM).collection("curriculum").doc("curr_2025_26").get();
  assert.ok(currSnap.exists, "curriculum doc should exist");
  assert.equal(currSnap.data().status, "active");
  assert.equal(currSnap.data().subjectCount, 4);

  const subjects = await db
    .collection("families")
    .doc(FAM)
    .collection("curriculum")
    .doc("curr_2025_26")
    .collection("subjects")
    .get();
  assert.equal(subjects.size, 4, "should have 4 subjects");

  const activities = await db.collection("families").doc(FAM).collection("activities").get();
  assert.equal(activities.size, 20, "should have 20 activities");

  // Verify activity fields are populated
  const firstActivity = activities.docs[0].data();
  assert.ok(firstActivity.title, "activity should have title");
  assert.ok(firstActivity.parentInstructions, "activity should have parentInstructions");
  assert.ok(firstActivity.subjectId, "activity should have subjectId");
  assert.ok(firstActivity.targetChildren?.length > 0, "activity should have targetChildren");
});

test("createDemoData seeds calendar blocks, scores, and observations", async () => {
  // Calendar blocks span current and last week — query across all calendarDays
  const calDays = await db.collection("families").doc(FAM).collection("calendarDays").get();
  assert.ok(calDays.size >= 5, `should have at least 5 calendar days, got ${calDays.size}`);

  // Count total blocks across all days
  let totalBlocks = 0;
  for (const dayDoc of calDays.docs) {
    const blocks = await dayDoc.ref.collection("blocks").get();
    totalBlocks += blocks.size;
  }
  assert.ok(totalBlocks >= 10, `should have at least 10 calendar blocks, got ${totalBlocks}`);

  // Scores
  const scores = await db.collection("families").doc(FAM).collection("scores").get();
  assert.ok(scores.size >= 4, `should have at least 4 scores, got ${scores.size}`);

  const score = scores.docs[0].data();
  assert.ok(score.activityId, "score should have activityId");
  assert.ok(score.childId, "score should have childId");
  assert.equal(typeof score.completed, "boolean", "score.completed should be boolean");

  // Observations
  const observations = await db.collection("families").doc(FAM).collection("observations").get();
  assert.ok(observations.size >= 3, `should have at least 3 observations, got ${observations.size}`);

  const obs = observations.docs[0].data();
  assert.ok(obs.text, "observation should have text");
  assert.ok(obs.childId, "observation should have childId");
  assert.ok(obs.authorUid, "observation should have authorUid");
});
