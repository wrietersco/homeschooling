// Lightweight per-family daily usage guardrail (audit #12). Expensive LLM/image
// callables are otherwise callable without bound, so a stuck client retry loop or
// abuse can run up spend. We keep a per-day counter per action at
// families/{id}/meta/usage and reject once the cap is hit.
//
// Counting is transactional so concurrent calls can't both slip past the cap.
// Generous defaults — this is a circuit breaker against runaway loops, not a
// product quota.
import { HttpsError } from "firebase-functions/v2/https";

// UTC day bucket, e.g. "2026-06-19". Passed in for testability.
export function dayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// Pure decision: given the current count and the cap, may this call proceed?
export function withinLimit(current, max) {
  return Number(current || 0) < Number(max);
}

// Default daily caps per action key.
export const DAILY_LIMITS = {
  syllabus: 20,
  backfill: 20,
  scheduler: 40,
  content: 150,
  brief: 60,
};

// Transactionally increment the per-day counter and throw resource-exhausted when
// the cap is exceeded. Best-effort on read errors falls OPEN (never blocks a real
// user because the ledger doc was unreadable) — the cap is a safety net, not auth.
export async function enforceDailyLimit(db, familyId, key, max = DAILY_LIMITS[key] || 50, now = new Date()) {
  const ref = db.collection("families").doc(familyId).collection("meta").doc("usage");
  const field = `${key}_${dayKey(now)}`;
  let allowed;
  try {
    allowed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const cur = snap.exists ? Number(snap.data()?.[field] || 0) : 0;
      if (!withinLimit(cur, max)) return false; // at/over cap — don't increment further
      tx.set(ref, { [field]: cur + 1, updatedAt: new Date() }, { merge: true });
      return true;
    });
  } catch (e) {
    console.warn(`[rateLimit] ledger unavailable for ${familyId}/${key}, allowing: ${e?.message || e}`);
    return; // fail open
  }
  if (!allowed) {
    throw new HttpsError(
      "resource-exhausted",
      `Daily limit reached for this action (${max}/day). Please try again tomorrow.`
    );
  }
}
