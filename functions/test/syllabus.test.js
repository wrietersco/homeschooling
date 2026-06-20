import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTargetChildren, cancelSyllabusRun } from "../agents/syllabus.js";

const CHILDREN = [
  { id: "c1", name: "Abdul Hadi" },
  { id: "c2", name: "Maryam" },
];

test("keeps valid child ids as-is", () => {
  assert.deepEqual(resolveTargetChildren(CHILDREN, ["c2"]), ["c2"]);
});

test("maps child names (the model's usual mistake) back to ids", () => {
  assert.deepEqual(resolveTargetChildren(CHILDREN, ["Maryam"]), ["c2"]);
});

test("resolves 'for X' style phrases by substring", () => {
  assert.deepEqual(resolveTargetChildren(CHILDREN, ["for Abdul Hadi"]), ["c1"]);
});

test("falls back to ALL children when nothing resolves", () => {
  assert.deepEqual(resolveTargetChildren(CHILDREN, ["nobody-real"]), ["c1", "c2"]);
  assert.deepEqual(resolveTargetChildren(CHILDREN, []), ["c1", "c2"]);
  assert.deepEqual(resolveTargetChildren(CHILDREN, undefined), ["c1", "c2"]);
});

test("dedupes and mixes ids + names", () => {
  assert.deepEqual(resolveTargetChildren(CHILDREN, ["c1", "Abdul Hadi", "Maryam"]), ["c1", "c2"]);
});

test("does NOT match a short name inside a larger word (word-boundary fix)", () => {
  const kids = [{ id: "c1", name: "An" }, { id: "c2", name: "Sam" }];
  // "An" must not match inside "planning"; "Sam" must not match inside "Samira".
  assert.deepEqual(resolveTargetChildren(kids, ["the planning activity"]), ["c1", "c2"]); // no real match → all
  assert.deepEqual(resolveTargetChildren(kids, ["for Samira only"]), ["c1", "c2"]);
});

test("matches a whole-word name even amid punctuation", () => {
  const kids = [{ id: "c1", name: "Sara" }, { id: "c2", name: "Bilal" }];
  assert.deepEqual(resolveTargetChildren(kids, ["for Sara, please"]), ["c1"]);
  // "Sarah" (a different, longer word) must NOT match "Sara".
  assert.deepEqual(resolveTargetChildren(kids, ["Sarah"]), ["c1", "c2"]);
});

// Fake db for cancelSyllabusRun: an existing agentRun doc + a queue doc.
function makeStopDb({ runExists = true } = {}) {
  const writes = {};
  function runRef() {
    return {
      async get() { return { exists: runExists, data: () => ({ type: "syllabus", status: "running" }) }; },
      async set(patch, opts) { writes.run = { patch, opts }; },
    };
  }
  return {
    writes,
    collection(name) {
      if (name === "syllabusQueue") return { doc: () => ({ async set(patch, opts) { writes.queue = { patch, opts }; } }) };
      // families/{id}/agentRuns/{runId}
      return { doc: () => ({ collection: () => ({ doc: () => runRef() }) }) };
    },
  };
}

test("cancelSyllabusRun marks the run + queue cancelled (merge)", async () => {
  const db = makeStopDb();
  const res = await cancelSyllabusRun({ db, familyId: "fam1", runId: "run1", uid: "u1" });
  assert.equal(res.status, "cancelled");
  assert.equal(db.writes.run.patch.status, "cancelled");
  assert.equal(db.writes.run.patch.cancelledBy, "u1");
  assert.equal(db.writes.run.opts.merge, true);
  assert.equal(db.writes.queue.patch.status, "cancelled");
});

test("cancelSyllabusRun rejects an unknown run", async () => {
  const db = makeStopDb({ runExists: false });
  await assert.rejects(() => cancelSyllabusRun({ db, familyId: "fam1", runId: "missing", uid: "u1" }));
});
