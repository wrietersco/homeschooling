// Scheduled housekeeping (audit #6, #15). One low-frequency worker that:
//   1. Reaps stale "running" queue claims (syllabus + content backfill) so a run
//      interrupted mid-batch — e.g. by a deploy/eviction that skipped graceful
//      drain — resumes instead of stalling forever (no reaper existed before).
//   2. Deletes expired player tokens (8h TTL) so the collection can't grow without
//      bound and expired capability links stop being readable.
//   3. Reconciles agent-index counts against ground truth to correct drift from
//      at-least-once trigger delivery.
//
// All steps are best-effort and independent: a failure in one never blocks the
// others. maxInstances:1 so passes never overlap.
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore } from "firebase-admin/firestore";
import { reconcileFamilyIndex } from "../agents/agentIndex.js";

const STALE_CLAIM_MS = 12 * 60 * 1000; // a "running" claim older than this is stale
const QUEUE_COLLECTIONS = ["syllabusQueue", "contentBackfillQueue"];
const TOKEN_DELETE_LIMIT = 300;        // bound deletes per pass
const RECONCILE_FAMILY_LIMIT = 25;     // bound index reconciliation per pass

// 1. Requeue queue rows stuck in "running" past the staleness threshold.
export async function reapStaleQueueClaims(db, nowMs = Date.now()) {
  let requeued = 0;
  for (const coll of QUEUE_COLLECTIONS) {
    try {
      const snap = await db.collection(coll).where("status", "==", "running").get();
      for (const d of snap.docs) {
        const claimedAt = d.data().claimedAt;
        const claimedMs = claimedAt?.toMillis ? claimedAt.toMillis() : (claimedAt instanceof Date ? claimedAt.getTime() : 0);
        // No claimedAt, or claimed long ago → assume the worker died mid-batch.
        if (!claimedMs || nowMs - claimedMs > STALE_CLAIM_MS) {
          await d.ref.set({ status: "queued", reapedAt: new Date(), updatedAt: new Date() }, { merge: true });
          requeued += 1;
        }
      }
    } catch (e) {
      console.warn(`[maintenance] reap ${coll} failed: ${e?.message || e}`);
    }
  }
  return { requeued };
}

// 2. Delete expired player tokens across all families (collection-group query).
export async function deleteExpiredTokens(db, nowMs = Date.now()) {
  let deleted = 0;
  try {
    const snap = await db
      .collectionGroup("playerTokens")
      .where("expiresAtMs", "<", nowMs)
      .limit(TOKEN_DELETE_LIMIT)
      .get();
    // Batch delete in chunks of 400 (Firestore batch limit is 500).
    const refs = snap.docs.map((d) => d.ref);
    for (let i = 0; i < refs.length; i += 400) {
      const batch = db.batch();
      for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
      await batch.commit();
    }
    deleted = refs.length;
  } catch (e) {
    console.warn(`[maintenance] delete expired tokens failed: ${e?.message || e}`);
  }
  return { deleted };
}

// 3. Reconcile agent-index counts for a bounded set of families.
export async function reconcileIndexes(db, limit = RECONCILE_FAMILY_LIMIT) {
  let families = 0;
  try {
    const snap = await db.collection("families").limit(limit).get();
    for (const d of snap.docs) {
      await reconcileFamilyIndex(db, d.id);
      families += 1;
    }
  } catch (e) {
    console.warn(`[maintenance] reconcile indexes failed: ${e?.message || e}`);
  }
  return { families };
}

export async function runMaintenancePass(db, nowMs = Date.now()) {
  const reaped = await reapStaleQueueClaims(db, nowMs);
  const tokens = await deleteExpiredTokens(db, nowMs);
  const indexes = await reconcileIndexes(db);
  return { reaped, tokens, indexes };
}

export const maintenanceWorker = onSchedule(
  { schedule: "every 30 minutes", timeoutSeconds: 300, maxInstances: 1 },
  async () => {
    const result = await runMaintenancePass(getFirestore());
    console.info("[maintenance]", JSON.stringify(result));
  }
);
