import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PLANS, validatePlans, subscriptionState, consumePlanUsage, savePreparedActivity, resolvePlan, allowancePeriod } from "../lib/subscriptions.js";
import { validateSubscription } from "../platform/subscriptions.js";
import { validateAccount } from "../platform/userAdmin.js";
import { withCostMetering } from "../agents/agentConfig.js";
import { assertUserAccess } from "../lib/caller.js";

const now = new Date("2026-10-02T10:00:00Z");
const active = { planId: "basic", status: "active", startsAt: new Date("2026-10-01"), endsAt: new Date("2026-11-01") };
function database({ sub = active, config = { plans: DEFAULT_PLANS }, disabled = false, familyDisabled = false } = {}) {
  const store = new Map([["platform/plans", config], ["families/f", { status: familyDisabled ? "disabled" : "active" }], ["users/u", { disabled, familyId: "f" }], ["families/f/members/u", { role: "parent" }]]);
  if (sub) store.set("families/f/billing/subscription", sub);
  const snap = (r) => ({ exists: store.has(r.path), data: () => store.get(r.path) });
  const node = (path) => ({ path, collection: (p) => node(`${path}/${p}`), doc: (p = "event") => node(`${path}/${p}`), get: async () => snap({ path }) });
  let pending = Promise.resolve();
  return { store, collection: (p) => node(p), batch: () => ({ set() {}, async commit() {} }), runTransaction(fn) {
    const result = pending.then(() => fn({ get: async (r) => snap(r), set: (r, v) => store.set(r.path, v) }));
    pending = result.catch(() => {}); return result;
  } };
}
test("three paid plans match the requested trial and monthly prices", () => {
  assert.deepEqual(Object.values(DEFAULT_PLANS).map((p) => [p.price, p.durationDays]), [[1500, 1], [4500, 30], [15000, 30]]);
  assert.deepEqual(validatePlans(DEFAULT_PLANS), DEFAULT_PLANS);
  const p = structuredClone(DEFAULT_PLANS); p.trial.price = 0;
  assert.throws(() => validatePlans(p), /Price is invalid/);
  p.trial.price = 1500; p.basic.daily.text = -1;
  assert.throws(() => validatePlans(p), /daily limit is invalid/);
});
test("subscription access excludes unassigned, pending, scheduled, expired, and suspended families", () => {
  assert.equal(subscriptionState(null, now.getTime()), "pending");
  assert.equal(subscriptionState(active, now.getTime()), "active");
  assert.equal(subscriptionState({ ...active, startsAt: new Date("2026-10-03") }, now.getTime()), "scheduled");
  assert.equal(subscriptionState({ ...active, endsAt: now }, now.getTime()), "expired");
  assert.equal(subscriptionState({ ...active, status: "suspended" }, now.getTime()), "suspended");
  assert.equal(subscriptionState({ ...active, endsAt: undefined }, now.getTime()), "invalid");
});
test("concurrent reservations cannot exceed a plan allowance", async () => {
  const plans = structuredClone(DEFAULT_PLANS); plans.basic.limits.text = 5;
  const db = database({ config: { plans } });
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => consumePlanUsage(db, "f", "text", { uid: "u", now })));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 5);
  assert.equal(db.store.get(`families/f/planUsage/${allowancePeriod(active)}`).text, 5);
});
test("daily and subscription-period caps are independent and a trial cannot reset at month boundaries", async () => {
  const plans = structuredClone(DEFAULT_PLANS); plans.trial.limits.text = 2; plans.trial.daily.text = 1;
  const sub = { ...active, planId: "trial", startsAt: new Date("2026-09-30T20:00Z"), endsAt: new Date("2026-10-01T20:00Z") };
  const db = database({ sub, config: { plans } });
  await consumePlanUsage(db, "f", "text", { now: new Date("2026-09-30T23:00Z") });
  await assert.rejects(consumePlanUsage(db, "f", "text", { now: new Date("2026-09-30T23:01Z") }), { code: "resource-exhausted" });
  await consumePlanUsage(db, "f", "text", { now: new Date("2026-10-01T01:00Z") });
  await assert.rejects(consumePlanUsage(db, "f", "text", { now: new Date("2026-10-01T02:00Z") }), { code: "resource-exhausted" });
  assert.equal(db.store.get(`families/f/planUsage/${allowancePeriod(sub)}`).text, 2);
});
test("suspended users/families and missing subscriptions cannot reserve usage", async () => {
  for (const options of [{ sub: null }, { disabled: true }, { familyDisabled: true }, { sub: { ...active, status: "cancelled" } }]) await assert.rejects(consumePlanUsage(database(options), "f", "text", { uid: "u", now }));
});
test("usage storage failures fail closed", async () => {
  await assert.rejects(consumePlanUsage({ runTransaction: async () => { throw new Error("offline"); } }, "f", "image"), { code: "unavailable" });
});
test("live reservation respects remaining allowance and session duration", async () => {
  const plans = structuredClone(DEFAULT_PLANS); plans.basic.limits.liveMinutes = 12;
  const db = database({ config: { plans } });
  assert.equal((await consumePlanUsage(db, "f", "liveMinutes", { units: 20, session: true, now })).units, 10);
  assert.equal((await consumePlanUsage(db, "f", "liveMinutes", { units: 20, session: true, now })).units, 2);
  await assert.rejects(consumePlanUsage(db, "f", "liveMinutes", { units: 20, session: true, now }), { code: "resource-exhausted" });
});
test("price changes do not reset usage; renewal does", async () => {
  const db = database(); await consumePlanUsage(db, "f", "text", { now });
  db.store.set("families/f/billing/subscription", { ...active, agreedPrice: 6000 });
  await consumePlanUsage(db, "f", "text", { now });
  assert.equal(db.store.get(`families/f/planUsage/${allowancePeriod(active)}`).text, 2);
  db.store.set("families/f/billing/subscription", { ...active, startsAt: now });
  await consumePlanUsage(db, "f", "text", { now });
  assert.equal(db.store.get(`families/f/planUsage/${now.getTime()}`).text, 1);
});
test("subscription validation rejects free prices and invalid dates", () => {
  const data = { planId: "trial", status: "active", startsAt: now.getTime(), endsAt: now.getTime() + 86400000 };
  assert.equal(validateSubscription(data).agreedPrice, 1500);
  assert.throws(() => validateSubscription({ ...data, agreedPrice: 0 }), /positive/);
  assert.throws(() => validateSubscription({ ...data, endsAt: data.startsAt }), /end must be after/);
});
test("password validation rejects weak/missing passwords and account payloads cannot set admin claims", () => {
  assert.throws(() => validateAccount({ email: "a@example.com", displayName: "A", password: "short" }, true), /Password/);
  assert.deepEqual(validateAccount({ email: "a@example.com", displayName: "A", password: "long-pass", platformRole: "superadmin", disabled: false }, true), { email: "a@example.com", displayName: "A", password: "long-pass" });
});
test("old sessions and disabled users are rejected even with a valid callable token", async () => {
  const db = database(); db.store.set("users/u", { sessionValidAfterSeconds: 2000 });
  await assert.rejects(assertUserAccess({ auth: { uid: "u", token: { auth_time: 1999 } } }, db), { code: "unauthenticated" });
  await assertUserAccess({ auth: { uid: "u", token: { auth_time: 2001 } } }, db);
});
test("text client checks quota before invoking provider and clamps retries to plan token budgets", async () => {
  const current = new Date(); const sub = { ...active, startsAt: new Date(current.getTime() - 60000), endsAt: new Date(current.getTime() + 86400000) };
  const db = database({ sub }); let calls = 0, received;
  const client = withCostMetering(db, { model: "gemini-2.5-flash", async generate(args) { calls++; received = args.config; return { text: "ok", usage: { inputTokens: 5, outputTokens: 5 } }; } }, "content", "gemini-2.5-flash", { familyId: "f", uid: "u" });
  await client.generate({ config: { maxOutputTokens: 65536, thinkingBudget: 20000 } });
  assert.equal(received.maxOutputTokens, 8192); assert.equal(received.thinkingBudget, 1024);
  db.store.set("families/f/billing/subscription", { ...sub, status: "suspended" });
  await assert.rejects(client.generate({}), { code: "failed-precondition" }); assert.equal(calls, 1);
});

