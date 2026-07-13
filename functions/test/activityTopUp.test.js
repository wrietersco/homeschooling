import { test } from "node:test";
import assert from "node:assert/strict";
import { startActivityTopUp, runSyllabusWorker } from "../agents/syllabus.js";

// ─── startActivityTopUp ─────────────────────────────────────────────────────

function emptySnap() { return { empty: true, size: 0, docs: [] }; }
function snapFromArray(arr, idPrefix = "d") {
  return { empty: arr.length === 0, size: arr.length, docs: arr.map((data, i) => ({ id: `${idPrefix}${i}`, data: () => data })) };
}

// Fake db covering exactly what startActivityTopUp touches: curriculum/subjects,
// a curriculumId-scoped activities query, and writes to agentRuns + syllabusQueue.
function makeTopUpDb({ subjects, activities }) {
  const runWrites = [];
  const queueWrites = [];
  let nextRunId = 0;
  return {
    runWrites,
    queueWrites,
    collection(name) {
      if (name === "families") {
        return {
          doc: () => ({
            collection: (sub) => {
              if (sub === "curriculum") {
                return { doc: () => ({ collection: () => ({ async get() { return snapFromArray(subjects, "subj"); } }) }) };
              }
              if (sub === "activities") {
                return {
                  where(field, _op, value) {
                    return { async get() { return snapFromArray(activities.filter((a) => a[field] === value), "act"); } };
                  },
                };
              }
              if (sub === "agentRuns") {
                return {
                  doc: () => {
                    const id = `run${++nextRunId}`;
                    return { id, async set(patch) { runWrites.push({ id, patch }); } };
                  },
                };
              }
              return undefined;
            },
          }),
        };
      }
      if (name === "syllabusQueue") {
        return { doc: (id) => ({ async set(patch) { queueWrites.push({ id, patch }); } }) };
      }
      return undefined;
    },
  };
}

test("startActivityTopUp skips subjects with no matching-type activity and seeds existing+addCount for the rest", async () => {
  const subjects = [
    { name: "Mathematics" }, // subj0 — has a mathematics activity
    { name: "Quran" },       // subj1 — no mathematics activity
  ];
  const activities = [
    { subjectId: "subj0", curriculumId: "cur1", type: "mathematics" },
    { subjectId: "subj0", curriculumId: "cur1", type: "teaching" },
    { subjectId: "subj1", curriculumId: "cur1", type: "quran" },
  ];
  const db = makeTopUpDb({ subjects, activities });

  const res = await startActivityTopUp({
    db, familyId: "fam1", curriculumId: "cur1", uid: "u1", role: "owner",
    onlyTypes: ["mathematics"], addCount: 3,
  });

  assert.equal(res.totalSubjects, 2);
  assert.equal(res.matchingSubjects, 1);
  assert.equal(res.status, "queued");

  const runPatch = db.runWrites[0].patch;
  assert.equal(runPatch.mode, "topup");
  assert.deepEqual(runPatch.onlyTypes, ["mathematics"]);
  assert.equal(runPatch.batchActivities, 3);

  // subj0 (matching) has 2 existing activities of any type → target = 2 + 3.
  assert.equal(runPatch.subjects.subj0.matched, true);
  assert.equal(runPatch.subjects.subj0.status, "pending");
  assert.equal(runPatch.subjects.subj0.activityCount, 2);
  assert.equal(runPatch.subjects.subj0.targetActivityCount, 5);

  // subj1 (no matching type) is pre-marked done so the run skips it outright.
  assert.equal(runPatch.subjects.subj1.matched, false);
  assert.equal(runPatch.subjects.subj1.status, "done");
  assert.equal(runPatch.subjects.subj1.targetActivityCount, runPatch.subjects.subj1.activityCount);

  // The queue row was also written so syllabusWorker picks it up unchanged.
  assert.equal(db.queueWrites[0].patch.status, "queued");
});

test("startActivityTopUp throws when no subject has the requested type yet", async () => {
  const subjects = [{ name: "Quran" }];
  const activities = [{ subjectId: "subj0", curriculumId: "cur1", type: "quran" }];
  const db = makeTopUpDb({ subjects, activities });

  await assert.rejects(
    () => startActivityTopUp({ db, familyId: "fam1", curriculumId: "cur1", uid: "u1", onlyTypes: ["mathematics"], addCount: 3 }),
    /none of the existing subjects/i
  );
});

