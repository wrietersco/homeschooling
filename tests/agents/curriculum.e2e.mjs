// Integration tests for the curriculum agent against the Firestore emulator.
// Verifies: interview flow, finalize_curriculum writes, subjects subcollection,
// guiding-light presence in the grounded prompt, and the audit trail.
// Run via:
//   firebase emulators:exec --only firestore,functions "node --test tests/agents/*.e2e.mjs"
import { test, before } from "node:test";
import assert from "node:assert/strict";
import admin from "firebase-admin";
import { runCurriculum } from "../../functions/agents/curriculum.js";
import { buildGroundedSystemPrompt } from "../../functions/agents/grounding.js";

let db;
const FAM = "curriculumFam";

before(async () => {
  if (!admin.apps.length) admin.initializeApp({ projectId: "homeschooling-b3e57" });
  db = admin.firestore();
  const root = db.collection("families").doc(FAM);
  await root.set({ name: "Curriculum Test Family" });
  await root.collection("profile").doc("family").set({
    familyName: "Curriculum Test Family",
    guidingLight: "Learning rooted in taqwa and critical thought.",
    goalMode: "individual",
  });
  await root.collection("children").doc("ch1").set({ name: "Nour", dob: "2016-05-01" });
  await root.collection("children").doc("ch2").set({ name: "Bilal", dob: "2018-09-15" });
  await root.collection("skills").doc("sk1").set({ name: "Arabic Alphabet", category: "Language" });
});

test("runCurriculum returns interviewing text when agent does not call finalize_curriculum", async () => {
  const fakeLlm = {
    generate: async () => ({
      text: "Assalamu alaykum! To build a great curriculum, could you tell me which subjects you would like to cover and your children's current levels?",
      functionCalls: [],
    }),
  };

  const result = await runCurriculum({
    db,
    familyId: FAM,
    uid: "ownerA",
    role: "owner",
    message: "I want a 6-month curriculum.",
    history: [],
    llm: fakeLlm,
  });

  assert.ok(result.text.length > 0);
  assert.equal(result.curriculum, null); // not finalized yet
  assert.ok(result.runId);
});

