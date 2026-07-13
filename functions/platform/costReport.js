// Superadmin cost reporting (Phase B). Reads the rollup + event docs written by
// lib/costMeter.js and shapes them for the Platform "Costs" screen:
//   • getCostOverview     — platform totals, a trailing-months trend, and a
//                           per-family table for a chosen month.
//   • getFamilyCostDetail — one family's monthly rollup, daily series, and a
//                           paginated feed of raw per-call events (the deep log).
//
// All callables require platformRole === 'superadmin'.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldPath } from "firebase-admin/firestore";
import { familyPaths, platformCostRollups } from "../lib/paths.js";

function requireSuperAdmin(request) {
  if (request.auth?.token?.platformRole !== "superadmin") {
    throw new HttpsError("permission-denied", "Superadmin only.");
  }
  return request.auth.uid;
}

// ─── Pure helpers (unit-tested) ────────────────────────────────────────────────
// Trailing N month keys (YYYY-MM), oldest→newest, ending at `now`.
export function trailingMonths(now = new Date(), n = 6) {
  const out = [];
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

// Default month key (current UTC month).
export function currentMonth(now = new Date()) {
  return now.toISOString().slice(0, 7);
}

// Turn a platform rollup's byFamily map into a sorted table, joining display names.
export function buildFamilyTable(byFamily = {}, nameById = {}) {
  return Object.entries(byFamily)
    .map(([familyId, v]) => ({
      familyId,
      name: nameById[familyId] || "(unknown)",
      costUsd: Number(v?.costUsd) || 0,
      calls: Number(v?.calls) || 0,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);
}

// Strip Firestore increment internals → plain numbers; pass through breakdown maps.
function plainRollup(data = {}) {
  return {
    costUsd: Number(data.costUsd) || 0,
    calls: Number(data.calls) || 0,
    byKind: data.byKind || {},
    byAgent: data.byAgent || {},
    byModel: data.byModel || {},
  };
}

// ─── getCostOverview ───────────────────────────────────────────────────────────
export const getCostOverview = onCall(async (request) => {
  requireSuperAdmin(request);
  const db = getFirestore();
  const now = new Date();
  const month = String(request.data?.month || currentMonth(now)).slice(0, 7);
  const months = trailingMonths(now, 6);

  // Trend: read the trailing-month platform rollups (+ the selected month if older).
  const wanted = Array.from(new Set([...months, month]));
  const platSnaps = await Promise.all(wanted.map((mk) => platformCostRollups(db).doc(mk).get()));
  const platByMonth = {};
  platSnaps.forEach((s, i) => { platByMonth[wanted[i]] = s.exists ? s.data() : null; });

  const trend = months.map((mk) => ({
    period: mk,
    costUsd: Number(platByMonth[mk]?.costUsd) || 0,
    calls: Number(platByMonth[mk]?.calls) || 0,
  }));

  // Family names (one cheap read of the families collection).
  const famSnap = await db.collection("families").get();
  const nameById = {};
  famSnap.docs.forEach((d) => { nameById[d.id] = d.data().name || "(unnamed)"; });

  const selected = platByMonth[month];
  const families = buildFamilyTable(selected?.byFamily, nameById);

  return {
    month,
    months,
    trend,
    selected: selected ? plainRollup(selected) : { costUsd: 0, calls: 0, byKind: {}, byAgent: {}, byModel: {} },
    families,
  };
});

// ─── getFamilyCostDetail ───────────────────────────────────────────────────────
// data: { familyId, month?, beforeTs? (ms cursor), limit? }
export const getFamilyCostDetail = onCall(async (request) => {
  requireSuperAdmin(request);
  const db = getFirestore();
  const familyId = String(request.data?.familyId || "").trim();
  if (!familyId) throw new HttpsError("invalid-argument", "familyId is required.");
  const month = String(request.data?.month || currentMonth()).slice(0, 7);
  const limit = Math.min(100, Math.max(5, Number(request.data?.limit) || 25));
  const beforeTs = Number(request.data?.beforeTs) || 0;

  const fp = familyPaths(db, familyId);

  // Monthly rollup + daily series. The daily docs use YYYY-MM-DD ids, so a
  // documentId() range pulls exactly this month's days with no composite index —
  // and the "YYYY-MM" monthly doc sorts before "YYYY-MM-01", so it's excluded.
  const [monthSnap, dailySnap] = await Promise.all([
    fp.costRollups().doc(month).get(),
    fp.costRollups()
      .orderBy(FieldPath.documentId())
      .startAt(`${month}-01`)
      .endAt(`${month}-31`)
      .get(),
  ]);

  const daily = dailySnap.docs.map((d) => ({
    period: d.data().period,
    costUsd: Number(d.data().costUsd) || 0,
    calls: Number(d.data().calls) || 0,
  }));

  // Paginated raw events, newest first. `beforeTs` is the cursor (events strictly
  // older than it), enabling "load more".
  let q = fp.costEvents().orderBy("ts", "desc").limit(limit);
  if (beforeTs) q = fp.costEvents().where("ts", "<", new Date(beforeTs)).orderBy("ts", "desc").limit(limit);
  const evSnap = await q.get();
  const events = evSnap.docs.map((d) => {
    const e = d.data();
    return {
      id: d.id,
      ts: e.ts?.toMillis?.() ?? null,
      kind: e.kind,
      agentKey: e.agentKey,
      source: e.source,
      model: e.model,
      costUsd: Number(e.costUsd) || 0,
      cached: Boolean(e.cached),
      usage: e.usage || {},
      uid: e.uid || null,
      activityId: e.activityId || null,
    };
  });
  const nextCursor = events.length === limit ? events[events.length - 1].ts : null;

  return {
    familyId,
    month,
    monthly: monthSnap.exists ? plainRollup(monthSnap.data()) : { costUsd: 0, calls: 0, byKind: {}, byAgent: {}, byModel: {} },
    daily,
    events,
    nextCursor,
  };
});
