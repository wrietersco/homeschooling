// Integration tests for the syllabus builder against the Firestore emulator.
// Tests runSyllabusWorker (per-subject generation) and runSyllabus (master).
// Run via:
//   firebase emulators:exec --only firestore,functions "node --test tests/agents/*.e2e.mjs"
import { test, before } from "node:test";
import assert from "node:assert/strict";
import admin from "firebase-admin";
import { runSyllabusWorker, runSyllabus } from "../../functions/agents/syllabus.js";

let db;
const FAM = "syllabusFam";
const CURR_ID = "currForSyllabus";

before(async () => {
  if (!admin.apps.length) admin.initializeApp({ projectId: "homeschooling-b3e57" });
  db = admin.firestore();

  const root = db.collection("families").doc(FAM);
  await root.set({ name: "Syllabus Test Family" });
  await root.collection("profile").doc("family").set({
    familyName: "Syllabus Test Family",
    guidingLight: "Knowledge in service of faith and community.",
    goalMode: "individual",
  });
  await root.collection("children").doc("s1").set({ name: "Amina", dob: "2015-03-10" });
  await root.collection("children").doc("s2").set({ name: "Tariq", dob: "2017-07-22" });

  // Create a curriculum with one subject for the worker tests.
  const currRef = root.collection("curriculum").doc(CURR_ID);
  await currRef.set({
    title: "Test Curriculum",
    status: "active",
    subjectCount: 2,
    objectives: "Test objectives.",
    guidingLightSnapshot: "Knowledge in service of faith and community.",
    createdAt: new Date(),
  });
  await currRef.collection("subjects").doc("sub1").set({
    name: "Quran Recitation",
    macroGoals: ["Memorise Al-Fatiha", "Read with basic tajweed"],
    contentOutline: "Month 1-2: Al-Fatiha; Month 3-4: short surahs; Month 5-6: revision",
    instructionApproach: "Daily 15-minute recitation with parent",
    assessmentMethod: "Each surah recited correctly from memory = complete",
  });
  await currRef.collection("subjects").doc("sub2").set({
    name: "Mathematics",
    macroGoals: ["Count to 100", "Add and subtract within 20"],
    contentOutline: "Month 1-2: counting; Month 3-4: addition; Month 5-6: subtraction",
    instructionApproach: "Manipulatives and games",
    assessmentMethod: "Task completion at each level",
  });
});

// Fake LLM that calls create_activity the specified number of times then finishes.
function makeFakeLlm(subjectName, count = 4) {
  const script = [];
  for (let i = 1; i <= count; i++) {
    script.push({
      text: "",
      functionCalls: [{
        name: "create_activity",
        args: {
          title: `${subjectName} Activity ${i}`,
          type: i % 2 === 0 ? "teaching" : "quran",
          complexityRank: i,
          parentInstructions: `Parent instructions for rank ${i}.`,
          exampleWalkthrough: `Example walkthrough for rank ${i}.`,
          durationMinutes: 20 + i * 5,
        },
      }],
    });
  }
  script.push({ text: `Generated ${count} activities for ${subjectName}.`, functionCalls: [] });
  let step = 0;
  return { generate: async () => script[Math.min(step++, script.length - 1)] };
}

test("runSyllabusWorker creates activities for a single subject", async () => {
  const llm = makeFakeLlm("Quran Recitation", 4);

  const result = await runSyllabusWorker({
    db, familyId: FAM, curriculumId: CURR_ID, subjectId: "sub1", uid: "ownerA", role: "owner", llm,
  });

  assert.equal(result.activitiesCreated.length, 4);
  assert.equal(result.subjectName, "Quran Recitation");

  // Verify activities are in Firestore
  const snap = await db.collection("families").doc(FAM).collection("activities")
    .where("subjectId", "==", "sub1").get();
  assert.equal(snap.size, 4);

  const ranks = snap.docs.map((d) => d.data().complexityRank).sort((a, b) => a - b);
  assert.deepEqual(ranks, [1, 2, 3, 4]);

  // Each activity should reference the family, curriculum, and subject
  const first = snap.docs[0].data();
  assert.equal(first.curriculumId, CURR_ID);
  assert.equal(first.subjectId, "sub1");
  assert.ok(first.parentInstructions);
});

