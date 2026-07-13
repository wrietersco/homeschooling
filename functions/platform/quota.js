// Multi-tenant TTS quota allocation.
//
// The whole platform shares ONE Gemini project, so RPD (requests/day) is a single
// pool that families + platform jobs all draw from (per-project, resets midnight
// Pacific). Without budgets, one tenant or the Qaida job starves everyone. So we
// carve each scarce model's daily pool into a PLATFORM RESERVE (for platform-wide
// jobs like Qaida/Quran audio) plus a FAMILIES POOL split by weight.
//
// Scope (per the product decision): budget TTS models only — they're the only
// genuinely scarce quota (100 & 50 RPD on Tier 1). Everything else is unbudgeted.
// Enforcement is fail-open: a ledger read error never blocks a real user.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { enforceDailyLimit, dayKey } from "../lib/rateLimit.js";

// Seeded from the project's AI Studio "Rate Limit" page (Tier 1). Superadmin-editable.
export const DEFAULT_QUOTA = {
  models: {
    "gemini-2.5-flash-preview-tts": { rpd: 100 },
    "gemini-2.5-pro-preview-tts": { rpd: 50 },
  },
  platformReservePct: 30,   // % of each model's RPD reserved for platform jobs
  familyWeights: {},        // { familyId: weight } — absent ⇒ equal share
};

const clampPct = (n) => Math.max(0, Math.min(100, Number(n) || 0));

// ─── Pure allocation (unit-tested) ──────────────────────────────────────────────
// platform reserve for one model.
export function platformBudget(rpd, reservePct) {
  return Math.floor((Number(rpd) || 0) * clampPct(reservePct) / 100);
}
// one family's daily budget for one model, from the families pool split by weight.
export function familyBudget(rpd, reservePct, familyId, familyIds, weights = {}) {
  const pool = (Number(rpd) || 0) - platformBudget(rpd, reservePct);
  const ids = familyIds.length ? familyIds : [familyId];
  const w = (f) => Math.max(0, Number(weights[f] ?? 1));
  const total = ids.reduce((s, f) => s + w(f), 0);
  if (total <= 0) return 0;
  return Math.floor(pool * w(familyId) / total);
}

// Full allocation table for a config + family set. Returns { platform:{model:n},
// families:{familyId:{model:n}} }.
export function allocate(config, familyIds) {
  const cfg = { ...DEFAULT_QUOTA, ...config, models: { ...DEFAULT_QUOTA.models, ...(config?.models || {}) } };
  const platform = {}, families = {};
  for (const id of familyIds) families[id] = {};
  for (const [model, m] of Object.entries(cfg.models)) {
    platform[model] = platformBudget(m.rpd, cfg.platformReservePct);
    for (const id of familyIds) families[id][model] = familyBudget(m.rpd, cfg.platformReservePct, id, familyIds, cfg.familyWeights);
  }
  return { platform, families };
}

// ─── Config + family-set loading (cached) ───────────────────────────────────────
let _cache = null, _cacheAt = 0;
const TTL_MS = 5 * 60 * 1000;

export function _resetQuotaCache() { _cache = null; _cacheAt = 0; }

export async function loadQuotaConfig(db) {
  const snap = await db.collection("platform").doc("quota").get().catch(() => null);
  const stored = snap?.exists ? snap.data() : {};
  return {
    models: { ...DEFAULT_QUOTA.models, ...(stored?.models || {}) },
    platformReservePct: stored?.platformReservePct ?? DEFAULT_QUOTA.platformReservePct,
    familyWeights: stored?.familyWeights || {},
  };
}

// Cached config + family ids + computed allocation (recomputed every TTL).
async function loadAllocation(db, nowMs = Date.now()) {
  if (_cache && nowMs - _cacheAt < TTL_MS) return _cache;
  const [config, famSnap] = await Promise.all([
    loadQuotaConfig(db),
    db.collection("families").select().get().catch(() => ({ docs: [] })),
  ]);
  const familyIds = famSnap.docs.map((d) => d.id);
  _cache = { config, familyIds, alloc: allocate(config, familyIds) };
  _cacheAt = nowMs;
  return _cache;
}

