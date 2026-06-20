import { test } from "node:test";
import assert from "node:assert/strict";
import { reapStaleQueueClaims, deleteExpiredTokens } from "../platform/maintenance.js";

// ── Minimal Firestore fake for the queue-reaper path ──────────────────────────
function makeQueueDb(rows) {
  const writes = {};
  return {
    writes,
    collection(name) {
      return {
        where(field, _op, val) {
          return {
            async get() {
              const docs = (rows[name] || [])
                .filter((r) => r[field] === val)
                .map((r) => ({
                  data: () => r,
                  ref: {
                    async set(patch) {
                      (writes[name] ||= []).push(patch);
                      Object.assign(r, patch);
                    },
                  },
                }));
              return { docs };
            },
          };
        },
      };
    },
  };
}

test("reapStaleQueueClaims requeues only stale running claims", async () => {
  const now = 10_000_000;
  const db = makeQueueDb({
    syllabusQueue: [
      { runId: "fresh", status: "running", claimedAt: { toMillis: () => now - 60_000 } },   // 1 min — fresh
      { runId: "stale", status: "running", claimedAt: { toMillis: () => now - 20 * 60_000 } }, // 20 min — stale
      { runId: "noclaim", status: "running" },                                                 // no claimedAt — stale
    ],
    contentBackfillQueue: [],
  });

  const result = await reapStaleQueueClaims(db, now);
  assert.equal(result.requeued, 2);
  const requeuedStatuses = db.writes.syllabusQueue.map((w) => w.status);
  assert.deepEqual(requeuedStatuses, ["queued", "queued"]);
});

// ── Minimal Firestore fake for the token-cleanup path ─────────────────────────
function makeTokenDb(tokens) {
  let committed = 0;
  const deleted = [];
  return {
    _deleted: deleted,
    _commits: () => committed,
    collectionGroup() {
      return {
        where(field, op, val) {
          return {
            limit() {
              return {
                async get() {
                  const docs = tokens
                    .filter((t) => (op === "<" ? t[field] < val : true))
                    .map((t) => ({ ref: { id: t.id } }));
                  return { docs };
                },
              };
            },
          };
        },
      };
    },
    batch() {
      return {
        delete(ref) { deleted.push(ref.id); },
        async commit() { committed += 1; },
      };
    },
  };
}

test("deleteExpiredTokens removes only past-expiry tokens", async () => {
  const now = 5000;
  const db = makeTokenDb([
    { id: "expired1", expiresAtMs: 1000 },
    { id: "expired2", expiresAtMs: 4999 },
    { id: "live", expiresAtMs: 9999 },
  ]);
  const result = await deleteExpiredTokens(db, now);
  assert.equal(result.deleted, 2);
  assert.deepEqual(db._deleted.sort(), ["expired1", "expired2"]);
});
