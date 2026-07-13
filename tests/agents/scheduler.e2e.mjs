// Integration test for the planner auto-scheduler against the Firestore emulator.
// Verifies runAutoSchedule places blocks (status "planned") via the schedule_block
// tool, creates the calendarDays parent doc, and rejects unknown ids / out-of-week dates.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import admin from "firebase-admin";
import { runAutoSchedule, loadScheduleHistory } from "../../functions/agents/scheduler.js";

let db;
const FAM = "schedulerFam";
const WEEK = ["2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19", "2026-06-20", "2026-06-21"];

before(async () => {
  if (!admin.apps.length) admin.initializeApp({ projectId: "homeschooling-b3e57" });
  db = admin.firestore();
  const root = db.collection("families").doc(FAM);
  await root.set({ name: "Scheduler Test Family" });
  await root.collection("profile").doc("family").set({ familyName: "Scheduler Test Family", guidingLight: "Balance." });
  await root.collection("children").doc("c1").set({ name: "Sara" });
  await root.collection("guardians").doc("g1").set({
    name: "Dad",
    availability: { mon: [{ start: "09:00", end: "12:00" }] },
    createdAt: new Date(),
  });
  await root.collection("activities").doc("act1").set({
    title: "Counting to 10", type: "mathematics", subject: "Math",
    complexityRank: 1, durationMinutes: 20, targetChildren: ["c1"], createdAt: new Date(),
  });
});

// Fake LLM: one valid schedule_block, one with a bad activityId, one outside the
// week, then a final message.
function makeFakeLlm() {
  const script = [
    { text: "", functionCalls: [{ name: "schedule_block", args: { activityId: "act1", dateKey: WEEK[0], scheduledTime: "09:30" } }] },
    { text: "", functionCalls: [{ name: "schedule_block", args: { activityId: "nope", dateKey: WEEK[1], scheduledTime: "10:00" } }] },
    { text: "", functionCalls: [{ name: "schedule_block", args: { activityId: "act1", dateKey: "2026-07-01", scheduledTime: "10:00" } }] },
    { text: "Scheduled the week.", functionCalls: [] },
  ];
  let i = 0;
  return { generate: async () => script[Math.min(i++, script.length - 1)] };
}

test("runAutoSchedule writes a planned block and rejects bad inputs", async () => {
  const result = await runAutoSchedule({
    db, familyId: FAM, uid: "owner1", weekDateKeys: WEEK, llm: makeFakeLlm(),
  });

  assert.equal(result.scheduled, 1); // only the valid call counted

  // The valid block landed on day 0 with status "planned".
  const blocksSnap = await db.collection("families").doc(FAM)
    .collection("calendarDays").doc(WEEK[0]).collection("blocks").get();
  assert.equal(blocksSnap.size, 1);
  const block = blocksSnap.docs[0].data();
  assert.equal(block.activityId, "act1");
  assert.equal(block.status, "planned");
  assert.equal(block.scheduledTime, "09:30");
  assert.equal(block.scheduledBy, "agent");

  // The calendarDays parent doc exists (so collection queries return the day).
  const dayDoc = await db.collection("families").doc(FAM).collection("calendarDays").doc(WEEK[0]).get();
  assert.ok(dayDoc.exists);

  // The out-of-week day got no block.
  const julySnap = await db.collection("families").doc(FAM)
    .collection("calendarDays").doc("2026-07-01").collection("blocks").get();
  assert.equal(julySnap.size, 0);

  // The run doc was recorded as done.
  const runDoc = await db.collection("families").doc(FAM).collection("agentRuns").doc(result.runId).get();
  assert.equal(runDoc.data().status, "done");
  assert.equal(runDoc.data().scheduled, 1);
});

// Regression guard: loadScheduleHistory does a documentId() range query over
// calendarDays. With a statically-imported FieldPath this threw against a
// test-injected (root-package) db and was silently swallowed, so the scheduler
// ran with no history. This asserts a prior-week block is actually read back.
test("loadScheduleHistory reads prior placements in the window (FieldPath cross-package guard)", async () => {
  const PAST = "2026-06-08"; // one week before WEEK[0], inside the 6-week lookback
  const dayRef = db.collection("families").doc(FAM).collection("calendarDays").doc(PAST);
  await dayRef.set({ updatedAt: new Date() }, { merge: true });
  await dayRef.collection("blocks").add({
    activityId: "act1", activityTitle: "Counting to 10", type: "mathematics",
    subject: "Math", scheduledTime: "09:00", complexityRank: 1, status: "planned",
  });

  const { days } = await loadScheduleHistory({ db, familyId: FAM, weekDateKeys: WEEK });
  const past = days.find((d) => d.date === PAST);
  assert.ok(past, "expected the prior-week day to be loaded (history query must not silently fail)");
  assert.equal(past.blocks.length, 1);
  assert.equal(past.blocks[0].activityId, "act1");
});