test("successful activity saves and quota commit together under concurrent requests", async () => {
  const current = new Date();
  const sub = { ...active, startsAt: new Date(current.getTime()-60000), endsAt: new Date(current.getTime()+86400000) };
  const plans = structuredClone(DEFAULT_PLANS); plans.basic.limits.activities = 2;
  const db = database({ sub, config: { plans } });
  const before = await consumePlanUsage(db, "f", "activities", { uid: "u", dryRun: true });
  assert.equal(before.remaining, 2); assert.equal(db.store.has(`families/f/planUsage/${allowancePeriod(sub)}`), false);
  await assert.rejects(savePreparedActivity(db, "f", db.collection("families").doc("f").collection("activities").doc("empty"), {}, "u"));
  const results = await Promise.allSettled(Array.from({length: 8}, (_, i) => savePreparedActivity(db, "f", db.collection("families").doc("f").collection("activities").doc(`a${i}`), { content: { kind: "tips", tips: ["Read together"] } }, "u")));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 2);
  assert.equal([...db.store.keys()].filter(k => k.startsWith("families/f/activities/")).length, 2);
  assert.equal(db.store.get(`families/f/planUsage/${allowancePeriod(sub)}`).activities, 2);
});

test("older custom plans retain their prices and inherit the new activity allowance", () => {
  const legacy = { plans: { basic: { price: 6000, limits: { text: 123 } } } };
  const resolved = resolvePlan(legacy, { planId: "basic" });
  assert.equal(resolved.price, 6000); assert.equal(resolved.limits.text, 123); assert.equal(resolved.limits.activities, 80);
});