test("runCurriculum creates curriculum doc + subjects when agent calls finalize_curriculum", async () => {
  const SUBJECTS = [
    {
      name: "Quran & Tafsir",
      macroGoals: ["Memorise last 10 surahs", "Understand Al-Fatiha meaning"],
      contentOutline: "Month 1-2: review + Al-Ikhlas family; Month 3-4: An-Nas to Al-Asr; Month 5-6: revision + tafsir discussion",
      instructionApproach: "Daily 20-min recitation session, teacher models first, children repeat",
      assessmentMethod: "Completion of assigned surah per month — no inter-child comparison",
      gradingStandards: "Surah memorised with correct tajweed = complete",
      targetChildren: ["ch1", "ch2"],
    },
    {
      name: "Mathematics",
      macroGoals: ["Master addition/subtraction to 100", "Introduction to multiplication"],
      contentOutline: "Month 1-2: place value; Month 3-4: addition/subtraction; Month 5-6: multiplication tables 2-5",
      instructionApproach: "Hands-on manipulatives, then worksheet consolidation",
      assessmentMethod: "Each topic unit completed before moving on",
      gradingStandards: "80% accuracy on end-of-unit task = complete",
    },
  ];

  const script = [
    // Turn 1: agent reads available data
    { text: "", functionCalls: [{ name: "list_collections", args: {} }] },
    // Turn 2: query children
    { text: "", functionCalls: [{ name: "query_collection", args: { collection: "children" } }] },
    // Turn 3: generate the plan
    {
      text: "",
      functionCalls: [{
        name: "finalize_curriculum",
        args: {
          title: "Taqwa-Rooted Year 1 Plan",
          objectives: "A 6-month plan grounded in taqwa and critical thought, covering Quran and Mathematics for Nour and Bilal.",
          subjects: SUBJECTS,
          guidingLightSnapshot: "Learning rooted in taqwa and critical thought.",
        },
      }],
    },
    // Turn 4: confirmation text
    { text: "Your curriculum 'Taqwa-Rooted Year 1 Plan' has been created with 2 subjects. May Allah make it beneficial!", functionCalls: [] },
  ];

  let step = 0;
  const fakeLlm = { generate: async () => script[Math.min(step++, script.length - 1)] };

  const result = await runCurriculum({
    db,
    familyId: FAM,
    uid: "ownerA",
    role: "owner",
    message: "Please create a Quran and maths curriculum for my two children.",
    history: [],
    llm: fakeLlm,
  });

  // Agent returned a final text
  assert.match(result.text, /curriculum/i);
  // Curriculum metadata returned to caller
  assert.ok(result.curriculum, "curriculum should be returned");
  assert.equal(result.curriculum.title, "Taqwa-Rooted Year 1 Plan");
  assert.equal(result.curriculum.subjectCount, 2);

  // Firestore: curriculum doc exists and is active
  const currDoc = await db
    .collection("families").doc(FAM)
    .collection("curriculum").doc(result.curriculum.id)
    .get();
  assert.ok(currDoc.exists, "curriculum doc should exist in Firestore");
  assert.equal(currDoc.data().status, "active");
  assert.equal(currDoc.data().subjectCount, 2);
  assert.ok(currDoc.data().guidingLightSnapshot);

  // Firestore: subjects subcollection has 2 docs
  const subjectsSnap = await db
    .collection("families").doc(FAM)
    .collection("curriculum").doc(result.curriculum.id)
    .collection("subjects").get();
  assert.equal(subjectsSnap.size, 2);
  const subjectNames = subjectsSnap.docs.map((d) => d.data().name).sort();
  assert.deepEqual(subjectNames, ["Mathematics", "Quran & Tafsir"]);

  // Audit trail recorded the creation
  const runDoc = await db
    .collection("families").doc(FAM)
    .collection("agentRuns").doc(result.runId)
    .get();
  assert.ok(runDoc.exists);
  assert.equal(runDoc.data().status, "done");
  assert.ok(runDoc.data().curriculumId);
});

test("grounded system prompt for curriculum contains guiding light", async () => {
  const system = await buildGroundedSystemPrompt(
    db, FAM,
    "You are the curriculum architect for this family."
  );
  assert.match(system, /curriculum architect/);
  assert.match(system, /taqwa/i);
  assert.match(system, /weight this heavily/i);
  assert.match(system, /Nour/);
  assert.match(system, /Bilal/);
});

test("runCurriculum multi-turn: second message uses history to produce a plan", async () => {
  // Simulate a second turn where the parent answered the interview questions.
  const priorHistory = [
    { role: "user", parts: [{ text: "I want a curriculum." }] },
    { role: "model", parts: [{ text: "Great! Which subjects and what level are your children at?" }] },
  ];

  const script = [
    {
      text: "",
      functionCalls: [{
        name: "finalize_curriculum",
        args: {
          title: "Multi-turn Test Plan",
          objectives: "Test plan from multi-turn conversation.",
          subjects: [{
            name: "Arabic",
            macroGoals: ["Read basic Arabic script"],
            contentOutline: "Month 1-6: letters and short words",
            instructionApproach: "Daily practice",
            assessmentMethod: "Letter recognition completion",
          }],
          guidingLightSnapshot: "Learning rooted in taqwa and critical thought.",
        },
      }],
    },
    { text: "Done! Your Arabic curriculum is ready.", functionCalls: [] },
  ];
  let step = 0;
  const fakeLlm = { generate: async () => script[Math.min(step++, script.length - 1)] };

  const result = await runCurriculum({
    db,
    familyId: FAM,
    uid: "ownerA",
    role: "owner",
    message: "Cover Arabic for my children, they are beginners.",
    history: priorHistory,
    llm: fakeLlm,
  });

  assert.ok(result.curriculum);
  assert.equal(result.curriculum.title, "Multi-turn Test Plan");
  assert.equal(result.curriculum.subjectCount, 1);
});
