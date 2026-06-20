import { test } from "node:test";
import assert from "node:assert/strict";
import { withinLimit, dayKey, enforceDailyLimit } from "../lib/rateLimit.js";

test("withinLimit gates at the cap", () => {
  assert.equal(withinLimit(0, 3), true);
  assert.equal(withinLimit(2, 3), true);
  assert.equal(withinLimit(3, 3), false);
  assert.equal(withinLimit(9, 3), false);
});

test("dayKey is a UTC YYYY-MM-DD bucket", () => {
  assert.equal(dayKey(new Date("2026-06-19T23:59:00Z")), "2026-06-19");
});

// Chainable ref stub: collection().doc().collection().doc() → ref.
function refChain(store) {
  const node = { _store: store, collection: () => ({ doc: () => node }) };
  return { doc: () => node };
}

// Fake db whose transaction increments an in-memory counter.
function makeDb(initial = {}) {
  const store = { ...initial };
  return {
    store,
    collection() { return refChain(store); },
    async runTransaction(fn) {
      const ref = { _store: store };
      const tx = {
        async get() { return { exists: true, data: () => store }; },
        set(_ref, patch) { Object.assign(store, patch); },
      };
      return fn(tx, ref);
    },
  };
}

test("enforceDailyLimit allows up to the cap then throws resource-exhausted", async () => {
  const now = new Date("2026-06-19T10:00:00Z");
  const db = makeDb();
  // cap of 2: first two pass, third throws.
  await enforceDailyLimit(db, "fam1", "syllabus", 2, now);
  await enforceDailyLimit(db, "fam1", "syllabus", 2, now);
  await assert.rejects(
    () => enforceDailyLimit(db, "fam1", "syllabus", 2, now),
    /Daily limit reached/
  );
});

test("enforceDailyLimit fails open when the ledger is unreadable", async () => {
  const node = { collection: () => ({ doc: () => node }) };
  const db = {
    collection() { return { doc: () => node }; },
    async runTransaction() { throw new Error("firestore down"); },
  };
  // Must NOT throw — the cap is a safety net, not auth.
  await enforceDailyLimit(db, "fam1", "syllabus", 1);
});
