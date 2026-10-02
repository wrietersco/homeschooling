import { randomUUID } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { resolveCaller } from "../lib/caller.js";
import { PLAN_IDS, plansRef, resolvePlan, subscriptionRef, subscriptionState } from "../lib/subscriptions.js";
import { requirePlatformAdmin } from "./userAdmin.js";

export const ADMIN_EMAIL = "visitwritersco@gmail.com";
const pointer = (db, id) => db.collection("families").doc(id).collection("billing").doc("planRequest");
export const publicRequest = (r) => r ? { id: r.id, planId: r.planId, planName: r.planName, price: r.price, currency: r.currency, durationDays: r.durationDays, status: r.status, rejectionReason: r.rejectionReason || "", createdAt: r.createdAt?.toMillis?.() ?? r.createdAt?.getTime?.() ?? null } : null;
export function notificationFor(r) {
  return { to: [ADMIN_EMAIL], message: { subject: `Plan request: ${r.planName} — ${r.familyName}`, text: `A family has requested a subscription package.\n\nFamily: ${r.familyName}\nRequested by: ${r.requesterName} (${r.requesterEmail})\nPackage: ${r.planName}\nPrice: ${r.currency} ${r.price}\nDuration: ${r.durationDays} days\nRequest ID: ${r.id}\n\nReview under Superadmin → Plans & subscriptions:\nhttps://homeschooling-b3e57.web.app/platform\n\nArrange payment outside the system, then approve the request to activate the package.` }, requestId: r.id, createdAt: r.createdAt };
}

export const requestPlanChange = onCall(async (request) => {
  const { db, uid, familyId } = await resolveCaller(request, { requireSubscription: false });
  const planId = request.data?.planId;
  if (!PLAN_IDS.includes(planId)) throw new HttpsError("invalid-argument", "Choose a valid package.");
  const id = randomUUID(), now = new Date();
  return db.runTransaction(async (tx) => {
    const [config, current, pending, family, user] = await Promise.all([plansRef(db), subscriptionRef(db, familyId), pointer(db, familyId), db.collection("families").doc(familyId), db.collection("users").doc(uid)].map((ref) => tx.get(ref)));
    const previous = pending.data();
    if (!family.exists || family.data()?.status === "disabled" || user.data()?.disabled) throw new HttpsError("permission-denied", "This account or family is suspended.");
    if (previous?.status === "pending") throw new HttpsError("already-exists", "Your family already has a package request awaiting review.");
    if (current.data()?.planId === planId && subscriptionState(current.data()) === "active") throw new HttpsError("failed-precondition", "Your family already has this active package.");
    const day = now.toISOString().slice(0, 10);
    const count = previous?.requestDay === day ? Number(previous.dayCount || 0) : 0;
    if (count >= 5) throw new HttpsError("resource-exhausted", "Too many package requests today. Please try tomorrow.");
    const plan = resolvePlan(config.data(), { planId });
    const r = { id, familyId, familyName: family.data()?.name || familyId, requesterUid: uid, requesterName: user.data()?.displayName || request.auth.token?.name || "Family member", requesterEmail: request.auth.token?.email || user.data()?.email || "", planId, planName: plan.name, price: plan.price, currency: plan.currency, durationDays: plan.durationDays, status: "pending", createdAt: now, requestDay: day, dayCount: count + 1 };
    tx.set(db.collection("platformPlanRequests").doc(id), r);
    tx.set(pointer(db, familyId), r);
    // Official Firebase Trigger Email extension consumes this server-only outbox.
    tx.set(db.collection("mail").doc(id), notificationFor(r));
    return { ok: true, request: publicRequest(r) };
  });
});

export const reviewPlanRequest = onCall(async (request) => {
  const actor = await requirePlatformAdmin(request);
  const { requestId, decision, paymentConfirmed } = request.data || {};
  if (typeof requestId !== "string" || !requestId || requestId.includes("/") || !["approve", "reject"].includes(decision)) throw new HttpsError("invalid-argument", "Choose a request and decision.");
  if (decision === "approve" && paymentConfirmed !== true) throw new HttpsError("failed-precondition", "Confirm the offline payment before approving.");
  const db = getFirestore(), now = new Date();
  const ref = db.collection("platformPlanRequests").doc(requestId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Package request not found.");
    const r = snap.data();
    if (r.status !== "pending") throw new HttpsError("failed-precondition", "This request has already been reviewed.");
    const [family, pending] = await Promise.all([tx.get(db.collection("families").doc(r.familyId)), tx.get(pointer(db, r.familyId))]);
    if (pending.data()?.id !== requestId || !family.exists) throw new HttpsError("failed-precondition", "The family request is no longer current.");
    if (decision === "approve" && family.data()?.status === "disabled") throw new HttpsError("failed-precondition", "Reactivate the family before approving.");
    const status = decision === "approve" ? "approved" : "rejected";
    const update = { status, reviewedAt: now, reviewedBy: actor, rejectionReason: decision === "reject" ? String(request.data.reason || "").trim().slice(0, 500) : "" };
    if (decision === "approve") {
      // Approval starts a fully paid period, including trial→monthly transitions.
      tx.set(subscriptionRef(db, r.familyId), { planId: r.planId, status: "active", startsAt: now, endsAt: new Date(now.getTime() + r.durationDays * 86400000), agreedPrice: r.price, currency: r.currency, paymentStatus: "paid", paymentReference: String(request.data.paymentReference || "").trim().slice(0, 200), notes: `Approved package request ${requestId}`, updatedAt: now, updatedBy: actor });
    }
    tx.update(ref, update); tx.update(pointer(db, r.familyId), update);
    tx.set(db.collection("platformAudit").doc(), { action: `planRequest.${status}`, requestId, familyId: r.familyId, actorUid: actor, createdAt: now });
    return { ok: true, status };
  });
});