test("startActivityTopUp rejects an empty/invalid onlyTypes list", async () => {
  const db = makeTopUpDb({ subjects: [], activities: [] });
  await assert.rejects(() => startActivityTopUp({ db, familyId: "fam1", curriculumId: "cur1", uid: "u1", onlyTypes: ["not-a-real-type"], addCount: 3 }));
  await assert.rejects(() => startActivityTopUp({ db, familyId: "fam1", curriculumId: "cur1", uid: "u1", onlyTypes: [], addCount: 3 }));
});

// ─── runSyllabusWorker onlyTypes clamp ──────────────────────────────────────

// A scripted fake LLM matching the one used in runtime.test.js: the model
// (mis)returns an off-list type, then finalizes.
function fakeLlm(responses) {
  let i = 0;
  return { async generate() { return responses[Math.min(i++, responses.length - 1)]; } };
}

function makeWorkerDb({ subject, children = [], existingActivities = [] }) {
  const created = [];
  const familyCollections = {
    children: { limit: () => ({ async get() { return snapFromArray(children, "child"); } }) },
    guardians: { limit: () => ({ async get() { return emptySnap(); } }) },
    scores: { limit: () => ({ async get() { return emptySnap(); } }) },
    observations: { limit: () => ({ async get() { return emptySnap(); } }) },
    profile: { doc: () => ({ async get() { return { exists: false, data: () => ({}) }; } }) },
    activities: {
      where(field, _op, value) {
        return { async get() { return snapFromArray(existingActivities.filter((a) => a[field] === value), "existing"); } };
      },
      async add(doc) { created.push(doc); return { id: `new${created.length}` }; },
    },
    curriculum: { doc: () => ({ collection: () => ({ doc: () => ({ async get() { return { exists: true, data: () => subject }; } }) }) }) },
  };
  return {
    created,
    collection(name) {
      if (name === "families") return { doc: () => ({ collection: (sub) => familyCollections[sub] }) };
      if (name === "platform") return { doc: () => ({ async get() { return { exists: false, data: () => ({}) }; } }) };
      return undefined;
    },
  };
}

test("runSyllabusWorker with onlyTypes clamps an off-list type to the requested type, not 'teaching'", async () => {
  const db = makeWorkerDb({ subject: { name: "Mathematics", macroGoals: [] }, children: [{ id: "c1", name: "Zayd" }] });
  const llm = fakeLlm([
    { text: "", functionCalls: [{ name: "create_activity", args: {
      title: "Off-list activity", type: "quran", complexityRank: 1, parentInstructions: "Do the thing.",
    } }] },
    { text: "done", functionCalls: [] },
  ]);

  const result = await runSyllabusWorker({
    db, familyId: "fam1", curriculumId: "cur1", subjectId: "subj0", uid: "u1",
    llm, genConfig: {}, contentLlm: null, contentGenConfig: null,
    targetActivitiesPerSubject: 1, batchActivities: 1,
    onlyTypes: ["mathematics"],
  });

  assert.equal(result.activitiesCreated.length, 1);
  assert.equal(db.created[0].type, "mathematics");
  assert.notEqual(db.created[0].type, "teaching");
});

test("runSyllabusWorker without onlyTypes still falls back to 'teaching' for an unrecognised type", async () => {
  const db = makeWorkerDb({ subject: { name: "Mathematics", macroGoals: [] }, children: [{ id: "c1", name: "Zayd" }] });
  const llm = fakeLlm([
    { text: "", functionCalls: [{ name: "create_activity", args: {
      title: "Bogus type", type: "not-a-real-type", complexityRank: 1, parentInstructions: "Do the thing.",
    } }] },
    { text: "done", functionCalls: [] },
  ]);

  await runSyllabusWorker({
    db, familyId: "fam1", curriculumId: "cur1", subjectId: "subj0", uid: "u1",
    llm, genConfig: {}, contentLlm: null, contentGenConfig: null,
    targetActivitiesPerSubject: 1, batchActivities: 1,
  });

  assert.equal(db.created[0].type, "teaching");
});