test("runSyllabusWorker respects complexity rank 1-5 and type validation", async () => {
  // Use a script with out-of-range rank and invalid type to test clamping/fallback.
  const script = [
    {
      text: "",
      functionCalls: [{
        name: "create_activity",
        args: { title: "Test", type: "invalid_type", complexityRank: 99, parentInstructions: "x" },
      }],
    },
    { text: "Done.", functionCalls: [] },
  ];
  let i = 0;
  const llm = { generate: async () => script[Math.min(i++, script.length - 1)] };

  const result = await runSyllabusWorker({
    db, familyId: FAM, curriculumId: CURR_ID, subjectId: "sub2", uid: "ownerA", role: "owner", llm,
  });

  assert.equal(result.activitiesCreated.length, 1);
  const snap = await db.collection("families").doc(FAM).collection("activities")
    .where("title", "==", "Test").get();
  assert.ok(snap.size >= 1);
  const data = snap.docs[0].data();
  assert.equal(data.complexityRank, 5); // clamped from 99
  assert.equal(data.type, "teaching"); // fallback from invalid_type
});

test("runSyllabus master creates run doc, processes all subjects, marks done", async () => {
  // Use a fresh family to avoid cross-test activity count contamination.
  const FAM2 = "syllabusFam2";
  const CURR2 = "currForSyllabus2";
  const root2 = db.collection("families").doc(FAM2);
  await root2.set({ name: "Syllabus Master Test" });
  await root2.collection("profile").doc("family").set({
    familyName: "Syllabus Master Test",
    guidingLight: "Striving for excellence.",
  });
  await root2.collection("children").doc("c1").set({ name: "Zara" });
  const curr2Ref = root2.collection("curriculum").doc(CURR2);
  await curr2Ref.set({ title: "Master Test Curriculum", status: "active", subjectCount: 2, createdAt: new Date() });
  await curr2Ref.collection("subjects").doc("sA").set({ name: "Arabic", macroGoals: ["Read basic words"], contentOutline: "Letters first", instructionApproach: "Daily practice", assessmentMethod: "Completion" });
  await curr2Ref.collection("subjects").doc("sB").set({ name: "Science", macroGoals: ["Observe nature"], contentOutline: "Seasons", instructionApproach: "Hands-on", assessmentMethod: "Completion" });

  // Two workers, 3 activities each
  const scripts = {
    sA: makeFakeLlm("Arabic", 3),
    sB: makeFakeLlm("Science", 3),
  };
  // The master calls runSyllabusWorker internally; inject per-subject LLMs via a multiplexing fake.
  let callCount = 0;
  const multiplexLlm = {
    generate: async (req) => {
      // Detect which subject by checking the system prompt.
      const sys = req.system || "";
      const subject = sys.includes("Arabic") ? "sA" : "sB";
      return scripts[subject].generate(req);
    },
  };

  const result = await runSyllabus({
    db, familyId: FAM2, curriculumId: CURR2, uid: "ownerA", role: "owner", llm: multiplexLlm,
  });

  assert.ok(result.runId);
  assert.equal(result.completedSubjects, 2);
  assert.equal(result.totalActivities, 6); // 3 per subject

  // Run doc should be "done"
  const runDoc = await root2.collection("agentRuns").doc(result.runId).get();
  assert.ok(runDoc.exists);
  assert.equal(runDoc.data().status, "done");
  assert.equal(runDoc.data().totalActivities, 6);
  assert.equal(runDoc.data().type, "syllabus");

  // Both subjects marked done in the run doc
  const subs = runDoc.data().subjects;
  assert.equal(subs.sA.status, "done");
  assert.equal(subs.sB.status, "done");
  assert.equal(subs.sA.activityCount, 3);
  assert.equal(subs.sB.activityCount, 3);

  // Activities created in Firestore
  const activSnap = await root2.collection("activities").get();
  assert.equal(activSnap.size, 6);
});
