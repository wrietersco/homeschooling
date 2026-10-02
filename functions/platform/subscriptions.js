import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { DEFAULT_PLANS, PLAN_IDS, resolvePlan, plansRef, subscriptionRef, usageRef, validatePlans, subscriptionState, allowancePeriod } from "../lib/subscriptions.js";
import { requirePlatformAdmin } from "./userAdmin.js";
import { resolveCaller } from "../lib/caller.js";
import { publicRequest } from "./planRequests.js";

const publicPlans = (config) => Object.fromEntries(PLAN_IDS.map(id => { const { id: ignored, ...plan } = resolvePlan(config, { planId: id }); return [id, plan]; }));

const plain = (sub) => sub ? { ...sub, startsAt: sub.startsAt?.toMillis?.() ?? sub.startsAt?.getTime?.() ?? sub.startsAt, endsAt: sub.endsAt?.toMillis?.() ?? sub.endsAt?.getTime?.() ?? sub.endsAt, updatedAt: sub.updatedAt?.toMillis?.() ?? null, effectiveStatus: subscriptionState(sub) } : { planId: "trial", status: "pending", effectiveStatus: "pending" };

export const getSubscriptionAdmin = onCall(async (request) => {
  await requirePlatformAdmin(request);
  const db = getFirestore();
  const [config, families] = await Promise.all([plansRef(db).get(), db.collection("families").get()]);
  const month = new Date().toISOString().slice(0, 7);
  const rows = await Promise.all(families.docs.map(async (d) => {
    const sub = await subscriptionRef(db, d.id).get();
    const usage = await usageRef(db, d.id, allowancePeriod(sub.data())).get();
    return { familyId: d.id, name: d.data().name || d.id, subscription: plain(sub.exists ? sub.data() : null), usage: usage.data() || {} };
  }));
  const requests = await db.collection("platformPlanRequests").where("status", "==", "pending").get();
  const requestRows = await Promise.all(requests.docs.map(async (d) => {
    const r = d.data(), mail = (await db.collection("mail").doc(d.id).get()).data();
    return { ...publicRequest(r), familyId: r.familyId, familyName: r.familyName, requesterName: r.requesterName, requesterEmail: r.requesterEmail, emailStatus: mail?.delivery?.state || "QUEUED (sender setup required if this persists)" };
  }));
  requestRows.sort((a, b) => a.createdAt - b.createdAt);
  return { plans: publicPlans(config.data()), families: rows, month, requests: requestRows };
});

export const setPricingPlans = onCall(async (request) => {
  const uid = await requirePlatformAdmin(request);
  const plans = validatePlans(request.data?.plans);
  const db = getFirestore();
  const batch = db.batch();
  batch.set(plansRef(db), { plans, updatedAt: new Date(), updatedBy: uid });
  batch.set(db.collection("platformAudit").doc(), { action: "plans.updated", uid, plans, createdAt: new Date() });
  await batch.commit();
  return { ok: true };
});

export function validateSubscription(data, plans = DEFAULT_PLANS) {
  const { planId, status } = data;
  if (!PLAN_IDS.includes(planId) || !["pending", "active", "suspended", "cancelled"].includes(status)) throw new HttpsError("invalid-argument", "Choose a valid plan and status.");
  const startsAt = new Date(Number(data.startsAt)), endsAt = new Date(Number(data.endsAt));
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt || Number(data.startsAt) <= 0) throw new HttpsError("invalid-argument", "The subscription end must be after its start.");
  const p = plans[planId];
  const amount = data.agreedPrice == null ? p.price : Number(data.agreedPrice);
  if (!Number.isFinite(amount) || amount < 1 || amount > 1e9) throw new HttpsError("invalid-argument", "Agreed price must be positive.");
  const currency = String(data.currency || p.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new HttpsError("invalid-argument", "Use a three-letter currency.");
  return { planId, status, startsAt, endsAt, agreedPrice: amount, currency, paymentStatus: data.paymentStatus === "paid" ? "paid" : "unpaid", paymentReference: String(data.paymentReference || "").trim().slice(0, 200), notes: String(data.notes || "").trim().slice(0, 2000) };
}

export const setFamilySubscription = onCall(async (request) => {
  const uid = await requirePlatformAdmin(request);
  const db = getFirestore();
  const familyId = String(request.data?.familyId || "");
  if (!familyId || familyId.includes("/")) throw new HttpsError("invalid-argument", "Choose a family.");
  const [family, config] = await Promise.all([db.collection("families").doc(familyId).get(), plansRef(db).get()]);
  if (!family.exists) throw new HttpsError("not-found", "Family not found.");
  const sub = validateSubscription(request.data, publicPlans(config.data()));
  const batch = db.batch();
  const update = { ...sub, updatedAt: new Date(), updatedBy: uid };
  batch.set(subscriptionRef(db, familyId), update);
  batch.set(db.collection("platformAudit").doc(), { action: "subscription.updated", uid, familyId, subscription: update, createdAt: new Date() });
  await batch.commit();
  return { ok: true, subscription: plain(update) };
});

export const getMySubscription = onCall(async (request) => {
  const { db, familyId } = await resolveCaller(request, { requireSubscription: false });
  const [config, sub] = await Promise.all([plansRef(db).get(), subscriptionRef(db, familyId).get()]);
  const usage = await usageRef(db, familyId, allowancePeriod(sub.data())).get();
  const current = plain(sub.exists ? sub.data() : null);
  // Internal payment references and notes remain admin-only.
  const { notes, paymentReference, updatedBy, ...publicSub } = current;
  const planRequest = (await db.collection("families").doc(familyId).collection("billing").doc("planRequest").get()).data();
  return { plans: publicPlans(config.data()), subscription: publicSub, usage: usage.data() || {}, planRequest: publicRequest(planRequest) };
});
