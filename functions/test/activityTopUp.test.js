import { test } from "node:test";
import assert from "node:assert/strict";
import { startActivityTopUp, runSyllabusWorker, ensureDefaultSubjectDocs, startSyllabusRun, DEFAULT_SUBJECT_NAMES } from "../agents/syllabus.js";

// ─── startActivityTopUp ─────────────────────────────────────────────────────

function emptySnap() { return { empty: true, size: 0, docs: [] }; }
function snapFromArray(arr, idPrefix = "d") {
  return { empty: arr.length === 0, size: arr.length, docs: arr.map((data, i) => ({ id: `${idPrefix}${i}`, data: () => data })) };
}

// Fake db covering exactly what startActivityTopUp (+ the default-subject
// seeding it runs first) touches: curriculum/subjects (with batch set),
// a curriculumId-scoped activities query, and writes to agentRuns + syllabusQueue.
function makeTopUpDb({ subjects, activities }) {
  const runWrites = [];
  const queueWrites = [];
  const seeds = [];
  const curriculumUpdates = [];
  let nextRunId = 0;
  let nextSubId = 0;
  const subRef = {
    doc: () => {
      const id = `seed${++nextSubId}`;
      return { id, set: (patch) => seeds.push({ id, patch }) };
    },
    async get() { return snapFromArray(subjects, "subj"); },
  };
  return {
    runWrites,
    queueWrites,
    seeds,
    curriculumUpdates,
    batch() {
      const ops = [];
      return {
        set: (ref, patch) => ops.push(() => ref.set(patch)),
        update: (ref, patch) => ops.push(() => ref.update(patch)),
        commit: async () => { for (const op of ops) await op(); },
      };
    },
    collection(name) {
      if (name === "families") {
        return {
          doc: () => ({
            collection: (sub) => {
              if (sub === "curriculum") {
                return {
                  doc: () => ({
                    collection: () => subRef,
                    update: (patch) => curriculumUpdates.push(patch),
                  }),
                };
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

test("startActivityTopUp with onlySubjects targets exactly the selected subjectIds (any type)", async () => {
  const subjects = [
    { name: "Mathematics" }, // subj0 — selected
    { name: "Quran" },       // subj1 — not selected
    { name: "Urdu" },        // subj2 — selected, zero existing activities
  ];
  const activities = [
    { subjectId: "subj0", curriculumId: "cur1", type: "mathematics" },
    { subjectId: "subj1", curriculumId: "cur1", type: "quran" },
  ];
  const db = makeTopUpDb({ subjects, activities });

  const res = await startActivityTopUp({
    db, familyId: "fam1", curriculumId: "cur1", uid: "u1", role: "owner",
    onlySubjects: ["subj0", "subj2"], addCount: 2,
  });

  assert.equal(res.totalSubjects, 3);
  assert.equal(res.matchingSubjects, 2);

  const runPatch = db.runWrites[0].patch;
  assert.equal(runPatch.mode, "topup");
  assert.deepEqual(runPatch.onlyTypes, []);
  assert.deepEqual(runPatch.onlySubjects, ["subj0", "subj2"]);

  // subj0 keeps its 1 existing activity → target = 1 + 2.
  assert.equal(runPatch.subjects.subj0.matched, true);
  assert.equal(runPatch.subjects.subj0.status, "pending");
  assert.equal(runPatch.subjects.subj0.targetActivityCount, 3);

  // subj2 has no activities yet — still targeted with target = 0 + 2.
  assert.equal(runPatch.subjects.subj2.matched, true);
  assert.equal(runPatch.subjects.subj2.targetActivityCount, 2);

  // subj1 was not selected → pre-marked done, target unchanged.
  assert.equal(runPatch.subjects.subj1.matched, false);
  assert.equal(runPatch.subjects.subj1.status, "done");
  assert.equal(runPatch.subjects.subj1.targetActivityCount, runPatch.subjects.subj1.activityCount);
});

test("startActivityTopUp throws when none of the onlySubjects exist", async () => {
  const subjects = [{ name: "Quran" }];
  const activities = [{ subjectId: "subj0", curriculumId: "cur1", type: "quran" }];
  const db = makeTopUpDb({ subjects, activities });

  await assert.rejects(
    () => startActivityTopUp({ db, familyId: "fam1", curriculumId: "cur1", uid: "u1", onlySubjects: ["missing-subject"], addCount: 2 }),
    /none of the selected subjects/i
  );
});

test("startActivityTopUp requires either onlyTypes or onlySubjects", async () => {
  const db = makeTopUpDb({ subjects: [], activities: [] });
  await assert.rejects(
    () => startActivityTopUp({ db, familyId: "fam1", curriculumId: "cur1", uid: "u1", addCount: 2 }),
    /onlyTypes or onlySubjects/i
  );
});

test("startActivityTopUp stores clamped parent guidance on the run doc and omits empty guidance", async () => {
  const subjects = [{ name: "Mathematics" }];
  const activities = [{ subjectId: "subj0", curriculumId: "cur1", type: "mathematics" }];

  const db = makeTopUpDb({ subjects, activities });
  await startActivityTopUp({
    db, familyId: "fam1", curriculumId: "cur1", uid: "u1",
    onlySubjects: ["subj0"], addCount: 2, guidance: "  Focus on exam preparation.  ",
  });
  assert.equal(db.runWrites[0].patch.guidance, "Focus on exam preparation.");

  const db2 = makeTopUpDb({ subjects, activities });
  await startActivityTopUp({
    db: db2, familyId: "fam1", curriculumId: "cur1", uid: "u1",
    onlySubjects: ["subj0"], addCount: 2, guidance: "   ",
  });
  assert.equal("guidance" in db2.runWrites[0].patch, false);
});

// ─── Default subject catalog (Geography, Social Studies, History, Politics) ──

// Fake db for ensureDefaultSubjectDocs / startSyllabusRun: subjects subcollection
// with batch-set, a curriculum doc update, activities query, and agentRuns/queue.
function makeSubjectsDb({ subjects, activities }) {
  const sets = [];
  const curriculumUpdates = [];
  const runWrites = [];
  const queueWrites = [];
  let nextId = 0;
  const subRef = {
    doc: () => {
      const id = `new${++nextId}`;
      return { id, set: (patch) => { sets.push({ id, patch }); } };
    },
    async get() { return snapFromArray(subjects, "subj"); },
  };
  return {
    sets, curriculumUpdates, runWrites, queueWrites,
    batch() {
      const ops = [];
      return {
        set: (ref, patch) => ops.push(() => ref.set(patch)),
        update: (ref, patch) => ops.push(() => ref.update(patch)),
        commit: async () => { for (const op of ops) await op(); },
      };
    },
    collection(name) {
      if (name === "families") {
        return {
          doc: () => ({
            collection: (sub) => {
              if (sub === "curriculum") {
                return {
                  doc: () => ({
                    collection: () => subRef,
                    update: (patch) => { curriculumUpdates.push(patch); },
                  }),
                };
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
                    const id = `run${++nextId}`;
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

test("ensureDefaultSubjectDocs seeds the missing default subjects exactly once", async () => {
  const subjects = [{ name: "Mathematics" }, { name: "Science" }]; // subj0, subj1
  const db = makeSubjectsDb({ subjects, activities: [] });

  const first = await ensureDefaultSubjectDocs({ db, familyId: "fam1", curriculumId: "cur1" });
  assert.deepEqual(first.added, DEFAULT_SUBJECT_NAMES);
  assert.equal(db.sets.length, DEFAULT_SUBJECT_NAMES.length);
  for (const s of db.sets) {
    assert.equal(s.patch.default, true);
    assert.ok(DEFAULT_SUBJECT_NAMES.includes(s.patch.name));
    assert.deepEqual(s.patch.macroGoals, []);
  }
  // Keeps the curriculum doc's subjectCount honest (2 existing + 4 seeded).
  assert.equal(db.curriculumUpdates[0].subjectCount, 6);

  // Second run is a no-op: nothing new is written.
  const subjectsAfter = [...subjects, ...db.sets.map((s) => ({ name: s.patch.name }))];
  const db2 = makeSubjectsDb({ subjects: subjectsAfter, activities: [] });
  const second = await ensureDefaultSubjectDocs({ db: db2, familyId: "fam1", curriculumId: "cur1" });
  assert.deepEqual(second.added, []);
  assert.equal(db2.sets.length, 0);
});

test("ensureDefaultSubjectDocs matches names case-insensitively", async () => {
  const subjects = [{ name: "geography" }];
  const db = makeSubjectsDb({ subjects, activities: [] });
  const res = await ensureDefaultSubjectDocs({ db, familyId: "fam1", curriculumId: "cur1" });
  assert.deepEqual(res.added, DEFAULT_SUBJECT_NAMES.filter((n) => n !== "Geography"));
});

test("startSyllabusRun marks never-generated defaults dormant so a full build skips them", async () => {
  const subjects = [
    { name: "Mathematics" },                        // subj0 — real subject
    { name: "Geography", default: true },           // subj1 — seeded, never generated
    { name: "History", default: true },             // subj2 — seeded, but parent already generated for it
  ];
  const activities = [
    { subjectId: "subj0", curriculumId: "cur1" },
    { subjectId: "subj2", curriculumId: "cur1" },
  ];
  const db = makeSubjectsDb({ subjects, activities });

  const res = await startSyllabusRun({ db, familyId: "fam1", curriculumId: "cur1", uid: "u1", role: "owner", targetActivitiesPerSubject: 5 });

  const runPatch = db.runWrites[0].patch;
  // subj1 (dormant) is skipped: pre-marked done, unmatched, and excluded from targets.
  assert.equal(runPatch.subjects.subj1.status, "done");
  assert.equal(runPatch.subjects.subj1.matched, false);
  // subj2 (default but activated) and subj0 are pending.
  assert.equal(runPatch.subjects.subj0.status, "pending");
  assert.equal(runPatch.subjects.subj2.status, "pending");
  // Progress totals count only active subjects (2 active; 1 dormant pre-completed).
  assert.equal(res.totalSubjects, runPatch.totalSubjects);
  assert.equal(runPatch.totalSubjects, 2);
  assert.equal(runPatch.completedSubjects, 1);
  assert.equal(runPatch.targetTotalActivities, 10);
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
      doc() { const id = `new${created.length + 1}`; return { id, path: `families/fam1/activities/${id}`, async set(doc) { created.push(doc); } }; },
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

test("runSyllabusWorker includes parent guidance in the worker system prompt", async () => {
  const db = makeWorkerDb({ subject: { name: "Mathematics", macroGoals: [] }, children: [{ id: "c1", name: "Zayd" }] });
  let captured = null;
  let call = 0;
  const llm = {
    async generate(args) {
      if (call++ === 0) captured = args;
      return call === 1
        ? { text: "", functionCalls: [{ name: "create_activity", args: {
            title: "Guided activity", type: "teaching", complexityRank: 1, parentInstructions: "Do the thing.",
          } }] }
        : { text: "done", functionCalls: [] };
    },
  };

  await runSyllabusWorker({
    db, familyId: "fam1", curriculumId: "cur1", subjectId: "subj0", uid: "u1",
    llm, genConfig: {}, contentLlm: null, contentGenConfig: null,
    targetActivitiesPerSubject: 1, batchActivities: 1,
    guidance: "Focus on exam preparation and real-world examples.",
  });

  assert.ok(captured, "worker LLM was never called");
  assert.ok(captured.system.includes("PARENT'S INSTRUCTIONS FOR THIS BATCH"));
  assert.ok(captured.system.includes("Focus on exam preparation and real-world examples."));
});

test("runSyllabusWorker omits the guidance block when no guidance is given", async () => {
  const db = makeWorkerDb({ subject: { name: "Mathematics", macroGoals: [] }, children: [{ id: "c1", name: "Zayd" }] });
  let captured = null;
  let call = 0;
  const llm = {
    async generate(args) {
      if (call++ === 0) captured = args;
      return call === 1
        ? { text: "", functionCalls: [{ name: "create_activity", args: {
            title: "Plain activity", type: "teaching", complexityRank: 1, parentInstructions: "Do the thing.",
          } }] }
        : { text: "done", functionCalls: [] };
    },
  };

  await runSyllabusWorker({
    db, familyId: "fam1", curriculumId: "cur1", subjectId: "subj0", uid: "u1",
    llm, genConfig: {}, contentLlm: null, contentGenConfig: null,
    targetActivitiesPerSubject: 1, batchActivities: 1,
  });

  assert.ok(captured, "worker LLM was never called");
  assert.equal(captured.system.includes("PARENT'S INSTRUCTIONS FOR THIS BATCH"), false);
});

test("package budget spreads ready activities across subjects without exceeding targets", async () => {
  const { allocateActivityBudget } = await import("../agents/syllabus.js");
  const subjects = { maths: { targetActivityCount: 48 }, reading: { targetActivityCount: 48 }, dormant: { targetActivityCount: 48, matched: false } };
  assert.deepEqual(allocateActivityBudget(subjects, {}, 10), { maths: 5, reading: 5, dormant: 0 });
  assert.deepEqual(allocateActivityBudget(subjects, { maths: 47 }, 10), { maths: 1, reading: 9, dormant: 0 });
  assert.deepEqual(allocateActivityBudget(subjects, { maths: 48, reading: 48 }, 80), { maths: 0, reading: 0, dormant: 0 });
});
