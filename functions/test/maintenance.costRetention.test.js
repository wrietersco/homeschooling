import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteExpiredCostEvents } from "../platform/maintenance.js";

// Fake db that records the collectionGroup query + batched deletes.
function fakeDb(docCount) {
  const calls = { where: null, limit: null, deleted: [], commits: 0 };
  const docs = Array.from({ length: docCount }, (_, i) => ({ ref: { _id: `e${i}` } }));
  const query = {
    where: (field, op, value) => { calls.where = { field, op, value }; return query; },
    limit: (n) => { calls.limit = n; return query; },
    get: async () => ({ docs }),
  };
  return {
    calls,
    collectionGroup: (name) => { calls.group = name; return query; },
    batch: () => ({
      delete: (ref) => calls.deleted.push(ref._id),
      commit: async () => { calls.commits += 1; },
    }),
  };
}

test("deleteExpiredCostEvents queries costEvents with a 90-day cutoff", async () => {
  const db = fakeDb(3);
  const now = Date.UTC(2026, 5, 21); // 2026-06-21
  const res = await deleteExpiredCostEvents(db, now);

  assert.equal(db.calls.group, "costEvents");
  assert.equal(db.calls.where.field, "ts");
  assert.equal(db.calls.where.op, "<");
  // Cutoff is 90 days before now.
  const expectedCutoff = new Date(now - 90 * 24 * 60 * 60 * 1000);
  assert.equal(db.calls.where.value.getTime(), expectedCutoff.getTime());
  assert.equal(res.deleted, 3);
  assert.deepEqual(db.calls.deleted, ["e0", "e1", "e2"]);
});

test("deleteExpiredCostEvents batches deletes in chunks of 400", async () => {
  const db = fakeDb(450);
  const res = await deleteExpiredCostEvents(db, 1_800_000_000_000);
  assert.equal(res.deleted, 450);
  assert.equal(db.calls.commits, 2); // 400 + 50
});

test("deleteExpiredCostEvents is error-safe", async () => {
  const db = { collectionGroup: () => { throw new Error("boom"); } };
  const res = await deleteExpiredCostEvents(db, 0);
  assert.deepEqual(res, { deleted: 0 });
});
