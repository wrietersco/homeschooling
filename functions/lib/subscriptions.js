import { HttpsError } from "firebase-functions/v2/https";

export const PLAN_IDS = ["trial", "basic", "premium"];
export const DEFAULT_PLANS = {
  trial: { name: "One-day trial", price: 1500, durationDays: 1, currency: "PKR", limits: { text: 25, image: 5, tts: 15, liveMinutes: 10 }, daily: { text: 25, image: 5, tts: 15, liveMinutes: 10 }, sessionMinutes: 5, maxOutputTokens: 8192, thinkingBudget: 512 },
  basic: { name: "Basic", price: 4500, durationDays: 30, currency: "PKR", limits: { text: 500, image: 50, tts: 200, liveMinutes: 90 }, daily: { text: 40, image: 10, tts: 20, liveMinutes: 30 }, sessionMinutes: 10, maxOutputTokens: 8192, thinkingBudget: 1024 },
  premium: { name: "Premium", price: 15000, durationDays: 30, currency: "PKR", limits: { text: 1200, image: 120, tts: 500, liveMinutes: 240 }, daily: { text: 80, image: 20, tts: 40, liveMinutes: 60 }, sessionMinutes: 15, maxOutputTokens: 16384, thinkingBudget: 2048 },
};
export const subscriptionRef = (db, familyId) => db.collection("families").doc(familyId).collection("billing").doc("subscription");
export const plansRef = (db) => db.collection("platform").doc("plans");
export const usageRef = (db, familyId, month) => db.collection("families").doc(familyId).collection("planUsage").doc(month);
const stamp = (v) => v?.toMillis?.() ?? (v instanceof Date ? v.getTime() : Number(v));

export function subscriptionState(sub, nowMs = Date.now()) {
  if (!sub) return "pending";
  if (sub.status !== "active") return sub.status || "pending";
  if (!Number.isFinite(stamp(sub.startsAt)) || !Number.isFinite(stamp(sub.endsAt))) return "invalid";
  if (stamp(sub.startsAt) > nowMs) return "scheduled";
  if (stamp(sub.endsAt) <= nowMs) return "expired";
  return "active";
}

export function resolvePlan(config = {}, sub = null) {
  const id = sub?.planId || "trial";
  if (!PLAN_IDS.includes(id)) throw new HttpsError("failed-precondition", "The assigned plan is invalid. Contact the administrator.");
  return { id, ...DEFAULT_PLANS[id], ...(config.plans?.[id] || {}), limits: { ...DEFAULT_PLANS[id].limits, ...config.plans?.[id]?.limits }, daily: { ...DEFAULT_PLANS[id].daily, ...config.plans?.[id]?.daily } };
}

export function validatePlans(raw) {
  if (!raw || Object.keys(raw).length !== 3 || PLAN_IDS.some((id) => !raw[id])) throw new HttpsError("invalid-argument", "Exactly three plans are required.");
  const out = {};
  for (const id of PLAN_IDS) {
    const p = raw[id];
    const name = String(p.name || "").trim();
    const currency = String(p.currency || "").toUpperCase();
    if (!name || name.length > 60 || !/^[A-Z]{3}$/.test(currency)) throw new HttpsError("invalid-argument", "Each plan needs a name and three-letter currency.");
    const number = (value, label, max, integer = false, min = 0) => {
      if (value == null || value === "" || typeof value === "boolean") throw new HttpsError("invalid-argument", `${label} is required.`);
      const n = Number(value);
      if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new HttpsError("invalid-argument", `${label} is invalid.`);
      return n;
    };
    out[id] = { name, currency, price: number(p.price, "Price", 1e9, false, 1), durationDays: number(p.durationDays, "Plan duration", 366, true, 1), limits: {}, daily: {}, sessionMinutes: number(p.sessionMinutes, "Session minutes", 30, true, 1), maxOutputTokens: number(p.maxOutputTokens, "Output tokens", 65536, true, 256), thinkingBudget: number(p.thinkingBudget, "Thinking tokens", 24576, true) };
    for (const kind of ["text", "image", "tts", "liveMinutes"]) {
      out[id].limits[kind] = number(p.limits?.[kind], `${kind} period limit`, 1e6, true);
      out[id].daily[kind] = number(p.daily?.[kind], `${kind} daily limit`, 1e6, true);
    }
  }
  return out;
}

// Reserve before spending. Transactions serialize concurrent calls; storage errors
// fail closed. Retries count as attempts, and live sessions reserve their full cap.
export async function consumePlanUsage(db, familyId, kind, { units = 1, uid, now = new Date(), session = false } = {}) {
  if (!familyId || !["text", "image", "tts", "liveMinutes"].includes(kind) || !Number.isInteger(units) || units < 1) throw new HttpsError("invalid-argument", "Invalid usage reservation.");
  const iso = now.toISOString();
  const day = iso.slice(0, 10);
  try {
    return await db.runTransaction(async (tx) => {
      const refs = [plansRef(db), subscriptionRef(db, familyId), db.collection("families").doc(familyId)];
      if (uid && uid !== "system") refs.push(db.collection("users").doc(uid), db.collection("families").doc(familyId).collection("members").doc(uid));
      const snaps = await Promise.all(refs.map((r) => tx.get(r)));
      if (!snaps[2].exists || snaps[2].data().status === "disabled") throw new HttpsError("permission-denied", "This family is suspended.");
      if (refs.length > 3 && (snaps[3].data()?.disabled || !snaps[4].exists)) throw new HttpsError("permission-denied", "This account cannot use this family.");
      const sub = snaps[1].exists ? snaps[1].data() : null;
      const state = subscriptionState(sub, now.getTime());
      if (state !== "active") throw new HttpsError("failed-precondition", `Subscription ${state}. Contact the administrator to activate or renew it.`);
      const plan = resolvePlan(snaps[0].data(), sub);
      const ledger = usageRef(db, familyId, allowancePeriod(sub));
      const used = (await tx.get(ledger)).data() || {};
      const daily = used.daily || {};
      const today = daily[day] || {};
      const count = session ? Math.min(units, plan.sessionMinutes, Math.floor((stamp(sub.endsAt) - now.getTime()) / 60000), plan.limits[kind] - (used[kind] || 0), plan.daily[kind] - (today[kind] || 0)) : units;
      if (count < 1 || (used[kind] || 0) + count > plan.limits[kind] || (today[kind] || 0) + count > plan.daily[kind]) throw new HttpsError("resource-exhausted", `${plan.name} ${kind} allowance reached. Contact the administrator or wait for the next UTC allowance period.`);
      tx.set(ledger, { ...used, [kind]: (used[kind] || 0) + count, daily: { ...daily, [day]: { ...today, [kind]: (today[kind] || 0) + count } }, updatedAt: now });
      return { plan, units: count };
    });
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.error("[plans] reservation failed", e?.message);
    throw new HttpsError("unavailable", "Usage could not be checked. Please try again shortly.");
  }
}

// Anchored to activation, so a one-day trial cannot receive a second allowance
// when it crosses midnight or a month boundary. Renewals deliberately start a
// new allowance; editing price/status/end date leaves existing usage intact.
export function allowancePeriod(sub) { return String(stamp(sub?.startsAt) || "pending"); }
