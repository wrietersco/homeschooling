import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { subscriptionRef } from "../lib/subscriptions.js";

export async function requirePlatformAdmin(request) {
  if (request.auth?.token?.platformRole !== "superadmin") throw new HttpsError("permission-denied", "Superadmin only.");
  const user = await getAuth().getUser(request.auth.uid);
  if (user.disabled || user.customClaims?.platformRole !== "superadmin" || Number(request.auth.token.auth_time || 0) * 1000 < Date.parse(user.tokensValidAfterTime || "1970-01-01")) throw new HttpsError("permission-denied", "Sign in again with an active superadmin account.");
  return user.uid;
}

export function validateAccount(raw, creating = false) {
  const out = {};
  if (creating || raw.email !== undefined) {
    const email = String(raw.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new HttpsError("invalid-argument", "A valid email is required.");
    out.email = email;
  }
  if (creating || raw.displayName !== undefined) {
    const displayName = String(raw.displayName || "").trim();
    if (!displayName || displayName.length > 120) throw new HttpsError("invalid-argument", "Name must be between 1 and 120 characters.");
    out.displayName = displayName;
  }
  if (creating || raw.password !== undefined) {
    if (typeof raw.password !== "string" || raw.password.length < 8 || raw.password.length > 128) throw new HttpsError("invalid-argument", "Password must be 8–128 characters.");
    out.password = raw.password;
  }
  return out;
}

const summary = (u, profile = {}) => ({ uid: u.uid, email: u.email || "", displayName: u.displayName || "", disabled: u.disabled || Boolean(profile.disabled), emailVerified: u.emailVerified, familyId: profile.familyId || null, role: profile.role || null, platformRole: u.customClaims?.platformRole || null, createdAt: u.metadata?.creationTime || null, lastSignInAt: u.metadata?.lastSignInTime || null });
const userId = (data) => {
  const uid = String(data?.uid || "");
  if (!uid || uid.includes("/")) throw new HttpsError("invalid-argument", "User ID is required.");
  return uid;
};
async function mutableTarget(uid) {
  const user = await getAuth().getUser(uid);
  if (user.customClaims?.platformRole === "superadmin") throw new HttpsError("failed-precondition", "Superadmin accounts are protected from account changes here.");
  return user;
}
const audit = (db, batch, actorUid, targetUid, action, details = {}) => batch.set(db.collection("platformAudit").doc(), { actorUid, targetUid, action, ...details, createdAt: new Date() });

export const listPlatformUsers = onCall(async (request) => {
  await requirePlatformAdmin(request);
  const db = getFirestore();
  const token = request.data?.pageToken;
  if (token != null && (typeof token !== "string" || token.length > 2048)) throw new HttpsError("invalid-argument", "Invalid page token.");
  const result = await getAuth().listUsers(100, token || undefined);
  const profiles = await Promise.all(result.users.map((u) => db.collection("users").doc(u.uid).get()));
  return { users: result.users.map((u, i) => summary(u, profiles[i].data())), nextPageToken: result.pageToken || null };
});

export const createPlatformUser = onCall(async (request) => {
  const actor = await requirePlatformAdmin(request);
  const data = request.data || {};
  const fields = validateAccount(data, true);
  const db = getFirestore(), auth = getAuth();
  const role = data.role || "parent";
  if (!["owner", "parent", "viewer"].includes(role)) throw new HttpsError("invalid-argument", "Invalid family role.");
  let familyId = String(data.familyId || "");
  const familyName = String(data.familyName || "").trim();
  if (familyId.includes("/") || familyName.length > 120 || (familyId && familyName)) throw new HttpsError("invalid-argument", "Choose an existing family or enter a new family name.");
  if (familyId && !(await db.collection("families").doc(familyId).get()).exists) throw new HttpsError("not-found", "Family not found.");
  const newFamily = familyName ? db.collection("families").doc() : null;
  if (newFamily) familyId = newFamily.id;
  const memberRole = newFamily ? "owner" : role;
  const user = await auth.createUser(fields);
  try {
    const now = new Date(), batch = db.batch();
    await auth.setCustomUserClaims(user.uid, familyId ? { familyId, role: memberRole } : {});
    batch.set(db.collection("users").doc(user.uid), { email: fields.email, displayName: fields.displayName, familyId: familyId || null, role: familyId ? memberRole : null, disabled: false, createdAt: now });
    if (familyId) batch.set(db.collection("families").doc(familyId).collection("members").doc(user.uid), { email: fields.email, displayName: fields.displayName, role: memberRole, joinedAt: now });
    if (newFamily) {
      batch.set(newFamily, { name: familyName, ownerUid: user.uid, status: "active", createdAt: now });
      batch.set(newFamily.collection("profile").doc("family"), { familyName, guidingLight: "", goalMode: "individual", updatedAt: now });
      batch.set(newFamily.collection("meta").doc("app"), { seeded: false, timezone: "Asia/Karachi", createdAt: now });
      batch.set(subscriptionRef(db, familyId), { planId: "trial", status: "pending", createdAt: now });
    }
    audit(db, batch, actor, user.uid, "user.created", { familyId: familyId || null });
    await batch.commit();
  } catch (e) {
    await auth.deleteUser(user.uid).catch(() => {});
    throw e;
  }
  return { user: summary(user, { familyId, role: familyId ? memberRole : null }) };
});

export const updatePlatformUser = onCall(async (request) => {
  const actor = await requirePlatformAdmin(request);
  const uid = userId(request.data);
  const target = await mutableTarget(uid);
  const fields = validateAccount({ email: request.data?.email, displayName: request.data?.displayName });
  if (!Object.keys(fields).length) throw new HttpsError("invalid-argument", "Provide account fields to change.");
  const db = getFirestore();
  const ref = db.collection("users").doc(uid), profile = (await ref.get()).data() || {};
  const updated = await getAuth().updateUser(uid, { ...fields, ...(fields.email && fields.email !== target.email ? { emailVerified: false } : {}) });
  const batch = db.batch();
  batch.set(ref, { ...fields, updatedAt: new Date() }, { merge: true });
  if (profile.familyId) batch.set(db.collection("families").doc(profile.familyId).collection("members").doc(uid), fields, { merge: true });
  audit(db, batch, actor, uid, "user.updated", { fields: Object.keys(fields) });
  await batch.commit();
  return { user: summary(updated, profile) };
});

export const setPlatformUserSuspended = onCall(async (request) => {
  const actor = await requirePlatformAdmin(request);
  const uid = userId(request.data);
  if (typeof request.data?.disabled !== "boolean") throw new HttpsError("invalid-argument", "Suspension must be true or false.");
  await mutableTarget(uid);
  const db = getFirestore(), auth = getAuth(), disabled = request.data.disabled;
  // Deny existing tokens through Firestore immediately; Auth blocks new logins.
  if (disabled) await db.collection("users").doc(uid).set({ disabled: true }, { merge: true });
  await auth.updateUser(uid, { disabled });
  if (disabled) await auth.revokeRefreshTokens(uid);
  const batch = db.batch();
  batch.set(db.collection("users").doc(uid), { disabled, updatedAt: new Date(), ...(disabled ? { sessionValidAfterSeconds: Math.floor(Date.now() / 1000) + 1 } : {}) }, { merge: true });
  audit(db, batch, actor, uid, disabled ? "user.suspended" : "user.reactivated");
  await batch.commit();
  return { ok: true };
});

export const setPlatformUserPassword = onCall(async (request) => {
  const actor = await requirePlatformAdmin(request);
  const uid = userId(request.data);
  await mutableTarget(uid);
  const { password } = validateAccount({ password: request.data?.password ?? "" });
  const db = getFirestore();
  await getAuth().updateUser(uid, { password });
  await getAuth().revokeRefreshTokens(uid);
  const batch = db.batch();
  batch.set(db.collection("users").doc(uid), { sessionValidAfterSeconds: Math.floor(Date.now() / 1000) + 1 }, { merge: true });
  audit(db, batch, actor, uid, "user.password-set");
  await batch.commit();
  return { ok: true };
});

export const getPlatformPasswordResetLink = onCall(async (request) => {
  const actor = await requirePlatformAdmin(request);
  const uid = userId(request.data), target = await mutableTarget(uid);
  if (!target.email) throw new HttpsError("failed-precondition", "This account has no email.");
  const link = await getAuth().generatePasswordResetLink(target.email);
  const db = getFirestore(), batch = db.batch();
  audit(db, batch, actor, uid, "user.reset-link-created");
  await batch.commit();
  return { link };
});