// ─── Enforcement ────────────────────────────────────────────────────────────────
// Family TTS: transactional per-family/day counter capped at the family's budget
// for `model`. Throws resource-exhausted when over; fails OPEN on ledger errors.
// No-op for models that aren't budgeted.
export async function enforceFamilyTtsQuota(db, familyId, model) {
  if (!familyId || !model) return;
  let cap;
  try {
    const { config, familyIds, alloc } = await loadAllocation(db);
    if (!config.models[model]) return; // unbudgeted model
    cap = alloc.families[familyId]?.[model];
    if (cap == null) cap = familyBudget(config.models[model].rpd, config.platformReservePct, familyId, familyIds.length ? familyIds : [familyId], config.familyWeights);
  } catch (e) {
    console.warn(`[quota] family alloc unavailable, allowing: ${e?.message || e}`);
    return; // fail open
  }
  await enforceDailyLimit(db, familyId, `tts:${model}`, Math.max(0, cap));
}

// Platform reserve: how many MORE platform TTS requests are allowed today for
// `model`, given what platform jobs have already used. Reads the platform usage
// counter the TTS worker writes. Returns a non-negative integer (0 ⇒ reserve spent).
export async function platformTtsRemaining(db, model, now = new Date()) {
  try {
    const { config } = await loadAllocation(db);
    const m = config.models[model];
    if (!m) return Infinity; // unbudgeted ⇒ no platform cap
    const budget = platformBudget(m.rpd, config.platformReservePct);
    const usageSnap = await db.collection("platform").doc("usage").collection("daily").doc(dayKey(now)).get();
    const used = usageSnap.exists ? Number(usageSnap.data()?.byModel?.[model]?.requests || usageSnap.data()?.tts?.requests || 0) : 0;
    return Math.max(0, budget - used);
  } catch (e) {
    console.warn(`[quota] platform remaining unavailable, allowing: ${e?.message || e}`);
    return Infinity; // fail open
  }
}

// ─── Superadmin config callables ────────────────────────────────────────────────
function requireSuperAdmin(request) {
  if (request.auth?.token?.platformRole !== "superadmin") throw new HttpsError("permission-denied", "Superadmin only.");
}

export const getQuotaConfig = onCall(async (request) => {
  requireSuperAdmin(request);
  const db = getFirestore();
  _resetQuotaCache();
  const config = await loadQuotaConfig(db);
  const famSnap = await db.collection("families").get();
  const familyIds = famSnap.docs.map((d) => d.id);
  const names = {}; famSnap.docs.forEach((d) => { names[d.id] = d.data().name || "(unnamed)"; });
  const alloc = allocate(config, familyIds);

  // Today's TTS usage per family + platform, so the UI shows budget vs used.
  const today = dayKey();
  const [usageSnaps, platUsageSnap] = await Promise.all([
    Promise.all(familyIds.map((id) => db.collection("families").doc(id).collection("meta").doc("usage").get())),
    db.collection("platform").doc("usage").collection("daily").doc(today).get(),
  ]);
  const primary = Object.keys(config.models)[0]; // the model the app actually uses (flash-tts)
  const familiesUsed = {};
  familyIds.forEach((id, i) => {
    const d = usageSnaps[i].exists ? usageSnaps[i].data() : {};
    familiesUsed[id] = Number(d[`tts:${primary}_${today}`] || 0);
  });
  const platformUsed = platUsageSnap.exists ? Number(platUsageSnap.data()?.tts?.requests || 0) : 0;

  return { config, familyIds, names, alloc, primaryModel: primary, familiesUsed, platformUsed, today };
});

export const setQuotaConfig = onCall(async (request) => {
  requireSuperAdmin(request);
  const db = getFirestore();
  const data = request.data || {};
  const update = { updatedAt: new Date() };
  if (data.models && typeof data.models === "object") {
    update.models = {};
    for (const [model, m] of Object.entries(data.models)) {
      const rpd = Math.max(0, Math.floor(Number(m?.rpd) || 0));
      if (rpd > 0) update.models[model] = { rpd };
    }
  }
  if (data.platformReservePct != null) update.platformReservePct = clampPct(data.platformReservePct);
  if (data.familyWeights && typeof data.familyWeights === "object") {
    update.familyWeights = {};
    for (const [fid, w] of Object.entries(data.familyWeights)) update.familyWeights[fid] = Math.max(0, Number(w) || 0);
  }
  await db.collection("platform").doc("quota").set(update, { merge: true });
  _resetQuotaCache();
  return { ok: true };
});
