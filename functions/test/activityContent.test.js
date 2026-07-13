import { test } from "node:test";
import assert from "node:assert/strict";
import { contentKindForType, cancelContentBackfill, isContentEmpty, enqueueContentBackfill } from "../agents/activityContent.js";

// Fake db capturing the two doc writes cancelContentBackfill performs.
function makeCancelDb() {
  const writes = {};
  function docRef(label) {
    return { async set(patch, opts) { writes[label] = { patch, opts }; } };
  }
  return {
    writes,
    collection(name) {
      if (name === "contentBackfillQueue") return { doc: () => docRef("queue") };
      // families/{id}/meta/contentBackfill
      return { doc: () => ({ collection: () => ({ doc: () => docRef("meta") }) }) };
    },
  };
}

test("cancelContentBackfill marks both the queue row and the progress mirror cancelled", async () => {
  const db = makeCancelDb();
  const res = await cancelContentBackfill({ db, familyId: "fam1", uid: "u1" });
  assert.equal(res.status, "cancelled");
  assert.equal(db.writes.queue.patch.status, "cancelled");
  assert.equal(db.writes.queue.patch.cancelledBy, "u1");
  assert.equal(db.writes.meta.patch.status, "cancelled");
  // Both writes must merge so they don't clobber sibling fields.
  assert.equal(db.writes.queue.opts.merge, true);
  assert.equal(db.writes.meta.opts.merge, true);
});

// Fake db for enqueueContentBackfill: serves an activity list and captures the
// queue + meta writes. Activities given as [{type, content}].
function makeEnqueueDb(activities) {
  const writes = {};
  const docs = activities.map((a, i) => ({ id: `a${i}`, data: () => a }));
  const activitiesCol = { limit: () => ({ async get() { return { docs }; } }) };
  function metaDoc() { return { async set(patch, opts) { writes.meta = { patch, opts }; } }; }
  function queueDoc() { return { async set(patch, opts) { writes.queue = { patch, opts }; } }; }
  return {
    writes,
    collection(name) {
      if (name === "contentBackfillQueue") return { doc: () => queueDoc() };
      // families/{id} → .collection("activities") | .collection("meta").doc("contentBackfill")
      return {
        doc: () => ({
          collection: (sub) => (sub === "activities"
            ? activitiesCol
            : { doc: () => metaDoc() }),
        }),
      };
    },
  };
}

test("enqueueContentBackfill (force + types) counts only matching types and records the filter", async () => {
  const db = makeEnqueueDb([
    { type: "teaching", content: { kind: "tips" } },
    { type: "teaching", content: { kind: "tips" } },
    { type: "quran", content: { kind: "quran_reading" } },
    { type: "mathematics", content: null },
  ]);
  const res = await enqueueContentBackfill({ db, familyId: "fam1", uid: "u1", force: true, types: ["teaching"] });
  // Force mode counts ALL matching activities (overwrite), regardless of content.
  assert.equal(res.total, 2);
  assert.equal(res.mode, "regenerate");
  assert.equal(res.status, "queued");
  assert.deepEqual(db.writes.queue.patch.types, ["teaching"]);
  assert.equal(db.writes.queue.patch.force, true);
  assert.match(db.writes.queue.patch.forceToken, /^r\d+/);
  assert.equal(db.writes.meta.patch.mode, "regenerate");
  assert.equal(db.writes.meta.patch.total, 2);
});

test("enqueueContentBackfill (no filter, fill mode) counts only activities missing content", async () => {
  const db = makeEnqueueDb([
    { type: "teaching", content: { kind: "tips" } }, // has content → skipped in fill mode
    { type: "mathematics", content: null },          // missing → counted
    { type: "quran", content: null },                // missing → counted
  ]);
  const res = await enqueueContentBackfill({ db, familyId: "fam1", uid: "u1" });
  assert.equal(res.total, 2);
  assert.equal(res.mode, "fill");
  assert.deepEqual(db.writes.queue.patch.types, []);
  assert.equal(db.writes.queue.patch.forceToken, "");
});

test("quran_reading is reachable ONLY from type 'quran'", () => {
  assert.equal(contentKindForType("quran"), "quran_reading");
  // No other type may ever produce Quran verses.
  for (const t of ["arabic_reading", "urdu_reading", "english_reading", "noorani_qaida",
    "mathematics", "computer", "ai_robotics", "physical", "teaching", "story_reading", "anything"]) {
    assert.notEqual(contentKindForType(t), "quran_reading", `${t} must not map to quran_reading`);
  }
});

test("reading types map to the language-aware reading kind", () => {
  assert.equal(contentKindForType("arabic_reading"), "reading");
  assert.equal(contentKindForType("urdu_reading"), "reading");
});

test("english/legacy reading map to story; math to problems", () => {
  assert.equal(contentKindForType("english_reading"), "story");
  assert.equal(contentKindForType("story_reading"), "story"); // legacy alias
  assert.equal(contentKindForType("mathematics"), "problems");
});

test("conversation maps to the playable dialogue kind", () => {
  assert.equal(contentKindForType("conversation"), "dialogue");
  // and it must never be confused with Quran recitation
  assert.notEqual(contentKindForType("conversation"), "quran_reading");
});

test("isContentEmpty rejects a hollow forced-call payload but accepts a filled one", () => {
  // null / wrong-shape always empty
  assert.equal(isContentEmpty(null), true);
  // a forced save_content that produced only the shell, per kind
  assert.equal(isContentEmpty({ kind: "reading", story: { paragraphs: [] } }), true);
  assert.equal(isContentEmpty({ kind: "qaida_exercise", exercises: [] }), true);
  assert.equal(isContentEmpty({ kind: "quran_reading", quran: { verses: [] } }), true);
  assert.equal(isContentEmpty({ kind: "dialogue", dialogue: { turns: [] } }), true);
  assert.equal(isContentEmpty({ kind: "problems", problems: [] }), true);
  assert.equal(isContentEmpty({ kind: "steps", worksheet: { steps: [] } }), true);
  // tips: empty when it has neither facilitation tips nor an embedded story
  assert.equal(isContentEmpty({ kind: "tips", tips: { tips: [] } }), true);
  // real content passes
  assert.equal(isContentEmpty({ kind: "reading", story: { paragraphs: ["abc"] } }), false);
  assert.equal(isContentEmpty({ kind: "qaida_exercise", exercises: [{ items: [{ text: "ا" }] }] }), false);
  // tips is valid with facilitation tips, OR with just an embedded ready-to-use story
  assert.equal(isContentEmpty({ kind: "tips", tips: { tips: ["read slowly"] } }), false);
  assert.equal(isContentEmpty({ kind: "tips", tips: { story: { paragraphs: ["A story."] } } }), false);
});

test("procedural types get steps; parent-led + unknown fall back to tips", () => {
  assert.equal(contentKindForType("computer"), "steps");
  assert.equal(contentKindForType("physical"), "steps");
  assert.equal(contentKindForType("teaching"), "tips");
  assert.equal(contentKindForType("something_new"), "tips");
  assert.equal(contentKindForType(undefined), "tips");
});
